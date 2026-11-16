const { Client, GatewayIntentBits, Message, ChannelSelectMenuBuilder, ChannelType, ActionRowBuilder, EmbedBuilder, messageLink } = require('discord.js');
const WebSocket = require('ws');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const pingModule = import('mc-server-ping');
const si = require(`systeminformation`);
const http = require('http');
const url = require('url');
const nbt = require(`prismarine-nbt`);
const sharp = require('sharp');
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
    panelServerUseSigterm: "true",
    panelServerSigtermTimeout: "20",
    panelServerUseSigkill: "false",
    panelServerSigKillTimeout: "",
    panelTickInterval: "1.5",
    panelWebPort: "8080",
    panelWebPassword: "password",
    panelChatSyncCacheChannelId: "",
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

const backupRulesDir = path.join(__dirname, `BackupRules`);

let consoleLines = [];
let lastSentConsoleString = "";
let isSendingConsoleMessage = false;

let mcProcess = null;
let isRestarting = false;
let canAcceptCommands = true;
let currentState = "Offline";
let hasBeenOnline = false

let syncConfig = {};
let panelConfig = {};

let onlinePlayers = 0;
let maxPlayers = 0;
let playerList = [];
let serverStartTime = null;
let panelTickInterval = null;

let lastDashboardString = "";

let remainingRecoveryAttempts = 3;

let fileMenuState = {
    action: null,
    files: [],
    currentDir: "",
    selectedFile: "",
    pendingConfirm: null,
    isShowingPopup: false
};

async function panelTick() {
    if (panelConfig.panelConsoleChannelId) {
    await sendDiscordConsole();
    }
    if (panelConfig.panelDashboardChannelId) {
        await updateDashboard();
    }
    if (panelConfig.panelFilesChannelId) {
        await refreshFileMenu();
    }
    // if (panelConfig.panelBackupsChannelId) {
    //     await refreshBackupMenu();
    // }
}

function safeCodeBlock(text, maxLength = 4000, language = '') {
    if (!text) return `\`\`\`${language}\n(Empty)\n\`\`\``;
    let safeText = text;
    if (safeText.length > maxLength) {
        safeText = safeText.substring(0, maxLength - 15) + "\n...[TRUNCATED]";
    }
    return `\`\`\`${language}\n${safeText}\n\`\`\``;
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

async function sendNotification(channelId, message) {
    if (!channelId) return;
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    try {
        const msg = await channel.send(message);
        
        setTimeout(() => {
            msg.delete().catch(() => {});
        }, 1000);
    } catch (err) {
        console.error("Failed to send notification:", err);
    }
}




// Console




function startServer() {
    if (mcProcess) return `Server is already running`;

    canAcceptCommands = true;
    isStopping = false;
    serverStartTime = Date.now();
    currentState = "Starting"

    if (!panelConfig.panelServerDirectory) {
        return " Server directory is not configured in panel-config.json";
    }

    readConfigs();

    const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
    const startCmd = panelConfig.panelServerStartCmd;
    console.log(startCmd)
    mcProcess = spawn(startCmd, [], { 
        cwd: serverDir,
        shell: true,
        detached: true,
        stdio: [`pipe`, `pipe`, `pipe`],
    });

    mcProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
            
        for (const line of lines) {
            if (!line.trim()) continue;
            console.log(line);
                
            if (line.includes(`Done (`) || line.toLowerCase().includes(`for help, type`)){
                currentState = `Online`;
            }

            handleConsoleUpdate(colorizeMinecraftLine(line)); 
        }
    });

    mcProcess.stderr.on('data', (data) => {
        console.error(`${data}`);
        handleConsoleUpdate(colorizeMinecraftLine(`${data.toString().trim()}`));
    });
        
          mcProcess.on('exit', (code, signal) => {
        clearTimeout(stopTimer);
        clearTimeout(killTimer);
        isStopping = false;
        canAcceptCommands = true;
        onlinePlayers = 0;
        maxPlayers = 0;
        playerList = [];
        
        const uptimeMs = Date.now() - serverStartTime;
        const uptimeMinutes = Math.floor(uptimeMs / 60000);

        console.log(`[MC] exit event — code=${JSON.stringify(code)} signal=${JSON.stringify(signal)}`);
        mcProcess = null;

        const isCleanStop = (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT' || signal === 'SIGKILL');

        if (isCleanStop) {
            currentState = "Offline";
            if (signal) {
                handleConsoleUpdate(panelLog('WARN', `Server stopped with signal ${signal}`));
            } else {
                handleConsoleUpdate(panelLog('INFO', `Server stopped with code ${code}`));
            }
            
            remainingRecoveryAttempts = parseInt(panelConfig.panelServerMaxRecoveryAttempts) || 3;
            
            if (isRestarting) {
                isRestarting = false;
                const delayMs = (parseInt(panelConfig.panelServerRecoveryTimeout) || 10) * 1000;
                setTimeout(startServer, delayMs);
            }
            return;
        }

        currentState = "Crashed";
        handleConsoleUpdate(panelLog('ERROR', `Server crashed with code ${code} and signal ${signal}.`));
        sendNotification(panelConfig.panelConsoleChannelId, `Server crashed! code ${code}`)

        if (uptimeMinutes >= 2) {
            remainingRecoveryAttempts = parseInt(panelConfig.panelServerMaxRecoveryAttempts) || 3;
            handleConsoleUpdate(panelLog('INFO', `Server ran for ${uptimeMinutes}m before crashing. Resetting recovery attempts.`));
        }

        if (panelConfig.panelServerCrashRecovery === "true") {
            remainingRecoveryAttempts--;
            
            if (remainingRecoveryAttempts > 0) {
                const delayMs = (parseInt(panelConfig.panelServerRecoveryTimeout) || 10) * 1000;
                handleConsoleUpdate(panelLog('WARN', `Attempting crash recovery... (${remainingRecoveryAttempts} attempts left)`));
                
                setTimeout(() => {
                    if (currentState === "Crashed") currentState = "Starting";
                    startServer();
                }, delayMs);
            } else {
                handleConsoleUpdate(panelLog('WARN', `Max recovery attempts reached. Server will stay offline.`));
            }
        }
    });
    return `Starting server...`
}


