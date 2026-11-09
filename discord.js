const { Client, GatewayIntentBits, Message, ChannelSelectMenuBuilder, ChannelType, ActionRowBuilder, EmbedBuilder, messageLink } = require('discord.js');
const WebSocket = require('ws');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { error } = require('console');
require('dotenv').config();

const defaultChatSyncConfig = {
    "websocketPort": "38200",
    "chatSyncGuildId": "",
    "chatSyncChannel": "",
    "chatWebhookUrl": "",
    "serverWebhookUrl": "",
    "syncEnabled": "true",
    "setupLocked": "false",
    "toggleLocked": "false",
    "cfgLocked": "false",
    "capLocked": "false",
    "helpLocked": "false",
    "testLocked": "false",
    "cmdPermsUnmetPrompt": "true",
    "fallbackCmdLockState": "false",
}

const defaultPanelConfig = {
    panelGuildId: "",
    panelConsoleChannelId: "",
    panelConsoleMessageId: "",
    panelDashboardChannelId: "",
    panelDashboardMessageId: "",
    panelSchedulesChannelId: "",
    panelSchedulesMessageId: "",
    panelBackupsChannelId: "",
    panelBackupsMessageId: "",
    panelPlayersChannelId: "",
    panelPlayersMessageId: "",
    panelFilesChannelId: "",
    panelFilesMessageId: "",
    panelConfigChannelId: "",
    panelConfigMessageId: "",
    panelHelpChannelId: "",
    panelHelpMessageId: "",
    panelAccessRoleId: "",
    panelConsoleMaxChars: "1024",
    panelServerDirectory: "",
    panelServerStartCmd: "java -jar server.jar nogui",
    panelServerStopCmd: "stop",
    panelUiWidth: "32",
    panelServerCrashRecovery: "false",
    panelServerMaxRecoveryAttempts: "3",
    panelServerRecoveryTimeout: "10",
};

const capabilities = [
    'core:chat', 'core:join', 'core:leave', 'core:death', 'core:advancement',
    'core:discord_chat',

    'config:configQuery',
    `config:configWrite`,

    'cfgKey:forwardChat',
    'cfgKey:forwardJoinLeave',
    'cfgKey:forwardDeaths',
    'cfgKey:forwardAdvancements'
]

const core_capabilities = Object.freeze([
    'core:chat', 'core:join', 'core:leave', 'core:death', 'core:advancement',
    'core:discord_chat',
]);

const GROUP_VERSIONS = {
    'core': 'v0.1.0',
    'config': 'v0.2.0',
    'cfgkey': 'v0.2.0',
};

let tuiState = {
    items: [
        "EssentialsX-2.20.1.jar",
        "WorldEdit-Bukkit-7.2.15.jar",
        "VeryLongPluginNameThatNeverEnds.jar"
    ],
    cursor: 0,
    lastMessageId: null
};
let scrollX = 0;

let consoleLines = [];
let lastSentConsoleString = "";
let isSendingConsoleMessage = false;

let mcProcess = null;
let isRestarting = false;

let syncConfig = {};
let panelConfig = {};

let remainingRecoveryAttempts = 3;

function renderTui() {
    const totalWidth = parseInt(panelConfig.panelUiWidth) || 40;
    
    const textWidth = totalWidth - 4; 
    const divider = '='.repeat(textWidth);

    let leftLines = [];
    leftLines.push(`[ FILES: /plugins ]`);
    leftLines.push(divider);

    tuiState.items.forEach((file, index) => {
        const prefix = index === tuiState.cursor ? '>' : ' ';
        const fullLine = `${prefix} [${index + 1}] ${file}`;

        const shiftedLine = fullLine.substring(scrollX, scrollX + textWidth);
        leftLines.push(shiftedLine.padEnd(textWidth, ' '));
    });

    leftLines.push(divider);
    leftLines.push(`Q/A Z/X W:Sel S:Bck`.padEnd(textWidth, ' '));

    const scrollbarLines = buildScrollbar(tuiState.cursor, tuiState.items.length, tuiState.items.length);

    let finalLines = [];
    
    finalLines.push(` ${leftLines[0]}   `);
    finalLines.push(` ${leftLines[1]}   `);

    for (let i = 0; i < tuiState.items.length; i++) {
        const left = leftLines[i + 2];
        const bar = scrollbarLines[i] || ' ';
        finalLines.push(` ${left} │ ${bar}`);
    }

    const footerIndex = leftLines.length - 2;
    finalLines.push(` ${leftLines[footerIndex]}   `);
    finalLines.push(` ${leftLines[footerIndex + 1]}   `);

    return `\`\`\`\n${finalLines.join('\n')}\n\`\`\``;
}

async function startTui(channel) {
    const text = renderTui();
    const msg = await channel.send(text);
    tuiState.lastMessageId = msg.id;
}

