/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { makeRange } from "@components/PluginSettings/components";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { GuildChannelStore, Menu, React, RestAPI, UserStore } from "@webpack/common";
import type { Channel } from "discord-types/general";

const VoiceStateStore = findStoreLazy("VoiceStateStore");

async function runSequential<T>(promises: Promise<T>[]): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < promises.length; i++) {
        const promise = promises[i];
        const result = await promise;
        results.push(result);

        if (i % settings.store.waitAfter === 0) {
            await new Promise(resolve => setTimeout(resolve, settings.store.waitSeconds * 1000));
        }
    }

    return results;
}

function sendPatch(channel: Channel, body: Record<string, any>, bypass = false) {
    const usersVoice = VoiceStateStore.getVoiceStatesForChannel(channel.id); // Get voice states by channel id
    const myId = UserStore.getCurrentUser().id; // Get my user id

    const promises: Promise<any>[] = [];
    Object.keys(usersVoice).forEach((key, index) => {
        const userVoice = usersVoice[key];

        if (bypass || userVoice.userId !== myId) {
            promises.push(RestAPI.patch({
                url: `/guilds/${channel.guild_id}/members/${userVoice.userId}`,
                body: body
            }));
        }
    });

    runSequential(promises).catch(error => {
        console.error("VoiceChatUtilities failed to run", error);
    });
}

interface VoiceChannelContextProps {
    channel: Channel;
}

const VoiceChannelContext: NavContextMenuPatchCallback = (children, { channel }: VoiceChannelContextProps) => {
    // only for voice and stage channels
    if (!channel || (channel.type !== 2 && channel.type !== 13)) return;

    const userCount = Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id)).length;
    if (userCount === 0) return;

    const guildChannels: { VOCAL: { channel: Channel, comparator: number }[] } = GuildChannelStore.getChannels(channel.guild_id);
    const voiceChannels = guildChannels.VOCAL.map(({ channel }) => channel).filter(({ id }) => id !== channel.id);

    // Channels except current
    const otherVoiceChannels = voiceChannels.filter(({ id }) => id !== channel.id);

    children.splice(
        -1,
        0,
        <Menu.MenuItem
            label="Voice Tools"
            key="voice-tools"
            id="voice-tools"
        >
            <Menu.MenuItem
                key="voice-tools-disconnect-all"
                id="voice-tools-disconnect-all"
                label="Disconnect all (This Channel)"
                action={() => sendPatch(channel, {
                    channel_id: null,
                })}
            />
            <Menu.MenuItem
                key="voice-tools-disconnect-all-global"
                id="voice-tools-disconnect-all-global"
                label="Disconnect everyone (All Channels)"
                action={() => {
                    voiceChannels.forEach(vc => {
                        const members = VoiceStateStore.getVoiceStatesForChannel(vc.id);
                        if (Object.keys(members).length > 0) {
                            sendPatch(vc, {
                                channel_id: null,
                            });
                        }
                    });
                }}
            />

            <Menu.MenuItem
                key="voice-tools-mute-all"
                id="voice-tools-mute-all"
                label="Mute all"
                action={() => sendPatch(channel, {
                    mute: true,
                })}
            />

            <Menu.MenuItem
                key="voice-tools-unmute-all"
                id="voice-tools-unmute-all"
                label="Unmute all"
                action={() => sendPatch(channel, {
                    mute: false,
                })}
            />

            <Menu.MenuItem
                key="voice-tools-deafen-all"
                id="voice-tools-deafen-all"
                label="Deafen all"
                action={() => sendPatch(channel, {
                    deaf: true,
                })}
            />

            <Menu.MenuItem
                key="voice-tools-undeafen-all"
                id="voice-tools-undeafen-all"
                label="Undeafen all"
                action={() => sendPatch(channel, {
                    deaf: false,
                })}
            />

            <Menu.MenuItem
                key="voice-tools-undeafen_unmute-all"
                id="voice-tools-undeafen_unmute-all"
                label="Unmute & Undeafen all"
                action={() => sendPatch(channel, {
                    deaf: false,
                    mute: false,
                })}
            />
            
            <Menu.MenuItem
                key="voice-tools-deafen_mute-all"
                id="voice-tools-deafen_mute-all"
                label="Mute & Deafen all"
                action={() => sendPatch(channel, {
                    deaf: true,
                    mute: true,
                })}
            />

            <Menu.MenuItem
                label="Move all (This Channel Only)"
                key="voice-tools-move-all"
                id="voice-tools-move-all"
            >
                {voiceChannels.map(voiceChannel => {
                    return (
                        <Menu.MenuItem
                            key={voiceChannel.id}
                            id={voiceChannel.id}
                            label={voiceChannel.name}
                            action={() => sendPatch(channel, {
                                channel_id: voiceChannel.id,
                            }, true)}
                        />
                    );
                })}

            </Menu.MenuItem>

            <Menu.MenuItem
                label="Move everyone (All Channels)"
                key="voice-tools-move-global"
                id="voice-tools-move-global"
            >
                {voiceChannels.map(targetChannel => (
                    <Menu.MenuItem
                        key={`global-move-to-${targetChannel.id}`}
                        id={`global-move-to-${targetChannel.id}`}
                        label={targetChannel.name}
                        action={() => {
                            // Move everyone from ALL channels (including current) into targetChannel
                            voiceChannels.forEach(sourceChannel => {
                                const members = VoiceStateStore.getVoiceStatesForChannel(sourceChannel.id);
                                if (Object.keys(members).length > 0) {
                                    sendPatch(sourceChannel, {
                                        channel_id: targetChannel.id,
                                    }, true);
                                }
                            });
                        }}
                    />
                ))}
            </Menu.MenuItem>
        </Menu.MenuItem>
    );
};

const settings = definePluginSettings({
    waitAfter: {
        type: OptionType.SLIDER,
        description: "Amount of API actions to perform before waiting (to avoid rate limits)",
        default: 5,
        markers: makeRange(1, 20),
    },
    waitSeconds: {
        type: OptionType.SLIDER,
        description: "Time to wait between each action (in seconds)",
        default: 2,
        markers: makeRange(1, 10, .5),
    }
});

export default definePlugin({
    name: "VoiceChatUtilities",
    description: "This plugin allows you to perform multiple actions on an entire channel (move, mute, disconnect, etc.) (originally by dutake)",
    authors: [Devs.D3SOX, {name: "Teo", id: 577967084408143872n }],

    settings,

    contextMenus: {
        "channel-context": VoiceChannelContext
    },
});