let stopTimer = null;
let killTimer = null;
let isStopping = false;

function stopServer() {
    if (!mcProcess) return "Server is not running.";
    if (isStopping) return "Server is already stopping.";

    canAcceptCommands = false;
    
    isStopping = true;

    const proc = mcProcess;
    const pid = proc.pid;
    const stopCmd = panelConfig.panelServerStopCmd || "stop";

    clearTimeout(stopTimer);
    clearTimeout(killTimer);

    if (stopCmd.toLowerCase() === 'kill') {
        return killServer();
    }

    try {
        if (proc.stdin && !proc.stdin.destroyed) {
            proc.stdin.write(stopCmd + '\n');
        }
    } catch (err) {
        handleConsoleUpdate(panelLog('WARN', `Failed to write to stdin: ${err.message}`));
    }

    const useSigterm = panelConfig.panelServerUseSigterm !== "false";
    const sigtermTimeout = parseInt(panelConfig.panelServerSigtermTimeout) || 20;
    
    const useSigkill = panelConfig.panelServerUseSigkill === "true";
    const sigkillTimeout = parseInt(panelConfig.panelServerSigKillTimeout) || 15;

    if (useSigterm) {
        stopTimer = setTimeout(() => {
            if (mcProcess !== proc) return;
            
            handleConsoleUpdate(panelLog('WARN', `Server didn't exit with stop command. Sending SIGTERM to pid ${pid}...`));
            
            try { process.kill(pid, 'SIGTERM'); } catch (e) {
                handleConsoleUpdate(panelLog('ERROR', `SIGTERM failed: ${e.message}`));
            }

            if (useSigkill) {
                killTimer = setTimeout(() => {
                    if (mcProcess !== proc) return;
                    
                    handleConsoleUpdate(panelLog('ERROR', `Server didn't exit after SIGTERM. Sending SIGKILL to pid ${pid}...`));
                    
                    try {
                        if (process.platform === 'win32') {
                            spawn('taskkill', ['/pid', String(pid), '/f', '/t']);
                        } else {
                            process.kill(-pid, 'SIGKILL');
                        }
                    } catch (e) {}
                }, sigkillTimeout * 1000);
            }
        }, sigtermTimeout * 1000);
    }

    return "Stopping server...";
}

function killServer() {
    if (!mcProcess) return "Server is not running.";

    canAcceptCommands = false;
    
    clearTimeout(stopTimer);
    clearTimeout(killTimer);
    
    const pid = mcProcess.pid;
    
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(pid), '/f', '/t']);
        } else {
            process.kill(-pid, 'SIGKILL');
        }
    } catch (err) {
        try { mcProcess.kill('SIGKILL'); } catch (e) {}
    }
    
    return "Killed server and its child processes.";
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
                isSendingConsoleMessage = false;
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

async function getHardwareStats() {
    try {
        const cpuLoad = await si.currentLoad();
        const mem = await si.mem();

        const cpuPercent = cpuLoad.currentLoad.toFixed(1);
        const memUsed = ((mem.total - mem.available) / 1e9).toFixed(1);
        const memTotal = (mem.total / 1e9).toFixed(1);

        const cpuColor = cpuPercent > 90 ? '\u001b[31m' : cpuPercent > 70 ? '\u001b[33m' : '\u001b[32m';
        const memPercent = ((mem.total - mem.available) / mem.total) * 100;
        const ramColor = memPercent > 90 ? '\u001b[31m' : memPercent > 70 ? '\u001b[33m' : '\u001b[32m';

       return `${cpuColor}CPU: ${cpuPercent}%\u001b[0m | ${ramColor}RAM: ${memUsed}/${memTotal}GB\u001b[0m`;
    } catch (err) {
        return "Performance stats unavailable.";
    }
}




// DASHBOARD




async function updateDashboard() {
    const channel = client.channels.cache.get(panelConfig.panelDashboardChannelId);
    if (!channel) return;

    let status = { online: false };
    
    if (mcProcess && currentState !== "Starting") {
        status = await pingServer('127.0.0.1', 25565); 

        if (!status.online && hasBeenOnline) {
            currentState = "Disconnected";
        } else if (status.online) {
            currentState = "Online";
            hasBeenOnline = true;
        }
    }

    let statusColor = 0xff0000; 
    let stateDisplay = "";
    
    if (currentState === "Online") {
        statusColor = 0x00cc66;
        stateDisplay = `\u001b[32m[ ONLINE ]\u001b[0m`;
    } else if (currentState === "Starting") {
        statusColor = 0xffcc00;
        stateDisplay = `\u001b[33m[ STARTING ]\u001b[0m`;
    } else if (currentState === "Disconnected") {
        statusColor = 0xffcc00;
        stateDisplay = `\u001b[33m[ DISCONNECTED ]\u001b[0m`;
    } else if (currentState === "Crashed") {
        statusColor = 0xff0000;
        stateDisplay = `\u001b[31m[ CRASHED ]\u001b[0m`;
    } else {
        statusColor = 0xff0000;
        stateDisplay = `\u001b[31m[ OFFLINE ]\u001b[0m`;
    }

    let text = `${stateDisplay}\n`;

    if (mcProcess) {
        let uptimeString = "0s";
        if (serverStartTime > 0) {
            let previousUptimeString = uptimeString;
            const uptimeMs = Date.now() - serverStartTime;
            const hours = Math.floor(uptimeMs / 3600000);
            const minutes = Math.floor((uptimeMs % 3600000) / 60000);
            const seconds = Math.floor((uptimeMs % 60000) / 1000);
            if (hours > 0) {
                uptimeString = `${hours}h ${minutes}m ${seconds}s`;
            }
            if (minutes > 0) {
                uptimeString = `${minutes}m ${seconds}s`;
            } else {
                uptimeString = `${seconds}s`
            }
        }
        
        text += `[ UPTIME ] ${uptimeString}\n`;

        if (status.online) {
            let playerCount = status.players.online;
            let maxPlayers = status.players.max;
            let motdFormatted = status.motd ? status.motd.replace(/§./g, '') : 'Not ';
            let playerListText = 'Not available';
            
            if (status.players.sample && status.players.sample.length > 0) {
                playerListText = status.players.sample.map(p => p.name).join(', ');
            }

            text += `[ PLAYERS ] ${playerCount} / ${maxPlayers}\n\n` +
                    `[ MOTD ]\n${motdFormatted}\n\n` +
                    `[ PLAYER LIST ]\n${playerListText}`;
        } else {
            text += `[ PLAYERS ] N/A\n\n` +
                    `[ MOTD ]\nN/A\n\n` +
                    `[ PLAYER LIST ]\nN/A`;
        }

        const hw = await getHardwareStats();
        if (hw) {
            text += `\n\n[ PERF ]\n${hw}`;
        }
    }

    if (text === lastDashboardString) return;
    lastDashboardString = text;

    const embed = new EmbedBuilder()
        .setColor(statusColor)
        .setDescription(safeCodeBlock(text, 3900, 'ansi'));

    try {
        if (panelConfig.panelDashboardMessageId) {
            const msg = await channel.messages.fetch(panelConfig.panelDashboardMessageId).catch(() => null);
            if (msg) {
                await msg.edit({ embeds: [embed] });
                return;
            }
        }
        
        const newMsg = await channel.send({ embeds: [embed] });
        panelConfig.panelDashboardMessageId = newMsg.id;
        savePanelConfig();
    } catch (err) {
        if (err.code === 10008 || err.status === 429) { 
            panelConfig.panelDashboardMessageId = ""; 
            savePanelConfig();
        }
    }
}