async function handleTuiInput(channel, input) {
    if (input === 'q') {
        tuiState.cursor--;
        if (tuiState.cursor < 0) tuiState.cursor = tuiState.items.length - 1;
    } 
    else if (input === 'a') {
        tuiState.cursor++;
        if (tuiState.cursor >= tuiState.items.length) tuiState.cursor = 0;
    }
    else if (input === 'w') {
        const selectedFile = tuiState.items[tuiState.cursor];
        console.log(`Selected: ${selectedFile}`);
    }

    else if (input === 's') {
        console.log('Going back...');
    }

    const text = renderTui();
    const msg = await channel.messages.fetch(tuiState.lastMessageId).catch(() => null);
    if (msg) await msg.edit(text);
}


function colorizeMinecraftLine(line) {
    if (!line.trim()) return line;

    const hasAnsi = line.includes('\u001b[');

    if (hasAnsi) {
        return `${line}\u001b[0m`;
    }

    if (line.includes('/ERROR]') || line.includes('[ERROR]')) {
        return `\u001b[31m${line}\u001b[0m`;
    }
    if (line.includes('/WARN]') || line.includes('[WARN]')) {
        return `\u001b[33m${line}\u001b[0m`;
    }

    return line;
}



function startServer() {
    if (mcProcess) return "[INFO] Server is already running.";

    if (!panelConfig.panelServerDirectory) {
        return "[ERROR] Server directory is not configured in panel-config.json";
    }

    readConfigs();

    const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
    const startCmd = panelConfig.panelServerStartCmd;
    console.log(startCmd)
    mcProcess = spawn(startCmd, [], { 
        cwd: serverDir,
        shell: true,
        detached: true,
    });

    mcProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
            
        for (const line of lines) {
            if (!line.trim()) continue;
            console.log(line);
            
            // const match = line.match(/There are (\d+) of a max of \d+ players online:?\s*(.*)/);
            // if (match) {
            //     playerCount = parseInt(match[1]);
            //     const names = match[2].trim();
            //     playerList = names ? names.split(', ') : [];

            //     if (playerCount === 0 && emptyRestartPending) {
            //         triggerEmptyRestart();
            //     } else if (playerCount > 0 && emptyRestartTimer) {
            //         clearTimeout(emptyRestartTimer);
            //         emptyRestartTimer = null;
            //         handleConsoleUpdate(panelLog('WARN', `Player rejoined (${playerCount} online). Empty restart cancelled.`));
            //     }
            // }
                
            handleConsoleUpdate(colorizeMinecraftLine(line)); 
        }
    });

    mcProcess.stderr.on('data', (data) => {
        console.error(`${data}`);
        handleConsoleUpdate(colorizeMinecraftLine(`${data.toString().trim()}`));
    });
        
       mcProcess.on('close', (code, signal) => {
        mcProcess = null;

        if (code === 0 || signal) {
            if (signal) {
                handleConsoleUpdate(panelLog('WARN', `Server stopped with signal ${signal}`));
            } else {
                handleConsoleUpdate(panelLog('INFO', `Server stopped with code ${code}`));
            }
            remainingRecoveryAttempts = parseInt(panelConfig.panelServerMaxRecoveryAttempts);
            return;
        } 
        else {
            remainingRecoveryAttempts--;
            handleConsoleUpdate(panelLog('ERROR', `Server crashed with code ${code}. ${remainingRecoveryAttempts} recovery attempts remaining.`));
        }

        const delayMs = (parseInt(panelConfig.panelServerRecoveryTimeout) || 10) * 1000;

        if (isRestarting) {
            isRestarting = false;
            setTimeout(startServer, delayMs);
        }
        else if (remainingRecoveryAttempts > 0 && panelConfig.panelServerCrashRecovery === "true") {
            handleConsoleUpdate(panelLog('WARN', `Attempting crash recovery in ${delayMs / 1000} seconds...`));
            setTimeout(startServer, delayMs);
        }
    });
    return `Starting server...`
}

function stopServer() {
    if (!mcProcess) return "Server is not running.";
    
    const stopCmd = panelConfig.panelServerStopCmd || "stop";
    
    if (stopCmd.toLowerCase() === 'kill') {
        mcProcess.kill('SIGKILL');
    } else {
        mcProcess.stdin.write(stopCmd + '\n');
    }
    
    return "Stopping the server...";
}

function killServer() {
    if (!mcProcess) return "Server is not running.";
    
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', mcProcess.pid, '/f', '/t']);
        } else {
            process.kill(-mcProcess.pid, 'SIGKILL');
        }
    } catch (err) {
        try { mcProcess.kill('SIGKILL'); } catch (e) {}
    }
    
    mcProcess = null;
    return "Killed server and its child processes.";
}

async function handleConsoleUpdate(newLine) {
    consoleLines.push(newLine);
    const maxLines = parseInt(panelConfig.panelConsoleMaxLines) || 36;
    
    if (consoleLines.length > maxLines) {
        consoleLines.shift();
    }
}