async function pingServer(host, port = 25565) {
    try {
        const { ping } = await pingModule;
        const result = await ping(host, { port: port, timeout: 3000 });
        return result;
    } catch (error) {
        return { online: false };
    };
}




// Backup




// function renderBackupMenu() {
//     let prompt = `[ BACKUPS ]\n`;
//     prompt += `Select a backup rule to run\n`;
//     prompt += `-------------------------\n`;
    
//     if (backupMenuState.rules.length === 0) {
//         prompt += `(No backup rules configured)\n`;
//     } else {
//         backupMenuState.rules.forEach((rule, index) => {
//             const num = String(index + 1).padStart(2, '0');
//             prompt += `[${num}] ${rule.name}\n`;
//             prompt += `     Targets: ${rule.targets.join(', ')}\n`;
//             prompt += `     Keeps: ${rule.maxBackups}\n`;
//         });
//     }
    
//     return safeCodeBlock(prompt, 3900, 'ini');
// }

// async function refreshBackupMenu() {
//     readConfigs();
//     if (!panelConfig.panelBackupsChannelId || !panelConfig.panelBackupsMessageId) return;
//     if (backupMenuState.pendingConfirm) return;
//     if (backupMenuState.isShowingPopup) return; 

//     const channel = client.channels.cache.get(panelConfig.panelBackupsChannelId);
//     if (!channel) return;

//     const menuMsg = await channel.messages.fetch(panelConfig.panelBackupsMessageId).catch(() => null);
//     if (!menuMsg) return;

//     backupMenuState.rules = loadBackupRules();
    
//     const newText = renderBackupMenu();
//     if (menuMsg.content !== newText) {
//         await menuMsg.edit(newText).catch(() => {});
//     }
// }

// function renderBackupConfirm(rule) {
//     let prompt = `[ BACKUP:INFO ]\n`;
//     prompt += `-------------------------\n`;
//     prompt += `Are you sure you want to run ${rule.name}?\n\n`;
//     prompt += `>> Targets: ${rule.targets.join(', ')}\n\n`;
//     prompt += `[Y/n]`;
    
//     return safeCodeBlock(prompt, 3900, 'ini');
// }

// let isBackingUp = false;

// async function createBackup(ruleId) {
//     if (isBackingUp) return "A backup is already in progress.";

//     const rules = loadBackupRules();
//     const rule = rules.find(r => r.id === ruleId);
//     if (!rule) return "Rule not found.";

//     isBackingUp = true;
    
//     const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
//     const backupDir = path.resolve(serverDir, rule.destination);
    
//     if (!fs.existsSync(backupDir)) {
//         fs.mkdirSync(backupDir, { recursive: true });
//     }

//     const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
//     const backupFile = path.join(backupDir, `${rule.id}-${timestamp}.tar.gz`);

//     handleConsoleUpdate(panelLog('INFO', `Starting full server backup: ${rule.name}...`));
    
//     if (mcProcess) {
//         mcProcess.stdin.write('save-all flush\n');
//         await new Promise(r => setTimeout(r, 3000));
//     }

//     handleConsoleUpdate(panelLog('INFO', `Compressing entire server directory...`));

//     return new Promise((resolve, reject) => {
//         const command = `tar -czf "${backupFile}" --exclude="${rule.destination}" .`;

//         spawn(command, { cwd: serverDir }, (error, stdout, stderr) => {
//             if (error) {
//                 isBackingUp = false;
//                 handleConsoleUpdate(panelLog('ERROR', `Backup failed: ${error.message}`));
//                 return reject(error);
//             }

//             const stats = fs.statSync(backupFile);
//             const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
//             handleConsoleUpdate(panelLog('INFO', `Backup complete: ${path.basename(backupFile)} (${sizeMB} MB)`));

//             const files = fs.readdirSync(backupDir)
//                 .filter(f => f.endsWith('.tar.gz') || f.endsWith('.zip')) // Support both
//                 .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
//                 .sort((a, b) => a.time - b.time);

//             while (files.length > rule.maxBackups) {
//                 const oldest = files.shift();
//                 fs.unlinkSync(path.join(backupDir, oldest.name));
//                 handleConsoleUpdate(panelLog('WARN', `Deleted old backup: ${oldest.name}`));
//             }

//             isBackingUp = false;
//             resolve(`Backup complete: ${sizeMB} MB`);
//         });
//     });
// }

// function loadBackupRules() {
//     if (!fs.existsSync(backupRulesDir)) {
//         fs.mkdirSync(backupRulesDir, { recursive: true });
        
//         const defaultRule = {
//             id: "world",
//             targets: ["world", "world_nether", "world_the_end"],
//             destination: "./backups/world",
//             maxBackups: 7
//         };
//         fs.writeFileSync(path.join(backupRulesDir, 'world.json'), JSON.stringify(defaultRule, null, 2));
//     }

//     const files = fs.readdirSync(backupRulesDir).filter(f => f.endsWith('.json'));
//     const rules = [];

//     for (const file of files) {
//         try {
//             const data = JSON.parse(fs.readFileSync(path.join(backupRulesDir, file), 'utf-8'));
            
//             const baseName = path.basename(file, '.json');
            
//             rules.push({
//                 id: baseName,
//                 name: baseName.replace(/_/g, ' '),
//                 targets: data.targets || ["world"],
//                 destination: data.destination || `./backups/${baseName}`,
//                 maxBackups: data.maxBackups || 5
//             });
//         } catch (e) {
//             console.error(`Failed to parse backup rule ${file}:`, e.message);
//         }
//     }
    
//     isBackingUp = false
//     return rules;
// }

// let backupMenuState = {
//     rules: [],
//     pendingConfirm: null,
//     isShowingPopup: false
// };

// async function initBackupMenu() {
//     if (!panelConfig.panelBackupsChannelId) return;
    
//     const channel = client.channels.cache.get(panelConfig.panelBackupsChannelId);
//     if (!channel) return;

//     backupMenuState.rules = loadBackupRules();

//     try {
//         if (panelConfig.panelBackupsMessageId) {
//             const msg = await channel.messages.fetch(panelConfig.panelBackupsMessageId).catch(() => null);
//             if (msg) {
//                 await msg.edit(renderBackupMenu());
//                 return;
//             }
//         }
        
//         const newMsg = await channel.send(renderBackupMenu());
//         panelConfig.panelBackupsMessageId = newMsg.id;
//         savePanelConfig();
//     } catch (err) {
//         console.error("Failed to send backup menu message:", err);
//     }
// }

async function refreshFileMenu() {
    readConfigs();
    if (!panelConfig.panelFilesChannelId || !panelConfig.panelFilesMessageId) return;
    if (fileMenuState.pendingDelete) return;
    if (fileMenuState.isShowingPopup) return; 
    if (fileMenuState.action) return;

    const channel = client.channels.cache.get(panelConfig.panelFilesChannelId);
    if (!channel) return;

    const menuMsg = await channel.messages.fetch(panelConfig.panelFilesMessageId).catch(() => null);
    if (!menuMsg) return;

    loadFiles();
    
    const newText = renderFileMenu();
    if (menuMsg.content !== newText) {
        await menuMsg.edit(newText).catch(() => {});
    }
}

function loadFiles() {
    const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
    const targetDir = path.join(serverDir, fileMenuState.currentDir);
    
    try {
        const dir = fs.readdirSync(targetDir, { withFileTypes: true });
        fileMenuState.files = dir.map(dirent => ({
            name: dirent.name,
            isDir: dirent.isDirectory()
        })).sort((a, b) => {
            if (a.isDir && !b.isDir) return -1;
            if (!a.isDir && b.isDir) return 1;
            return a.name.localeCompare(b.name);
        });
    } catch (e) {
        fileMenuState.files = [];
        fileMenuState.currentDir = "";
    }
}

async function initFileMenu() {
    if (!panelConfig.panelFilesChannelId) return;
    
    const channel = client.channels.cache.get(panelConfig.panelFilesChannelId);
    if (!channel) return;

    loadFiles();

    try {
        if (panelConfig.panelFilesMessageId) {
            const msg = await channel.messages.fetch(panelConfig.panelFilesMessageId).catch(() => null);
            if (msg) {
                await msg.edit(renderFileMenu());
                return;
            }
        }
        
        const newMsg = await channel.send(renderFileMenu());
        panelConfig.panelFilesMessageId = newMsg.id;
        savePanelConfig();
    } catch (err) {
        console.error("Failed to send file menu message:", err);
    }
}

function renderFileMenu() {
    let prompt = `[ ACTIONS ]\n`;
    
    if (fileMenuState.currentDir !== "") {
        prompt += `[B] Go Back\n`;
    }
    prompt += `[D] Delete\n`;
    prompt += `[R] Rename\n`;
    // prompt += `[S] Size\n`;
    prompt += `[ FILES ]\n`;
    prompt += `Path: /${fileMenuState.currentDir}\n\n`;
    
    if (fileMenuState.files.length === 0) {
        prompt += `(Empty folder)\n`;
    } else {
        fileMenuState.files.forEach((file, index) => {
            const num = String(index + 1).padStart(2, '0');
            const displayName = file.isDir ? `${file.name}/` : (file.name ? file.name : ` `);
            prompt += `[${num}] ${displayName}\n`;
        });
    }
    
    return safeCodeBlock(prompt, 3900, 'ini');
}

function renderActionMenu(actionTitle) {
    let prompt = `[ ${actionTitle} ]\n`;
    prompt += `Path: /${fileMenuState.currentDir}\n`;
    prompt += `Select a number below, or [Q] to cancel.\n\n`;
    
    prompt += `[ CONTENTS ]\n`;
    if (fileMenuState.files.length === 0) {
        prompt += `(Empty folder)\n`;
    } else {
        fileMenuState.files.forEach((file, index) => {
            const num = String(index + 1).padStart(2, '0');
            const displayName = file.isDir ? `${file.name}/` : file.name;
            prompt += `[${num}] ${displayName}\n`;
        });
    }
    
    return safeCodeBlock(prompt, 3900, 'ini');
}

function renderConfirmMenu(action, item) {
    let prompt = `[ CONFIRM:${action} ]\n`;
    prompt += `-------------------------\n`;
    if (item.isDir) {
        prompt += `This is a directory. Deleting it will also delete ALL files in it.\n\n`
    }
    prompt += `Are you sure you want to ${action.toLowerCase()} ${item.name}${item.isDir ? `/` : ``}?\n`;
    prompt += `[Y/n]`;
    
    return safeCodeBlock(prompt, 3900, 'ini');
}



// Players




// async function readPlayerData(uuid) {
//     const filePath = path.join(`${panelConfig.panelServerDirectory}` + `world/` + `playerdata/` + uuid + `.dat`);
//     console.log (filePath);
//     const buffer = fs.readFileSync(filePath)
//     const parsedData = await nbt.parse(buffer);
//     console.log(parsedData)
//     return parsedData.parsed
// }

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