async function sendDiscordConsole() {
    if (isSendingConsoleMessage) return;
    isSendingConsoleMessage = true;

    try {
        const channel = client.channels.cache.get(panelConfig.panelConsoleChannelId);
        if (!channel) return;

        let text = `\`\`\`ansi\n${consoleLines.join('\n')}\n\`\`\``;
        
        while (text.length > 3900 && consoleLines.length > 0) {
            consoleLines.shift(); 
            text = `\`\`\`ansi\n${consoleLines.join('\n')}\n\`\`\``; 
        }

        if (consoleLines.length === 0) {
            text = "```ansi\n[PANEL:INFO] Waiting for logs...\n```";
        }

        if (text === lastSentConsoleString) {
            isSendingConsoleMessage = false;
            return;
        }
        lastSentConsoleString = text;

        const embed = new EmbedBuilder().setDescription(text);

        if (panelConfig.panelConsoleMessageId) {
            const msg = await channel.messages.fetch(panelConfig.panelConsoleMessageId).catch(() => null);
            if (msg) {
                await msg.edit({ embeds: [embed] });
                isSendingConsoleMessage = false; // Unlock
                return;
            }
        }
        
        const newMsg = await channel.send({ embeds: [embed] });
        panelConfig.panelConsoleMessageId = newMsg.id;
        savePanelConfig();
        
    } catch (err) {
        console.error("Console update failed:", err);
        if (err.code === 10008 || err.status === 429) { 
            panelConfig.panelConsoleMessageId = ""; 
            savePanelConfig();
        }
    } finally {
        isSendingConsoleMessage = false; 
    }
}

const chatsyncConfigPath = './chatsync-config.json';
const panelConfigPath = './panel-config.json';

function readConfigs() {
    try {
        if (fs.existsSync(chatsyncConfigPath)) {
            syncConfig = { ...defaultChatSyncConfig, ...JSON.parse(fs.readFileSync(chatsyncConfigPath, 'utf-8')) };
        } else {
            syncConfig = { ...defaultChatSyncConfig };
            fs.writeFileSync(chatsyncConfigPath, JSON.stringify(syncConfig, null, 2));
        }

        if (fs.existsSync(panelConfigPath)) {
            panelConfig = { ...defaultPanelConfig, ...JSON.parse(fs.readFileSync(panelConfigPath, 'utf-8')) };
        } else {
            panelConfig = { ...defaultPanelConfig };
            fs.writeFileSync(panelConfigPath, JSON.stringify(panelConfig, null, 2));
        }
    } catch (err) {
        console.error("Error loading configs:", err);
    }
}

function saveSyncConfig() {
    fs.writeFileSync(chatsyncConfigPath, JSON.stringify(syncConfig, null, 2));
}

function savePanelConfig() {
    fs.writeFileSync(panelConfigPath, JSON.stringify(panelConfig, null, 2));
}

    function getGroupStatus(group) {
        if (group.features.length === 0) return 'none';
        const supportedCount = group.features.filter(f => agreed.has(f)).length;
        
        if (supportedCount === group.features.length) return 'full';
        if (supportedCount > 0) return 'partial';
        return 'none';
    }

    let negotiated = false;
    let v01 = false;
    let agreed = new Set();
    let modInfo = { modVersion: null, mcVersion: null, schema: null };
    let modUnknownFeatures = [];

    function isConnected() { return negotiated || v01; }
    function canSend(type) { return agreed.has(type); }
    function socketIsOpen() {
        return [...wss.clients].some(c => c.readyState === WebSocket.OPEN);
    }

const LOG_COLORS = {
INFO: '\u001b[32m',
WARN: '\u001b[33m',
ERROR: '\u001b[31m',
RESET: '\u001b[0m'
};

function panelLog(level, message) {
    const color = LOG_COLORS[level] || LOG_COLORS.INFO;
    const tag = `${color}[PANEL: ${level}]${LOG_COLORS.RESET}`;
    return `${tag} ${message}`;
}

    async function handleCap(Message, args) {
        const FEATURE_GROUPS = getGroups();

        if (args.length > 0 && args[0].toLowerCase() !== 'all') {
            const groupKey = args[0].toLowerCase();
            const group = FEATURE_GROUPS[groupKey];

                    if (args[0]?.toLowerCase() === 'help') {
                        return Message.reply({
                            embeds: [{
                                title: '%cap help',
                                description: 
                                    `\`\`\`Usage:\n` +
                                        `========================\n`+
                                        `%cap           shows if any groups need attention\n` +
                                        `%cap all       lists all groups and their status\n` +
                                        `%cap <group>   shows all features in a group\n\n` +
                                        `[ OK ] => This group or feature is fully supported\n` +
                                        `[ !! ] => This group is partially supported\n` + 
                                        `[    ] => This group or feature is not supported` +
                                    `\`\`\``,
                                color: 0x202020,
                            }],
                        });
                    }

            if (!group) {
                return Message.reply(
                    `Unknown group: \`${groupKey}\`.\n` +
                    `Groups: ${Object.keys(FEATURE_GROUPS).map(g => `\`${g}\``).join(', ')}`
                );
            }

            const status = getGroupStatus(group);
            
            const embedColor = status === 'full' ? 0x00cc66 
                            : status === 'partial' ? 0xffcc00 
                            : 0xff8800;

            const statusLine = status === 'full' ? 'Supported'
                            : status === 'partial' ? 'Partially supported (needs a later version for all features'
                            : `**Not supported** ${group.minModVersion ? `(needs mod ${group.minModVersion} or above)` : '(needs a later version)'}`;

            const lines = [
                `**${groupKey}**`,
                '',
                statusLine,
            ];

            if (group.features.length > 0) {
                lines.push('', 'Features in this group:');
                for (const f of group.features) {
                    lines.push(`  ${agreed.has(f) ? '\`[ OK ]\` ' : '\`[    ]\` '} \`${f}\``);
                }
            }

            if (status === 'none') {
                lines.push(
                    '',
                    v01
                        ? `This feature requires ${group.minModVersion ? `v${group.minModVersion}+` : 'a later version'}.`
                        : `Currently on mod v${modInfo.modVersion}. This group requires ${group.minModVersion ? `v${group.minModVersion} or above` : 'a later version'}.`
                );
            }

            return Message.reply({
                embeds: [{
                    title: 'Capabilities',
                    description: lines.join('\n'),
                    color: embedColor,
                }],
            });
        }

        if (!isConnected()) {
            return Message.reply({
                embeds: [{
                    title: '%cap help',
                    description: 
                        `\`\`\`` +
                        `[ERROR]\n` +
                        `Capability information could not be accessed because the Minecraft server is not connected.` +
                        `\`\`\``,
                    color: 0x202020,
                }],
            });
        }

        const showAll = args[0]?.toLowerCase() === 'all';
        const statusLine = v01
            ? `v0.1 detected (no reply from \`cap\`).`
            : `Mod \`v${modInfo.modVersion}\` (MC ${modInfo.mcVersion})`;

        const groupKeys = Object.keys(FEATURE_GROUPS);
        const keyWidth = Math.max(...groupKeys.map(k => k.length));

        const allStatus = groupKeys.map(gk => ({
            key: gk,
            group: FEATURE_GROUPS[gk],
            status: getGroupStatus(FEATURE_GROUPS[gk])
        }));

        const toShow = showAll ? allStatus : allStatus.filter(s => s.status !== 'full');

        if (toShow.length === 0) {

            return Message.reply({
                embeds: [{
                    title: 'Capabilities',
                    description:
                        `${statusLine}\n\n` +
                        `All features in ${groupKeys.length} known groups are supported.` +
                        '\n\nRun `%cap all` for the full list.',
                    color: 0x00cc66,
                }],
            });
        }

        const lines = toShow.map(s => {
            const mark = s.status === 'full' ? '[ OK ]' 
                    : s.status === 'partial' ? '[ !! ]' 
                    : '[    ]';
                    
            const paddedKey = s.key.padEnd(keyWidth, ' ');
            
            let suffix = '';
            if (s.status === 'none') {
                suffix = s.group.minModVersion ? ` (needs mod ${s.group.minModVersion}+)` : ` (requires later version)`;
            } else if (s.status === 'partial') {
                suffix = ` (partial support)`;
            }
            
            return `${mark} ${paddedKey}${suffix}`;
        });

        const body = '```\n' + lines.join('\n') + '\n```';
        const footer = showAll
            ? 'Run `%cap <group>` for details.'
            : `${toShow.length} of ${groupKeys.length} groups incomplete. Run \`%cap all\` for the full list or \`%cap <group>\` for details.`;

        return Message.reply({
            embeds: [{
                title: 'Capabilities',
                description: `${statusLine}\n\n${body}\n\n${footer}`,
                color: v01 ? 0xffcc00 : 0x00cc66,
            }],
        });
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]
    });

    client.once('clientReady', () => {
        console.log(`[Discord] Logged in as ${client.user.tag}`);

        setInterval(async () => {
            await sendDiscordConsole();
        }, 1000); 
    });

    client.on(`interactionCreate`, async(interaction) => {
        if(!interaction.isChannelSelectMenu()) return;
        
        if(interaction.customId === `ch-select`){
            const selectedChannelId = interaction.values[0];
            const selectedChannel = client.channels.cache.get(selectedChannelId);
            if (!selectedChannel) return interaction.reply({ content: "Channel not found."});

            try {
                const chatWebhook = await selectedChannel.createWebhook({
                    name: '[Chat Sync] Player chat webhook',
                });

                const serverWebhook = await selectedChannel.createWebhook({
                    name: '[Chat Sync] Server messages webhook',
                });

                syncConfig.chatSyncChannel = selectedChannelId;
                syncConfig.chatWebhookUrl = chatWebhook.url; 
                syncConfig.serverWebhookUrl = serverWebhook.url; 
                saveSyncConfig();

                await interaction.reply({ 
                    content: `Synced channel set to <#${selectedChannelId}>!`, 
                });
            } catch (err) {
                console.error("Failed to create webhook:", err);
                await interaction.reply({ 
                    content: `Failed to create webhook. Is the \`Manage Webhooks\` permission granted?`, 
                });
            }
        }
    });

    client.on(`messageCreate`, async(Message) => {
        if(Message.author.bot) return;

        readConfigs();

    const isUnconfigured = (!panelConfig.panelGuildId || !syncConfig.chatSyncGuildId);

        if (isUnconfigured) {
            const content = Message.content.trim().toLowerCase().replace(/\s+/g, ' ');
            const isAdmin = Message.member.permissions.has('ManageGuild') || Message.member.permissions.has('Administrator');

            if (isAdmin) {
                if (content === '%panel setup') {
                    if (!Message.guildId) return Message.channel.send("```[PANEL:ERROR] This command can only be used in a server```");

                    panelConfig.panelGuildId = Message.guildId;
                    savePanelConfig();
                    
                    await Message.channel.send(`\`\`\`[PANEL:INFO] Panel Server registered in [${Message.guild.name}]. Configuring channels...\`\`\``);
                    
                    
                    try {
                            const category = await Message.guild.channels.create({
                                name: 'Server panel',
                                type: ChannelType.GuildCategory,
                                permissionOverwrites: [
                                    {
                                        id: Message.guild.roles.everyone.id,
                                        deny: ['ViewChannel'],
                                    },
                                    {
                                        id: client.user.id,
                                        allow: ['ViewChannel', 'SendMessages', 'EmbedLinks'],
                                    }
                                ]
                            });
                        const names = [
                            'console',
                            'dashboard',
                            'schedules',
                            'backups',
                            'players',
                            'files',
                            'config',
                            'help'
                        ];
                        
                        for (const name of names) {
                            try {
                                const ch = await Message.guild.channels.create({
                                    name: name,
                                    type: ChannelType.GuildText,
                                    parent: category.id,
                                });

                                const key = `panel${name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}ChannelId`;

                                panelConfig[key] = ch.id;
                                savePanelConfig(); 
                                
                                console.log(`[SETUP] Created #${name} (ID: ${ch.id})`);

                                await new Promise(resolve => setTimeout(resolve, 2500));

                            } catch (err) {
                                console.error(`[PANEL:SETUP] Failed to create #${name}:`, err);
                            }
                        }
                        savePanelConfig();
                        return Message.channel.send("```[PANEL:SETUP] Server management panel configured successfully!```");
                    } catch (e) {
                        console.error(e);
                        return Message.channel.send("```[PANEL] Failed to create channels. Check if the [Manage Channels] permission is granted.```");
                    }
                }

                if (content === '%chatsync setup') {
                    if (!Message.guildId) return Message.channel.send("```[ERROR] This command can only be used in a server```");
                    syncConfig.chatSyncGuildId = Message.guildId;
                    saveSyncConfig();
                    return Message.channel.send("```[SYSTEM] Chat Sync Server registered! Go to your chat channel and run `%setup` to link the channel.```");
                }
            } else {
                return;
            }
        }

        if (Message.guildId === panelConfig.panelGuildId) {

            if (Message.channelId === panelConfig.panelConsoleChannelId) {
                const input = Message.content.trim();
                const lowerInput = input.toLowerCase();
                
                await Message.delete().catch(() => {});

                const channel = client.channels.cache.get(panelConfig.panelConsoleChannelId);

                    if (lowerInput.startsWith('!')) {
                    const cmd = lowerInput.slice(1);
                    
                    if (cmd === 'start') {
                        handleConsoleUpdate(panelLog('INFO', startServer()));
                        return;
                    }
                    if (cmd === 'stop') {
                        handleConsoleUpdate(panelLog('INFO', stopServer()));
                        return;
                    }
                    if (cmd === `kill`) {
                        handleConsoleUpdate(panelLog('WARN', killServer()));
                        return;
                    }
                    if (cmd === 'restart') {
                        if (!mcProcess) {
                            handleConsoleUpdate(panelLog('ERROR', 'Server is offline'));
                            return;
                        }
                        isRestarting = true;
                        stopServer();
                        handleConsoleUpdate(panelLog('INFO', 'Restarting server...'));
                        return;
                    }
                    if (cmd.startsWith('send ')) {
                        const msg = Message.content.slice(6).trim();
                        if (!msg) {
                            handleConsoleUpdate(panelLog('ERROR', 'Usage: !send <message>'));
                            return;
                        }
                        if (mcProcess) {
                            mcProcess.stdin.write(`say ${msg}\n`);
                            handleConsoleUpdate(panelLog('INFO', `Broadcasted: ${msg}`));
                        } else {
                            handleConsoleUpdate(panelLog('ERROR', 'Server is offline'));
                        }
                        return;
                    }
                    // if (cmd === 'restart-whenempty') {
                    //     if (!mcProcess) {
                    //         handleConsoleUpdate(panelLog('ERROR', 'Server is offline'));
                    //         return;
                    //     }
                        
                    //     mcProcess.stdin.write('list\n');
                        
                    //     emptyRestartPending = true;
                        
                    //     mcProcess.stdin.write('say \u00a7e[Server] A restart has been scheduled for when the server is empty.\n');
                        
                    //     if (playerCount === 0) {
                    //         triggerEmptyRestart();
                    //     } else {
                    //         handleConsoleUpdate(panelLog('INFO', `Restart queued. Waiting for ${playerCount} players to leave.`));
                    //     }
                    //     return;
                    // }
                    if (cmd === 'status') {
                        handleConsoleUpdate(panelLog('INFO', `Server is ${mcProcess ? 'ONLINE' : 'OFFLINE'}`));
                        return;
                    }
                    
                    handleConsoleUpdate(panelLog('ERROR', 'Unknown command. Use !start, !stop, !restart, !kill, !status, !send'));
                    return;
                }

                if (mcProcess) {
                    mcProcess.stdin.write(input + '\n');
                } else {
                    handleConsoleUpdate(panelLog('ERROR', 'Server is offline'));
                }
                return;
            }

            if (Message.channelId === panelConfig.panelDashboardChannelId) {

            }

            if (Message.channelId === panelConfig.panelFilesChannelId) {
                const input = Message.content.trim().toLowerCase();
                await Message.delete().catch(() => {});

                if (!tuiState.lastMessageId) {
                    return startTui(Message.channel);
                }

                if (['q', 'a', 's', 'w'].includes(input)) {
                    return handleTuiInput(Message.channel, input);
                }
            }

            if (Message.channelId === panelConfig.panelFilesChannelId) {

            }
            return;
        }

        if (Message.content.startsWith(`%`)) {
            const args = Message.content.slice(1).trim().split(/ +/);
            const cmd = args.shift()?.toLowerCase();

            if (!cmd) return;

            if (cmd === 'cmdlock') {
                const isAllowed = Message.guild.ownerId === Message.author.id || 
                                Message.member.permissions.has('ManageGuild') || 
                                Message.member.permissions.has('Administrator');

                if (!isAllowed) {
                    if (syncConfig.cmdPermsUnmetPrompt === "true") {
                        return Message.reply(`You need the \`Manage Server\` permission to use this command.`);
                    }
                    return;
                }

                if (args.length === 0) {
                    const embed = new EmbedBuilder()
                        .setTitle('Command locks')
                        .addFields(
                            { name: 'setup', value: `\`${syncConfig.setupLocked}\``, inline: true },
                            { name: 'toggle', value: `\`${syncConfig.toggleLocked}\``, inline: true },
                            { name: 'cfg', value: `\`${syncConfig.cfgLocked}\``, inline: true },
                            { name: 'cap', value: `\`${syncConfig.capLocked}\``, inline: true },
                            { name: 'help', value: `\`${syncConfig.helpLocked}\``, inline: true },
                            { name: 'test', value: `\`${syncConfig.testLocked}\``, inline: true }
                        )
                        .setFooter({ text: 'Use %cmdlock <key> <true|false> to change a setting.' });
                    
                    return Message.reply({ embeds: [embed] });
                }

                const key = args[0]?.toLowerCase();
                const value = args[1]?.toLowerCase();
                const lockKey = `${key}Locked`;

                if (lockKey === 'cmdlockLocked') {
                    return Message.reply("You cannot change the permissions for `%cmdperms`.");
                }

                if (!(lockKey in syncConfig)) {
                    return Message.reply(`\`${key}\` is invalid.\nAvailable keys: \`setup\` \`toggle\` \`cfg\` \`cap\` \`help\` \`test\``);
                }

                if (!value || (value !== 'true' && value !== 'false')) {
                    return Message.reply('Value must be `true` (locked) or `false` (unlocked).');
                }   

                syncConfig[lockKey] = value;
                saveSyncConfig();
                return Message.reply(`Set \`${key}\` to \`${value}\`.`);
            }

            const cmdLockkey = `${cmd}Locked`;
            const cmdIsLocked = syncConfig[cmdLockkey] !== undefined ? syncConfig[cmdLockkey] : syncConfig.fallbackCmdLockState;

            if (cmdIsLocked === "true") {
                const cmdPermsAllowed = Message.guild.ownerId === Message.author.id || 
                                        Message.member.permissions.has('ManageGuild') || 
                                        Message.member.permissions.has('Administrator');
                
                if (!cmdPermsAllowed) {
                    if (syncConfig.cmdPermsUnmetPrompt === "true") {
                        return Message.reply(`The \`Manage Server\` permission is needed to use this command.`);
                    }
                    return;
                }
            }

            if (cmd === `setup`) {
                const select = new ChannelSelectMenuBuilder()
                    .setCustomId(`ch-select`)
                    .setPlaceholder(`Select channel to sync with Minecraft`)
                    .addChannelTypes(ChannelType.GuildText);
            
                const row = new ActionRowBuilder().addComponents(select);

                await Message.reply({
                    content: `**Set sync channel**`,
                    components: [row]
                });
                return;
            }

            if (cmd === `toggle`) {
                syncConfig.syncEnabled = !syncConfig.syncEnabled;
                saveSyncConfig();

                const status = syncConfig.syncEnabled ? "enabled" : "disabled";
                return Message.reply(`Chat sync is now ${status}`);
            }

            if (cmd === `test`) {
                const payload = JSON.stringify({
                    type: `discord_chat`,
                    username: `Debug`,
                    message: `Testing WebSocket connection... If you can see this message in Minecraft the connection is working!`
                });
                let sent = false;
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(payload);
                        sent = true;
                    }
                });

                if (sent) {
                    console.log('[Debug] Sent test message to Minecraft chat.');
                } else {
                    return console.log(`[Debug] No Minecraft server connected`);
                };
            }

            if (cmd === `cap`) {
                return handleCap(Message, args);
            }

            if (cmd === 'cfg') {
                if (!socketIsOpen()) {
                    return Message.reply(`Minecraft server not connected`);
                }

                if (!isConnected()) {
                    return Message.reply(`Connection initializing. Try again in a few seconds.`);
                }

                if (args.length === 0) {
                    if (!canSend(`config:configQuery`)) {
                        return Message.reply(`This mod version does not support reading configs.`);
                    }

                    const FEATURE_GROUPS = getGroups();  

                    const configPromise = new Promise((resolve, reject) => {
                        global.resolveConfigPromise = resolve;
                        setTimeout(() => {
                            if (global.resolveConfigPromise === resolve) {
                                global.resolveConfigPromise = null;
                                reject(new Error('timeout'));
                            }
                        }, 3000);
                    });

                    let sent = false;
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: "config" })); 
                            sent = true;
                        }
                    });

                    if (!sent) return Message.reply("Minecraft server not connected.");

                    try {
                        await configPromise;
                    } catch {
                        return Message.reply("The mod didn't respond to the config query in time. Try running `%cfg` again.");
                    }

                    const availableKeys = [...agreed]
                        .filter(f => f.startsWith('cfgKey:'))
                        .map(f => f.split(':')[1]);

                    let configText = '**Mod Config**\n';
                    for (const key of availableKeys) {
                        const val = syncConfig[key] !== undefined ? `\`${syncConfig[key]}\`` : 'unknown';
                        configText += `\`${key}\`: ${val}\n`;
                    }
                    
                    return Message.reply(configText);
                }

                if (!canSend(`config:configWrite`)) {
                    return Message.reply(`This mod version does not support writing configs.`);
                }

                const key = args[0];
                const valueStr = args[1];

                const availableKeys = [...agreed]
                    .filter(f => f.startsWith('cfgKey:'))
                    .map(f => f.split(':')[1]);

                if (!availableKeys.includes(key)) {
                    if (availableKeys.length === 0) {
                        return Message.reply("This mod does not expose any config keys to change.");
                    }
                    return Message.reply(`Invalid key. Available keys: ${availableKeys.map(k => `\`${k}\``).join(', ')}`);
                }

                if (valueStr !== 'true' && valueStr !== 'false') {
                    return Message.reply("Value must be `true` or `false`.");
                }

                const value = valueStr === 'true';

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: "config",
                            key: key,
                            value: value
                        }));
                    }
                });

                return Message.reply(`Set \`${key}\` to **${value}**.`);
            }

        if (cmd === 'help') {
            const lines = ['`setup` — Choose the channel to sync with Minecraft'];
            if (canSend('config:configQuery') || canSend('config:configWrite')) {
                lines.push('`cfg` — Show or change config');
            }
            lines.push(
                '`toggle` — Toggles the chat sync on or off',
                '`help` — Displays this message',
                '`cap` — Show what this mod supports',
            );
            return Message.reply('## Help\n' + lines.join('\n'));
        }

            else {
                const lines = ['### Invalid command\n**Usage**\n`setup` — Choose the channel to sync with Minecraft'];
                if (canSend('config:configQuery') || canSend('config:configWrite')) {
                    lines.push('`cfg` — Show or change config');
                }
                lines.push(
                    '`toggle` — Toggles the chat sync on or off',
                    '`help` — Displays this message',
                    '`cap` — Show what this mod supports',
                );
                return Message.reply(lines.join('\n'));
            }
        }

        else {
            if (!syncConfig.syncEnabled) return;
            if (!syncConfig.chatSyncChannel || Message.channel.id !== syncConfig.chatSyncChannel) return;

            if (!socketIsOpen()) {
                return Message.reply(`Your message could not be delivered because the Minecraft server is disconnected. Please try again later or contact the server administrator.`);
            }

            if (!isConnected()) {
                return Message.reply(`Your message could not be delivered because the connection to the Minecraft server is initializing. Please try again after a few seconds.`);
            }

            if (!canSend(`core:discord_chat`)) {
                return Message.reply(`Your message could not be delivered because there was an unexpected error. Please contact the server administrator.`)
            }

            let displayName = Message.member ? Message.member.displayName : Message.author.username;
            if (displayName.length > 16) displayName = displayName.slice(0, 13) + '...';

            let messageText = Message.content;

            if (Message.attachments.size > 0 ) {
                if (messageText) {
                    messageText += ` [Sent: ${Message.attachments.first().name}]`;
                }

                else {
                    messageText = `[Sent: ${Message.attachments.first().name}]`;
                }
            }

            const payload = JSON.stringify({
                type: 'discord_chat',
                username: displayName,
                message: messageText
            });

            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(payload);
                }
            });
        }
    })

    readConfigs();

    const wss = new WebSocket.Server({ port: syncConfig.websocketPort });
    console.log(`[WebSocket] Server started on port ${syncConfig.websocketPort}`);

    wss.on(`connection`, (ws) => {
        console.log(`[WebSocket] WebSocket connected`)

        negotiated = false;
        v01 = false;
        agreed = new Set();
        modInfo = { modVersion: null, mcVersion: null, schema: null };
        modUnknownFeatures = [];

            ws.send(JSON.stringify({
                type: `cap`,
                schema: 1,
                features: capabilities,
            }));

            const capSyncTimer = setTimeout(() => {
                if (negotiated) return;
                v01 = true;
                agreed = new Set(core_capabilities);
                modInfo = {modVersion: `0.1.x`, mcVersion: `unknown`, schema: null};
                console.log(`[WebSocket] Mod capabilities not recieved in time. Falling back to core (v0.1) features)`)
            }, 4000);
        
            ws.on('message', async (data) => {
            try {
                const payload = JSON.parse(data);

                if (!syncConfig.syncEnabled) return;
                
                if (payload.type === `cap`) {
            clearTimeout(capSyncTimer);
            v01 = false;
            negotiated = true;
        
                const modFeatures = payload.features || [];
                    
                    agreed = new Set(capabilities.filter(f => modFeatures.includes(f)));
                    
                    for (const feature of modFeatures) {
                        if (feature.startsWith('cfgKey:')) {
                            agreed.add(feature);
                        }
                    }

                    modUnknownFeatures = modFeatures.filter(f => !capabilities.includes(f) && !f.startsWith('cfgKey:'));
        
            modInfo = {
                modVersion: payload.modVersion ?? 'unknown',
                mcVersion: payload.mcVersion ?? 'unknown',
                schema: payload.schema ?? null
            };
        
            console.log(`[WebSocket] Mod ${modInfo.modVersion}. Agreed ${agreed.size}/${capabilities.length} features.`);
            if (modUnknownFeatures.length > 0) {
                console.log(`[WebSocket] Mod supports ${modUnknownFeatures.length} unknown feature(s): ${modUnknownFeatures.join(', ')}`);
            }
            return;
        }
                if (payload.type === 'config_sync') {
                    for (const [key, value] of Object.entries(payload)) {
                        if (key !== 'type') {
                            syncConfig[key] = value;
                        }
                    }
                    
                    console.log(`[WebSocket] Config recieved from Minecraft.`);
                    
                    if (global.resolveConfigPromise) {
                        global.resolveConfigPromise();
                        global.resolveConfigPromise = null;
                    }
                    return;
                }

                if (!syncConfig.chatSyncChannel) return;
                const channel = client.channels.cache.get(syncConfig.chatSyncChannel);
                if (!channel) return;

                console.log(`[WebSocket] Recieved from Minecraft: {Type: ${payload.type} Username:${payload.username} Message:${payload.message}}`);

                if (payload.type === 'chat') {
                    if (!syncConfig.chatWebhookUrl) return; 

                    await fetch(syncConfig.chatWebhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: payload.username,
                            avatar_url: `https://mc-heads.net/avatar/${payload.uuid}`,
                            content: `${payload.message}`
                        })
                    });
                }
                
                else if (payload.type === 'join' || payload.type === `leave`) {
                    if (!syncConfig.serverWebhookUrl) return; 

                    await fetch(syncConfig.serverWebhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: `Server message:`,
                            content: `${payload.username} ${payload.message}`
                        })
                    });
                }

                else if (payload.type === 'death') {
                    if (!syncConfig.serverWebhookUrl) return; 

                    await fetch(syncConfig.serverWebhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: `Server message:`,
                            content: `${payload.message}`
                        })
                    });
                }

                else if (payload.type === 'advancement') {
                    if (!syncConfig.serverWebhookUrl) return; 

                    await fetch(syncConfig.serverWebhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: `Server message:`,
                            content: `${payload.username} ${payload.message}`
                        })
                    });
                }

                else {
                    console.log(`[Error] Unknown message type: ${payload.type}`);
                }

            } catch (err) {
                console.error(`[Error] Failed to process message:`, err);
            }
        
        });
        
        ws.on('close', () => {
            clearTimeout(capSyncTimer);
            negotiated = false;
            v01 = false;
            agreed = new Set();
            modInfo = { modVersion: null, mcVersion: null, schema: null };
            console.log('[WebSocket] WebSocket disconnected');
        });
    });

    wss.on(`error`, (err) => {
        console.log(`[Error] WebSocket error`, err)
    });

    process.on(`unhandledRejection`, (reason, promise) => {
        console.error(`[ERROR] Unhandled rejection at ${promise}. Reason: ${reason}`);
    });

    process.on(`uncaughtException`, (err) => {
        console.error(`[ERROR] Uncaught exception: ${err}`);
    });

    client.login(process.env.DISCORD_TOKEN);