const skinCache = new Map();
const MAX_SKIN_CACHE = 100;
const CHECK_INTERVAL = 15 * 60 * 1000;

async function getDiscordCachedSkin(username, uuid) {
    const cached = skinCache.get(username);

    if (cached && (Date.now() - cached.lastChecked < CHECK_INTERVAL)) {
        return cached.url;
    }

    let cacheChannel = client.channels.cache.get(panelConfig.panelChatSyncCacheChannelId);
    if (!cacheChannel) {
        cacheChannel = await client.channels.fetch(panelConfig.panelChatSyncCacheChannelId).catch(() => null);
    }

    if (!cacheChannel) {
        return `https://crafatar.com/avatars/${encodeURIComponent(username)}?overlay`;
    }

    try {
        let realUuid = uuid.replace(/-/g, '');
        if (realUuid.length !== 32) {
            const lookup = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
            if (!lookup.ok) throw new Error("Player not found");
            const lookupData = await lookup.json();
            realUuid = lookupData.id;
        }

        const mojangRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${realUuid}`);
        if (!mojangRes.ok) throw new Error("Profile not found");
        const profile = await mojangRes.json();
        
        const texturesProp = profile.properties.find(p => p.name === 'textures');
        if (!texturesProp) throw new Error("No textures");
        
        const decoded = JSON.parse(Buffer.from(texturesProp.value, 'base64').toString('utf-8'));
        const newMojangUrl = decoded.textures.SKIN.url;

        if (cached && cached.mojangUrl === newMojangUrl) {
            cached.lastChecked = Date.now();
            return cached.url;
        }

        const skinRes = await fetch(newMojangUrl);
        const buffer = Buffer.from(await skinRes.arrayBuffer());

        const baseHead = await sharp(buffer)
            .extract({ left: 8, top: 8, width: 8, height: 8 })
            .resize(128, 128, { kernel: 'nearest' })
            .toBuffer();

        const hatLayer = await sharp(buffer)
            .extract({ left: 40, top: 8, width: 8, height: 8 })
            .resize(128, 128, { kernel: 'nearest' })
            .toBuffer();

        const composited = await sharp(baseHead)
            .composite([{ input: hatLayer, blend: 'over' }])
            .toBuffer();

        const headBuffer = await sharp(composited)
            .extend({
                top: 26,
                bottom: 26,
                left: 26,
                right: 26,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toFormat('png')
            .toBuffer();

        if (cached) {
            const messages = await cacheChannel.messages.fetch({ limit: 100 });
            const oldMsg = messages.find(m => m.content === `Skin cache for: ${username}`);
            if (oldMsg) await oldMsg.delete().catch(() => {});
        }

        const msg = await cacheChannel.send({ 
            content: `Skin cache for: ${username}`, 
            files: [{ attachment: headBuffer, name: `${username}.png` }] 
        });

        const cleanCdnUrl = msg.attachments.first().url.split('?')[0];
        
        skinCache.set(username, { 
            url: cleanCdnUrl, 
            lastChecked: Date.now(),
            mojangUrl: newMojangUrl
        });

        if (skinCache.size > MAX_SKIN_CACHE) {
            const firstKey = skinCache.keys().next().value;
            skinCache.delete(firstKey);
        }

        return cleanCdnUrl;

    } catch (err) {
        console.error(`[Skin Cache Error] ${username}:`, err.message);
        return `https://crafatar.com/avatars/${encodeURIComponent(username)}?overlay`;
    }
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
                                        `================\n`+
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

        client.once('clientReady', async () => {
        console.log(`[Discord] Logged in as ${client.user.tag}`);

        if (panelTickInterval) clearInterval(panelTickInterval);
        panelTickInterval = setInterval(panelTick, panelConfig.panelTickInterval*1000); 
        
        initFileMenu();
        setTimeout(updateDashboard, 2000);

                const cacheChannel = client.channels.cache.get(panelConfig.panelChatSyncCacheChannelId);
        if (cacheChannel) {
            try {
                const messages = await cacheChannel.messages.fetch({ limit: MAX_SKIN_CACHE });
                messages.forEach(msg => {
                    if (msg.attachments.size > 0) {
                        const match = msg.content.match(/Skin cache for: (.*)/);
                        if (match && match[1]) {
                            const username = match[1];
                            const cleanUrl = msg.attachments.first().url.split('?')[0];

                            skinCache.set(username, { 
                                url: cleanUrl, 
                                lastChecked: 0,
                                mojangUrl: null
                            });
                        }
                    }
                });
                console.log(`[Cache] Loaded ${skinCache.size} skins from Discord.`);
            } catch (err) {
                console.error("Failed to load skin cache:", err.message);
            }
        }});

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

                    const bypassLock = (cmd === `kill` || cmd === `status`)
                    if (!canAcceptCommands && !bypassLock) {
                        return handleConsoleUpdate(panelLog('WARN', `Server is busy, cannot accept commands right now.`));
                    }

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
                    if (cmd === `clear`) {
                        consoleLines = [];
                        handleConsoleUpdate(panelLog(`INFO`, `Cleared console`));
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
                    if (cmd === `save`) {
                        if (!mcProcess) {
                            return handleConsoleUpdate(panelLog(`ERROR`, `Server is offline`));
                        }
                        mcProcess.stdin.write(`save-all flush\n`)
                        return handleConsoleUpdate(panelLog(`INFO`, `Saving world...`))
                    }
                    
                    handleConsoleUpdate(panelLog('ERROR', 'Unknown command. Use !start, !stop, !restart, !kill, !status, !send, !clear'));
                    return;
                }

                if (mcProcess) {
                    mcProcess.stdin.write(input + '\n');
                } else {
                    handleConsoleUpdate(panelLog('ERROR', 'Server is offline'));
                }
                return;
            }

            // if (Message.channelId === panelConfig.panelBackupsChannelId) {
            //     const input = Message.content.trim();
            //     const firstChar = input.charAt(0).toUpperCase();
                
            //     await Message.delete().catch(() => {});

            //     if (!panelConfig.panelBackupsMessageId) return;
            //     const channel = client.channels.cache.get(panelConfig.panelBackupsChannelId);
            //     const menuMsg = await channel.messages.fetch(panelConfig.panelBackupsMessageId).catch(() => null);
                
            //     if (!menuMsg) {
            //         panelConfig.panelBackupsMessageId = "";
            //         savePanelConfig();
            //         return initBackupMenu();
            //     }

            //     if (backupMenuState.pendingConfirm) {
            //         if (firstChar === 'Y') {
            //             const rule = backupMenuState.pendingConfirm;
            //             backupMenuState.pendingConfirm = null;
            //             backupMenuState.isShowingPopup = true;
                        
            //             await menuMsg.edit(safeCodeBlock(`[ BACKUP:RUNNING ]\n\nStarting backup for: ${rule.name}...`, 3900, 'ini'));
                        
            //             createBackup(rule.id).then(async (msg) => {
            //                 await menuMsg.edit(safeCodeBlock(`[ BACKUP:SUCCESS ]\n\n${msg}\n\nReturning to menu...`, 3900, 'ini'));
            //                 setTimeout(async () => {
            //                     backupMenuState.isShowingPopup = false;
            //                     const checkMsg = await menuMsg.fetch().catch(() => null);
            //                     if (checkMsg) await menuMsg.edit(renderBackupMenu());
            //                 }, 3000);
            //             }).catch(async (err) => {
            //                 await menuMsg.edit(safeCodeBlock(`[ BACKUP:ERROR ]\n\n${err.message}\n\nReturning to menu...`, 3900, 'ini'));
            //                 setTimeout(async () => {
            //                     backupMenuState.isShowingPopup = false;
            //                     const checkMsg = await menuMsg.fetch().catch(() => null);
            //                     if (checkMsg) await menuMsg.edit(renderBackupMenu());
            //                 }, 3000);
            //             });
                        
            //             return;
            //         } 
                    
            //         if (firstChar === 'N' || firstChar === 'Q') {
            //             backupMenuState.pendingConfirm = null;
            //             backupMenuState.isShowingPopup = false;
            //             await menuMsg.edit(renderBackupMenu());
            //             return;
            //         }

            //         return menuMsg.edit(renderBackupConfirm(backupMenuState.pendingConfirm));
            //     }

            //     if (backupMenuState.isShowingPopup) {
            //         backupMenuState.isShowingPopup = false;
            //         await menuMsg.edit(renderBackupMenu());
            //         return; 
            //     }

            //     if (/^\d+$/.test(input)) {
            //         const index = parseInt(input) - 1;
            //         const rule = backupMenuState.rules[index];

            //         if (rule) {
            //             backupMenuState.pendingConfirm = rule;
            //             backupMenuState.isShowingPopup = true;
            //             await menuMsg.edit(renderBackupConfirm(rule));
            //         }
            //         return;
            //     }
            // }

            if (Message.channelId === panelConfig.panelFilesChannelId) {
                const input = Message.content.trim();
                const firstChar = input.charAt(0).toUpperCase();
                
                await Message.delete().catch(() => {});

                if (!panelConfig.panelFilesMessageId) return;
                const channel = client.channels.cache.get(panelConfig.panelFilesChannelId);
                const menuMsg = await channel.messages.fetch(panelConfig.panelFilesMessageId).catch(() => null);
                
                if (!menuMsg) {
                    panelConfig.panelFilesMessageId = "";
                    savePanelConfig();
                    return initFileMenu();
                }

                const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
                const targetDir = path.join(serverDir, fileMenuState.currentDir);

                if (fileMenuState.pendingConfirm) {
                    if (firstChar === 'Y') {
                        const itemToDelete = fileMenuState.pendingConfirm;
                        const fullPath = path.join(targetDir, itemToDelete.name);
                        
                        try {
                            if (itemToDelete.isDir) fs.rmSync(fullPath, { recursive: true, force: true });
                            else fs.unlinkSync(fullPath);
                            
                            fileMenuState.pendingConfirm = null;
                            fileMenuState.isShowingPopup = false;
                            
                            loadFiles();
                            await menuMsg.edit(safeCodeBlock(`[ DELETE:INFO ]\n\nDeleted ${itemToDelete.name}.`, 3900, 'ini'));

                            setTimeout(async () => {
                                const checkMsg = await menuMsg.fetch().catch(() => null);
                                if (checkMsg && !fileMenuState.isShowingPopup) await menuMsg.edit(renderFileMenu());
                            }, 2000);
                        } catch (err) {
                            fileMenuState.pendingConfirm = null;
                            fileMenuState.isShowingPopup = false;
                            await menuMsg.edit(safeCodeBlock(`[ DELETE:ERROR ]\nFailed to delete: ${err.message}\n\nPress any key to dismiss.`, 3900, 'ini'));
                        }
                        return;
                    } 
                    
                    if (firstChar === 'N' || firstChar === 'Q') {
                        fileMenuState.pendingConfirm = null;
                        fileMenuState.isShowingPopup = false;
                        loadFiles();
                        await menuMsg.edit(renderFileMenu());
                        return;
                    }

                    return menuMsg.edit(renderConfirmMenu('DELETE', fileMenuState.pendingConfirm));
                }

                if (fileMenuState.isShowingPopup) {
                    fileMenuState.isShowingPopup = false;
                    loadFiles();
                    await menuMsg.edit(renderFileMenu());
                    return; 
                }
                if (firstChar === 'B' && input.length === 1) {
                    if (fileMenuState.currentDir !== "") {
                        const parts = fileMenuState.currentDir.split('/').filter(p => p);
                        parts.pop();
                        fileMenuState.currentDir = parts.length > 0 ? parts.join('/') + '/' : "";
                        loadFiles();
                        await menuMsg.edit(renderFileMenu());
                    }
                    return;
                }

                if (/^\d+$/.test(input)) {
                    const fileIndex = parseInt(input) - 1;
                    const selectedItem = fileMenuState.files[fileIndex];

                    if (selectedItem) {
                        if (selectedItem.isDir) {
                            fileMenuState.currentDir += selectedItem.name + "/";
                            loadFiles();
                            await menuMsg.edit(renderFileMenu());
                        } else {
                            fileMenuState.isShowingPopup = true;
                            await menuMsg.edit(safeCodeBlock(`[ SELECT:INFO ]\n\nFile: ${selectedItem.name}\n\nSend any message to dismiss`, 3900, 'ini'));
                        }
                    }
                    return;
                }

                const targetNum = parseInt(input.substring(1));
                let selectedItem = null;
                if (!isNaN(targetNum) && fileMenuState.files[targetNum - 1]) {
                    selectedItem = fileMenuState.files[targetNum - 1];
                }

                if (firstChar === 'D') {
                    if (!selectedItem) {
                        fileMenuState.isShowingPopup = true;
                        return menuMsg.edit(safeCodeBlock(`[ SELECT:ERROR ]\nInvalid file number selected\n\nSend any message to dismiss`, 3900, 'ini'));
                    }
                    
                    fileMenuState.pendingConfirm = selectedItem;
                    fileMenuState.isShowingPopup = true;
                    return menuMsg.edit(renderConfirmMenu('DELETE', selectedItem));
                }

                if (firstChar === 'R') {
                    if (!selectedItem) {
                        fileMenuState.isShowingPopup = true;
                        return menuMsg.edit(safeCodeBlock(`[ SELECT:ERROR ]\nInvalid file number.\nUsage: r[file number] [new name]\n\nSend any message to dismiss`, 3900, 'ini'));
                    }

                    const parts = input.split(' ');
                    const newName = parts.slice(1).join(' ');
                    
                    if (!newName) {
                        fileMenuState.isShowingPopup = true;
                        return menuMsg.edit(safeCodeBlock(`[ RENAME:ERROR ]\nYou must provide a new name.\nUsage: r[file number] [new name]\n\nSend any message to dismiss`, 3900, 'ini'));
                    }

                    try {
                        fs.renameSync(path.join(targetDir, selectedItem.name), path.join(targetDir, newName));
                        loadFiles();
                        
                        fileMenuState.isShowingPopup = true;
                        await menuMsg.edit(safeCodeBlock(`[ RENAME:INFO ]\n\nRenamed ${selectedItem.name} to ${newName}.\n\nReturning to menu...`, 3900, 'ini'));
                        
                        setTimeout(async () => {
                            fileMenuState.isShowingPopup = false;
                            const checkMsg = await menuMsg.fetch().catch(() => null);
                            if (checkMsg) await menuMsg.edit(renderFileMenu());
                        }, 1500);
                    } catch (err) {
                        fileMenuState.isShowingPopup = true;
                        await menuMsg.edit(safeCodeBlock(`[ RENAME:ERROR ]\nFailed to rename: ${err.message}\n\nSend any message to dismiss`, 3900, 'ini'));
                    }
                    return;
                }

                // if (firstChar === 'S') {
                //     fileMenuState.isShowingPopup = true;
                //     let sizePrompt = `[ SIZES ]\nPath: /${fileMenuState.currentDir}\n\n`;
                //     const filesToCheck = selectedItem ? [selectedItem] : fileMenuState.files;

                //     filesToCheck.forEach((file) => {
                //         try {
                //             const stats = fs.statSync(path.join(targetDir, file.name));
                //             const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                //             sizePrompt += `[${sizeMB} MB] ${file.name}\n`;
                //         } catch (e) {}
                //     });
                //     sizePrompt += `\nSend any message to dismiss`;
                //     await menuMsg.edit(safeCodeBlock(sizePrompt, 3900, 'ini'));
                //     return;
                // }
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
                        return Message.reply(`\`\`\`You need the \`Manage Server\` permission to use this command.\`\`\``);
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
                    return Message.reply("```You cannot change the permissions for %cmdperms.```");
                }

                if (!(lockKey in syncConfig)) {
                    return Message.reply(`\`\`\`${key} is invalid.\nAvailable keys: [setup] [toggle] [cfg] [cap] [help] [test]\`\`\``);
                }

                if (!value || (value !== 'true' && value !== 'false')) {
                    return Message.reply('\`\`\`Value must be [true] (locked) or [false] (unlocked).\`\`\`');
                }   

                syncConfig[lockKey] = value;
                saveSyncConfig();
                return Message.reply(`\`\`\`Set [${key}] to [${value}]\`\`\``);
            }

            const cmdLockkey = `${cmd}Locked`;
            const cmdIsLocked = syncConfig[cmdLockkey] !== undefined ? syncConfig[cmdLockkey] : syncConfig.fallbackCmdLockState;

            if (cmdIsLocked === "true") {
                const cmdPermsAllowed = Message.guild.ownerId === Message.author.id || 
                                        Message.member.permissions.has('ManageGuild') || 
                                        Message.member.permissions.has('Administrator');
                
                if (!cmdPermsAllowed) {
                    if (syncConfig.cmdPermsUnmetPrompt === "true") {
                        return Message.reply(`\`\`\`The [Manage Server] permission is required to use this command\`\`\``);
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
                return Message.reply(`\`\`\`Chat sync is now ${status}\`\`\``);
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
                    return Message.reply(`\`\`\`Minecraft server not connected\`\`\``);
                }

                if (!isConnected()) {
                    return Message.reply(`\`\`\`Connection initializing. Try again in a few seconds.\`\`\``);
                }

                if (args.length === 0) {
                    if (!canSend(`config:configQuery`)) {
                        return Message.reply(`\`\`\`This mod version does not support reading configs.\`\`\``);
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

                    if (!sent) return Message.reply("```Minecraft server not connected.```");

                    try {
                        await configPromise;
                    } catch {
                        return Message.reply("```The mod didn't respond to the config in time. Try %cfg again```");
                    }

                    const availableKeys = [...agreed]
                        .filter(f => f.startsWith('cfgKey:'))
                        .map(f => f.split(':')[1]);

                    let configText = 'Mod Config\n';
                    for (const key of availableKeys) {
                        const val = syncConfig[key] !== undefined ? `\`${syncConfig[key]}\`` : 'unknown';
                        configText += `\`${key}\`: ${val}\n`;
                    }
                    
                    return Message.reply(configText);
                }

                if (!canSend(`config:configWrite`)) {
                    return Message.reply("```\nThis mod version does not support writing configs.\n```");
                }

                const key = args[0];
                const valueStr = args[1];

                const availableKeys = [...agreed]
                    .filter(f => f.startsWith('cfgKey:'))
                    .map(f => f.split(':')[1]);

                if (!availableKeys.includes(key)) {
                    if (availableKeys.length === 0) {
                        return Message.reply("```This mod does not have any config keys to change.```");
                    }
                    return Message.reply(`\`\`\`Invalid key. Available keys: ${availableKeys.map(k => `\`${k}\``).join(', ')}\`\`\``);
                }

                if (valueStr !== 'true' && valueStr !== 'false') {
                    return Message.reply("\`\`\`Value must be `true` or `false`.\`\`\`");
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
                    '`cap` — Show what this mod supports'
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
                    '`cap` — Show what this mod supports'
                );
                return Message.reply(lines.join('\n'));
            }
        }

        else {
            if (!syncConfig.syncEnabled) return;
            if (!syncConfig.chatSyncChannel || Message.channel.id !== syncConfig.chatSyncChannel) return;

            if (!socketIsOpen()) {
                return Message.reply(`\`\`\`Your message could not be delivered because the Minecraft server is disconnected. Please try again later or contact the server administrator.\`\`\``);
            }

            if (!isConnected()) {
                return Message.reply(`\`\`\`Your message could not be delivered because the connection to the Minecraft server is initializing. Please try again after a few seconds.\`\`\``);
            }

            if (!canSend(`core:discord_chat`)) {
                return Message.reply(`\`\`\`Your message could not be delivered because there was an unexpected error. Please contact the server administrator.\`\`\``)
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
    }});

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

                    const avatarUrl = await getDiscordCachedSkin(payload.username, payload.uuid);

                    await fetch(syncConfig.chatWebhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: payload.username,
                            avatar_url: avatarUrl,
                            content: `${payload.message}`
                        })
                    }).catch(() => {});
                }
                
                else if (payload.type === 'join' || payload.type === `leave`) {
                    if (!syncConfig.serverWebhookUrl) return; 

                    await fetch(syncConfig.serverWebhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: `Server message`,
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
                            username: `Server message`,
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
                            username: `Server message`,
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

const webServer = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);


    if (parsedUrl.pathname.startsWith('/skin/')) {
        const uuid = parsedUrl.pathname.replace('/skin/', '').replace(/-/g, '');
        if (!uuid) return res.end();
        
        const cachePath = path.join(__dirname, 'cache', 'skins', `${uuid}.png`);
        
        if (fs.existsSync(cachePath)) {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            fs.createReadStream(cachePath).pipe(res);
            return;
        }

        try {
            const mojangRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
            if (!mojangRes.ok) throw new Error("Mojang API failed or player not found");
            
            const profile = await mojangRes.json();
            
            const texturesProp = profile.properties.find(p => p.name === 'textures');
            if (!texturesProp) throw new Error("No textures found");

            const decoded = JSON.parse(Buffer.from(texturesProp.value, 'base64').toString('utf-8'));
            const skinUrl = decoded.textures.SKIN.url;

            const skinRes = await fetch(skinUrl);
            if (!skinRes.ok) throw new Error("Failed to download skin texture");
            
            const arrayBuffer = await skinRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            if (!fs.existsSync(path.dirname(cachePath))) fs.mkdirSync(path.dirname(cachePath), { recursive: true });
            fs.writeFileSync(cachePath, buffer);
            
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(buffer);
            
        } catch (err) {
            console.error(`[Skin Fetch Error] ${err.message}`);
            res.writeHead(404);
            res.end("Skin not found");
        }
        return;
    }

    if (parsedUrl.pathname === '/files') {
        if (parsedUrl.query.pw !== panelConfig.panelWebPassword) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            return res.end("Unauthorized. Add ?pw=yourpassword to the URL.");
        }

        const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
        const currentDir = parsedUrl.query.dir || '';
        const targetDir = path.join(serverDir, currentDir);

        if (!targetDir.startsWith(serverDir)) {
            res.writeHead(403); return res.end("Forbidden");
        }

        let html = `
        <html>
        <head><title>Server Files</title>
        <style>body { font-family: monospace; padding: 20px; } a { text-decoration: none; color: blue; } li { margin: 5px 0; }</style>
        </head>
        <body>
        <h2>/${currentDir}</h2>
        <ul>`;

        if (currentDir !== '') {
            const parent = currentDir.split('/').filter(p => p).slice(0, -1).join('/');
            html += `<li><a href="/files?pw=${panelConfig.panelWebPassword}&dir=${parent}">.. (Go Back)</a></li>`;
        }

        try {
            const files = fs.readdirSync(targetDir, { withFileTypes: true });
            for (const file of files) {
                const filePath = currentDir ? `${currentDir}/${file.name}` : file.name;
                const display = file.isDirectory() ? `${file.name}/` : file.name;
                
                if (file.isDirectory()) {
                    html += `<li><a href="/files?pw=${panelConfig.panelWebPassword}&dir=${filePath}">${display}</a></li>`;
                } else {

                    html += `<li><a href="/download?pw=${panelConfig.panelWebPassword}&file=${filePath}">${display}</a></li>`;
                }
            }
        } catch (e) {
            html += `<li>Error reading directory: ${e.message}</li>`;
        }

        html += `</ul></body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
    }

    if (parsedUrl.pathname === '/download') {
        if (parsedUrl.query.pw !== panelConfig.panelWebPassword) {
            res.writeHead(401); return res.end("Unauthorized");
        }
        
        const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
        const filePath = path.join(serverDir, parsedUrl.query.file);
        
        if (!filePath.startsWith(serverDir) || !fs.existsSync(filePath)) {
            res.writeHead(404); return res.end("File not found");
        }

        res.writeHead(200, { 
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`
        });
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    res.writeHead(404);
    res.end("Not Found");
});

webServer.listen(panelConfig.panelWebPort, () => {
    console.log(`[WebServer] Listening on http://localhost:${panelConfig.panelWebPort}`);
});

    process.on(`unhandledRejection`, (reason, promise) => {
        console.error(`[ERROR] Unhandled rejection at ${promise}. Reason: ${reason}`);
    });

    process.on(`uncaughtException`, (err) => {
        console.error(`[ERROR] Uncaught exception: ${err}`);
    });

client.login(process.env.DISCORD_TOKEN);