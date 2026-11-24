const { Client, GatewayIntentBits, Message, ChannelSelectMenuBuilder, ChannelType, ActionRowBuilder, EmbedBuilder, messageLink } = require('discord.js');
const WebSocket = require('ws');
const fs = require(`fs`);
const { spawn } = require(`child_process`);
const path = require(`path`);
const pingModule = import(`mc-server-ping`);
const si = require(`systeminformation`);
const http = require(`http`);
const url = require(`url`);
const nbt = require(`prismarine-nbt`);
const sharp = require(`sharp`);
const archiver = require(`archiver`);
const archive2 = require(`yauzl`);
const { finished } = require(`stream/promises`);
require(`dotenv`).config();

const defaultChatSyncConfig = {
    "websocketPort": "38200",
    "chatSyncGuildId": "",
    "chatSyncChannel": "",
    "chatWebhookUrl": "",
    "serverWebhookUrl": "",
    "syncEnabled": true,
    "setupLocked": false,
    "toggleLocked": false,
    "cfgLocked": false,
    "capLocked": false,
    "helpLocked": false,
    "testLocked": false,
    "cmdPermsUnmetPrompt": true,
    "fallbackCmdLockState": false,
}

const defaultPanelConfig = {
    lockServerDirectory: false,
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
    panelServerCrashRecovery: false,
    panelServerMaxRecoveryAttempts: "3",
    panelServerRecoveryTimeout: "10",
    panelServerUseSigterm: true,
    panelServerSigtermTimeout: "20",
    panelServerUseSigkill:false ,
    panelServerSigKillTimeout: "",
    panelTickInterval: "1.5",
    panelWebPort: "8080",
    panelWebPassword: "password",
    panelChatSyncCacheChannelId: "",
};

const capabilities = [
    `core:chat`, `core:join`, `core:leave`, `core:death`, `core:advancement`,
    `core:discord_chat`,

    `config:configQuery`,
    `config:configWrite`,

    `cfgKey:forwardChat`,
    `cfgKey:forwardJoinLeave`,
    `cfgKey:forwardDeaths`,
    `cfgKey:forwardAdvancements`
]

const core_capabilities = Object.freeze([
    `core:chat`, `core:join`, `core:leave`, `core:death`, `core:advancement`,
    `core:discord_chat`,
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
let isUpdatingDashboard = false;

let remainingRecoveryAttempts = 3;

let fileMenuState = {
    action: null,
    files: [],
    currentDir: "",
    selectedFile: "",
    pendingConfirm: null,
    isShowingPopup: false
};
let playerMenuState = {
    action: null,
    players: [],
    page: 0,
    selectedPlayer: "",
    pendingConfirm: null,
    isShowingPopup: false
};

let isBackingUp = false;
let isRestoringPlayerData = false;
let backupMenuState = {
    rules: [],
    pendingConfirm: null,
    pendingDelete: null,
    isShowingPopup: false
};

let backupConfigState = {
    active: false,
    step: 0,
    mode: "create",
    ruleId: null,
    name: "",
    destination: "",
    exclude: "",
    maxBackups: ""
};
let configMenuState = {
    selectedFile: null,
    entries: [],
    page: 0,
    editing: null,
    error: null,
    notice: null
}
let restoreMenuState = {
    active: false,
    player: null,
    backups: [],
    selectedBackup: null,
    pendingConfirm: false,
    page: 0
}

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
    if (panelConfig.panelBackupsChannelId) {
        await refreshBackupMenu();
    }
    if (panelConfig.panelPlayersChannelId) {
        await refreshPlayerMenu();
    }
}

function safeCodeBlock(text, maxLength = 4000, language = ``) {
    if (!text) return `\`\`\`${language}\n(Empty)\n\`\`\``;
    let safeText = text;
    if (safeText.length > maxLength) {
        safeText = safeText.substring(0, maxLength - 15) + "\n...[TRUNCATED]";
    }
    return `\`\`\`${language}\n${safeText}\n\`\`\``;
}

const LOG_COLORS = {
INFO: `\u001b[32m`,
WARN: `\u001b[33m`,
ERROR: `\u001b[31m`,
RESET: `\u001b[0m`
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

const chatsyncConfigPath = path.join(__dirname, `chatsync-config.json`);
const panelConfigPath = path.join(__dirname, `panel-config.json`);

function readConfigs() {
    try {
        if (fs.existsSync(chatsyncConfigPath)) {
            syncConfig = { ...defaultChatSyncConfig, ...JSON.parse(fs.readFileSync(chatsyncConfigPath, `utf-8`)) };
        } else {
            syncConfig = { ...defaultChatSyncConfig };
            fs.writeFileSync(chatsyncConfigPath, JSON.stringify(syncConfig, null, 2));
        }

        if (fs.existsSync(panelConfigPath)) {
            panelConfig = { ...defaultPanelConfig, ...JSON.parse(fs.readFileSync(panelConfigPath, `utf-8`)) };
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




// Console




function startServer() {
    if (mcProcess) return `Server is already running`;

    canAcceptCommands = true;
    isStopping = false;
    serverStartTime = Date.now();
    currentState = "Starting";
    hasBeenOnline = false;

    if (!panelConfig.panelServerDirectory) {
        return " Server directory is not configured";
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

    mcProcess.stdout.on(`data`, (data) => {
        const lines = data.toString().split(`\n`);
            
        for (const line of lines) {
            if (!line.trim()) continue;
            console.log(line);
                
            if (line.includes("Done (") || line.toLowerCase().includes("for help, type")) {
                currentState = "Online";

                if (serverStartTime === null) {
                    serverStartTime = Date.now();
                }
            }

            handleConsoleUpdate(colorizeMinecraftLine(line)); 
        }
    });

    mcProcess.stderr.on(`data`, (data) => {
        console.error(`${data}`);
        handleConsoleUpdate(colorizeMinecraftLine(`${data.toString().trim()}`));
    });
        
          mcProcess.on(`exit`, (code, signal) => {
        clearTimeout(stopTimer);
        clearTimeout(killTimer);
        isStopping = false;
        canAcceptCommands = true;
        onlinePlayers = 0;
        maxPlayers = 0;
        playerList = [];
        
        const uptimeMs = serverStartTime
            ? Date.now() - serverStartTime
            : 0;

        const uptimeMinutes = Math.floor(uptimeMs / 60000);

        serverStartTime = null;

        console.log(`[MC] exit event — code=${JSON.stringify(code)} signal=${JSON.stringify(signal)}`);
        mcProcess = null;

        const isCleanStop = (code === 0 || signal === `SIGTERM` || signal === `SIGINT` || signal === `SIGKILL`);

        if (isCleanStop) {
            currentState = "Offline";
            if (signal) {
                handleConsoleUpdate(panelLog(`WARN`, `Server stopped with signal ${signal}`));
            } else {
                handleConsoleUpdate(panelLog(`INFO`, `Server stopped with code ${code}`));
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
        handleConsoleUpdate(panelLog(`ERROR`, `Server crashed with code ${code} and signal ${signal}.`));
        sendNotification(panelConfig.panelConsoleChannelId, `Server crashed! code ${code}`)

        if (uptimeMinutes >= 2) {
            remainingRecoveryAttempts = parseInt(panelConfig.panelServerMaxRecoveryAttempts) || 3;
            handleConsoleUpdate(panelLog(`INFO`, `Server ran for ${uptimeMinutes}m before crashing. Resetting recovery attempts.`));
        }

        if (panelConfig.panelServerCrashRecovery === true) {
            remainingRecoveryAttempts--;
            
            if (remainingRecoveryAttempts > 0) {
                const delayMs = (parseInt(panelConfig.panelServerRecoveryTimeout) || 10) * 1000;
                handleConsoleUpdate(panelLog(`WARN`, `Attempting crash recovery... (${remainingRecoveryAttempts} attempts left)`));
                
                setTimeout(() => {
                    if (currentState === "Crashed") currentState = "Starting";
                    startServer();
                }, delayMs);
            } else {
                handleConsoleUpdate(panelLog(`WARN`, `Max recovery attempts reached. Server will stay offline.`));
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

    if (stopCmd.toLowerCase() === `kill`) {
        return killServer();
    }

    try {
        if (proc.stdin && !proc.stdin.destroyed) {
            proc.stdin.write(stopCmd + `\n`);
        }
    } catch (err) {
        handleConsoleUpdate(panelLog(`WARN`, `Failed to write to stdin: ${err.message}`));
    }

    const useSigterm = panelConfig.panelServerUseSigterm !== false;
    const sigtermTimeout = parseInt(panelConfig.panelServerSigtermTimeout) || 20;
    
    const useSigkill = panelConfig.panelServerUseSigkill === true;
    const sigkillTimeout = parseInt(panelConfig.panelServerSigKillTimeout) || 15;

    if (useSigterm) {
        stopTimer = setTimeout(() => {
            if (mcProcess !== proc) return;
            
            handleConsoleUpdate(panelLog(`WARN`, `Server didn't exit with stop command. Sending SIGTERM to pid ${pid}...`));
            
            try { process.kill(pid, `SIGTERM`); } catch (e) {
                handleConsoleUpdate(panelLog(`ERROR`, `SIGTERM failed: ${e.message}`));
            }

            if (useSigkill) {
                killTimer = setTimeout(() => {
                    if (mcProcess !== proc) return;
                    
                    handleConsoleUpdate(panelLog(`ERROR`, `Server didn't exit after SIGTERM. Sending SIGKILL to pid ${pid}...`));
                    
                    try {
                        if (process.platform === `win32`) {
                            spawn(`taskkill`, [`/pid`, String(pid), `/f`, `/t`]);
                        } else {
                            process.kill(-pid, `SIGKILL`);
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
        if (process.platform === `win32`) {
            spawn(`taskkill`, [`/pid`, String(pid), `/f`, `/t`]);
        } else {
            process.kill(-pid, `SIGKILL`);
        }
    } catch (err) {
        try { mcProcess.kill(`SIGKILL`); } catch (e) {}
    }
    
    return "Killed server and its child processes.";
}

function colorizeMinecraftLine(line) {
    if (!line.trim()) return line;

    const hasAnsi = line.includes(`\u001b[`);

    if (hasAnsi) {
        return `${line}\u001b[0m`;
    }

    if (line.includes(`/ERROR]`) || line.includes(`[ERROR]`)) {
        return `\u001b[31m${line}\u001b[0m`;
    }
    if (line.includes(`/WARN]`) || line.includes(`[WARN]`)) {
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

        let text = `\`\`\`ansi\n${consoleLines.join(`\n`)}\n\`\`\``;
        
        while (text.length > 3900 && consoleLines.length > 0) {
            consoleLines.shift(); 
            text = `\`\`\`ansi\n${consoleLines.join(`\n`)}\n\`\`\``; 
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

        const cpuColor = cpuPercent > 90 ? `\u001b[31m` : cpuPercent > 70 ? `\u001b[33m` : `\u001b[32m`;
        const memPercent = ((mem.total - mem.available) / mem.total) * 100;
        const ramColor = memPercent > 90 ? `\u001b[31m` : memPercent > 70 ? `\u001b[33m` : `\u001b[32m`;

       return `${cpuColor}CPU: ${cpuPercent}%\u001b[0m | ${ramColor}RAM: ${memUsed}/${memTotal}GB\u001b[0m`;
    } catch (err) {
        return "Performance stats unavailable.";
    }
}




// Dashboard




async function updateDashboard() {
    if (isUpdatingDashboard) return;

    isUpdatingDashboard = true;

    try {
        const channel = await client.channels.fetch(
            panelConfig.panelDashboardChannelId
        ).catch(() => null);

        if (!channel) return;

        let status = { online: false };

        if (mcProcess) {
            status = await pingServer("127.0.0.1", 25565);

            if (status.online) {
                currentState = "Online";
                hasBeenOnline = true;

                if (serverStartTime === null) {
                    serverStartTime = Date.now();
                }
            } else if (hasBeenOnline) {
                currentState = "Disconnected";
            }
        }

        let statusColor = 0xff0000;
        let stateDisplay = "";

        if (currentState === "Online") {
            statusColor = 0x00cc66;
            stateDisplay = "\u001b[32m[ ONLINE ]\u001b[0m";
        } else if (currentState === "Starting") {
            statusColor = 0xffcc00;
            stateDisplay = "\u001b[33m[ STARTING ]\u001b[0m";
        } else if (currentState === "Disconnected") {
            statusColor = 0xffcc00;
            stateDisplay = "\u001b[33m[ DISCONNECTED ]\u001b[0m";
        } else if (currentState === "Crashed") {
            statusColor = 0xff0000;
            stateDisplay = "\u001b[31m[ CRASHED ]\u001b[0m";
        } else {
            stateDisplay = "\u001b[31m[ OFFLINE ]\u001b[0m";
        }

        let text = `${stateDisplay}\n`;

        if (mcProcess) {
            let uptimeString = "Starting...";

            if (serverStartTime !== null) {
                const uptimeMs = Date.now() - serverStartTime;

                const hours = Math.floor(uptimeMs / 3600000);
                const minutes = Math.floor((uptimeMs % 3600000) / 60000);
                const seconds = Math.floor((uptimeMs % 60000) / 1000);

                uptimeString = hours > 0
                    ? `${hours}h ${minutes}m ${seconds}s`
                    : minutes > 0
                        ? `${minutes}m ${seconds}s`
                        : `${seconds}s`;
            }

            text += `[ UPTIME ] ${uptimeString}\n`;

            if (status.online) {
                const players = status.players || {};

                const playerCount = players.online ?? "?";
                const maxPlayers = players.max ?? "?";

                const motdFormatted = String(status.motd || "N/A")
                    .replace(/§./g, "");

                let playerListText = "Names unavailable";

                if (Array.isArray(players.sample) && players.sample.length > 0) {
                    playerListText = players.sample
                        .map(p => p.name)
                        .join(", ");
                } else if (players.online === 0) {
                    playerListText = "Not available";
                }

                text +=
                    `[ PLAYERS ] ${playerCount} / ${maxPlayers}\n\n` +
                    `[ MOTD ]\n${motdFormatted}\n\n` +
                    `[ PLAYER LIST ]\n${playerListText}`;
            } else {
                text +=
                    `[ PLAYERS ] N/A\n\n` +
                    `[ MOTD ]\nN/A\n\n` +
                    `[ PLAYER LIST ]\nN/A`;
            }

            const hw = await getHardwareStats();

            if (hw) {
                text += `\n\n[ PERF ]\n${hw}`;
            }
        }

        const embed = new EmbedBuilder()
            .setColor(statusColor)
            .setDescription(safeCodeBlock(text, 3900, "ansi"));

        let msg = null;

        if (panelConfig.panelDashboardMessageId) {
            msg = await channel.messages.fetch(
                panelConfig.panelDashboardMessageId
            ).catch(() => null);
        }

        if (msg) {
            if (text === lastDashboardString) return;

            await msg.edit({ embeds: [embed] });

        } else {
            const newMsg = await channel.send({ embeds: [embed] });

            panelConfig.panelDashboardMessageId = newMsg.id;
            savePanelConfig();
        }

        lastDashboardString = text;

    } catch (err) {
        console.error("[Dashboard] Update failed:", err);
    } finally {
        isUpdatingDashboard = false;
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




function loadBackupRules() {
    const rulesDir = path.resolve(__dirname, `BackupRules`);
    
    if (!fs.existsSync(rulesDir)) {
        fs.mkdirSync(rulesDir, { recursive: true });
        const defaultRule = {
            exclude: [""],
            destination: "./backups",
            maxBackups: 5
        };
        fs.writeFileSync(path.join(rulesDir, "full-server.json"), JSON.stringify(defaultRule, null, 2));
    }

    const files = fs.readdirSync(rulesDir).filter(f => f.endsWith(`.json`));
    const rules = [];

    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(rulesDir, file), `utf-8`));
            const id = path.basename(file, `.json`);
            rules.push({
                id: id,
                name: id.replace(/_/g, ' '),
                exclude: data.exclude || [],
                destination: data.destination || `./backups`,
                maxBackups: data.maxBackups ?? 5
            });
        } catch (e) {
            console.error(`Failed to parse backup rule ${file}:`, e.message);
        }
    }
    return rules.sort((a, b) => a.name.localeCompare(b.name));
}

function renderBackupMenu(rules) {
    let prompt = `[ Backups ]\n`;
    prompt += `Select a backup rule to run\n`;
    prompt += `-------------------------\n`;
    
    if (rules.length === 0) {
        prompt += `(No backup rules configured)\n`;
    } else {
        rules.forEach((rule, index) => {
            const num = String(index + 1).padStart(2, `0`);
            prompt += `[${num}] ${rule.name}\n`;
            prompt += `     Backs up: / (Entire Server)\n`;
            if (rule.exclude.length > 0) {
                prompt += `     Excludes: ${rule.exclude.join(`, `)}\n`;
            }
            prompt += `     Backups to keep: ${rule.maxBackups === 0 ? `All` : rule.maxBackups}\n`;
        });
    }

    prompt += `\n[C] Create backup rule`;
    // prompt += `\n[E <number>] Edit backup rule`;
    prompt += `\n[D<number>] Delete backup rule`;
    
    return safeCodeBlock(prompt, 3900, `ini`);
}

function createProgressBar(percentage, length = 20) {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;

    return `[${`=`.repeat(filled)}${` `.repeat(empty)}] ${percentage}%`;
}

function renderBackupConfigMenu() {
    let prompt = `[ Create backup ]\n`;
    prompt += `-------------------------\n`;
    
    if (backupConfigState.step === 0) {
        prompt += `[N] Create New Rule\n`;
        // prompt += `[E <number>] Edit Existing Rule\n`;
        prompt += `[D <number>] Delete Rule\n`;
        prompt += `[Q] Quit`;
        return safeCodeBlock(prompt, 2000, `ini`);
    }

    if (backupConfigState.step === 1) {
        prompt += `Enter a name for the backup rule:\n\n`;
        prompt += `[Q] Quit`;
    } else if (backupConfigState.step === 2) {
        prompt += `Enter paths to EXCLUDE (comma separated, e.g. logs, cache):\n`;
        prompt += `type "none.." for no excludes (backs up the whole server directory)\n`;
        prompt += `[Q] Quit`;
    } else if (backupConfigState.step === 3) {
        prompt += `Enter the DESTINATION path\n(./[path] for panel directory, or use an absolute path: e.g. /home/user/Documents/backups):\n`;
        prompt += `[Q] Quit`;
    } else if (backupConfigState.step === 4) {
        prompt += `How many backups should be kept? (integer, 0 to keep all):\n`;
        prompt += `[Q] Quit`;
    }

    return safeCodeBlock(prompt, 2000, `ini`);
}

function renderBackupDeleteConfirmMenu(rule) {
    let prompt = `[ Confirm deletion ]\n`;
    prompt += `-------------------------\n`;
    prompt += `Are you sure you want to delete "${rule.name}"?\n\n`;
    prompt += `[Y/n]`;

    return safeCodeBlock(prompt, 2000, `ini`);
}

function resetBackupConfigState() {
    backupConfigState = {
        active: false,
        step: 0,
        mode: "create",
        ruleId: null,
        name: "",
        destination: "",
        exclude: "",
        maxBackups: ""
    };
}

function createBackupProgressUpdater(message, ruleName) {
    let timer = null;
    let latestContent = null;
    let lastEditAt = 0;
    let editQueue = Promise.resolve();
    let stopped = false;

    function update(progress) {
        if (!message || stopped) return;

        const totalBytes = progress.fs?.totalBytes || 0;
        const processedBytes = progress.fs?.processedBytes || 0;

        const percentage = totalBytes > 0
            ? Math.min(99, Math.floor((processedBytes / totalBytes) * 100))
            : null;

        const bar = percentage === null
            ? `[                    ] Calculating...`
            : createProgressBar(percentage);

        const entries = progress.entries || {};

        const content = safeCodeBlock(
            `[ Backup running... ]\n\n` +
            `${ruleName}\n\n` +
            `${bar}\n` +
            `Files: ${entries.processed || 0} / ${entries.total || 0}\n` +
            `Size: ${(processedBytes / 1024 / 1024).toFixed(1)} / ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
            3900,
            `ini`
        );

        latestContent = content;

        if (timer) return;

        const delay = Math.max(0, 1000 - (Date.now() - lastEditAt));

        timer = setTimeout(() => {
            timer = null;

            if (stopped || latestContent === null) return;

            const contentToSend = latestContent;
            latestContent = null;
            lastEditAt = Date.now();

            editQueue = editQueue
                .then(() => message.edit(contentToSend))
                .catch(err => {
                    console.error(`[Backup] Progress update failed:`, err);
                });

        }, delay);
    }

    async function flush() {
        stopped = true;

        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        if (latestContent !== null) {
            const contentToSend = latestContent;
            latestContent = null;

            editQueue = editQueue
                .then(() => message.edit(contentToSend))
                .catch(err => {
                    console.error(`[Backup] Progress update failed:`, err);
                });
        }

        await editQueue;
    }

    return { update, flush };
}

function isPathInside(root, target) {
    const relative = path.relative(root, target);

    return relative === `` ||
        (!relative.startsWith(`..${path.sep}`) &&
        relative !== `..` &&
        !path.isAbsolute(relative));
}

async function createBackup(ruleId, progressMessage = null) {
    let progressUpdater = null;
    if (isBackingUp) {
        return "A backup is already in progress.";
    }

    if (isRestoringPlayerData) {
        return "Player data is restoring.";
    }

    const rules = loadBackupRules();
    const rule = rules.find(r => r.id === ruleId);

    if (!rule) {
        return "Backup rule not found.";
    }

    if (!panelConfig.panelServerDirectory) {
        return "Server directory is not configured.";
    }

    isBackingUp = true;

    let archive = null;
    let output = null;
    let outputDone = null;
    let backupFile = null;

    try {
        const serverDir = path.resolve(
            __dirname,
            panelConfig.panelServerDirectory
        );

        const serverStats = await fs.promises.stat(serverDir);

        if (!serverStats.isDirectory()) {
            throw new Error("Server directory is not a directory.");
        }

        const destination = String(
        rule.destination || `./backups`
        ).trim();

        const isBotRelative = /^\.([/\\])/.test(destination);

        const normalizedDestination = process.platform === `win32`
            ? destination.replace(/\//g, path.sep)
            : destination.replace(/\\/g, path.sep);

        const backupDir = path.resolve(
            isBotRelative ? __dirname : serverDir,
            normalizedDestination
        );

        if (path.relative(serverDir, backupDir) === ``) {
            throw new Error("Backup destination cannot be the server root.");
        }

        const backupDirInsideServer = isPathInside(serverDir, backupDir);

        await fs.promises.mkdir(backupDir, { recursive: true });

        const safeRuleId = rule.id.replace(/[^a-zA-Z0-9_-]/g, `_`);

        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, `-`);

        backupFile = path.join(
            backupDir,
            `${safeRuleId}-${timestamp}.zip`
        );

        handleConsoleUpdate(
            panelLog(`INFO`, `Starting backup: ${rule.name}...`)
        );

        if (mcProcess) {
            if (!mcProcess.stdin || mcProcess.stdin.destroyed) {
                throw new Error("Minecraft console input is unavailable.");
            }

            mcProcess.stdin.write(`save-all flush\n`);

            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        output = fs.createWriteStream(backupFile, {
            flags: `wx`
        });

        outputDone = finished(output);
        outputDone.catch(() => {});

        archive = archiver(`zip`, {
            zlib: { level: 6 },
            forceZip64: true
        });

        progressUpdater = createBackupProgressUpdater(progressMessage, rule.name);

        archive.on(`progress`, progressUpdater.update);

        archive.on(`error`, err => {
            output.destroy(err);
        });

        archive.on(`warning`, err => {
            output.destroy(err);
        });

        archive.pipe(output);

        const excludes = (rule.exclude || [])
            .map(e => String(e)
                .trim()
                .replace(/\\/g, `/`)
                .replace(/^\.\/+/, ``)
                .replace(/^\/+|\/+$/g, ``)
            )
            .filter(Boolean);

        function isExcluded(relativePath) {
            return excludes.some(exclude =>
                relativePath === exclude ||
                relativePath.startsWith(`${exclude}/`)
            );
        }

        async function addDirectory(directory, relativeParts = []) {
            const entries = await fs.promises.readdir(directory, {
                withFileTypes: true
            });

            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);

                const relativePath = [
                    ...relativeParts,
                    entry.name
                ].join(`/`).replace(/\\/g, `/`);

                if (isExcluded(relativePath)) continue;

                if (
                    backupDirInsideServer &&
                    isPathInside(backupDir, fullPath)
                ) {
                    continue;
                }

                const stats = await fs.promises.lstat(fullPath);

                if (stats.isSymbolicLink()) continue;

                if (stats.isDirectory()) {
                    await addDirectory(fullPath, [
                        ...relativeParts,
                        entry.name
                    ]);
                } else if (stats.isFile()) {
                    archive.file(fullPath, {
                        name: relativePath,
                        date: stats.mtime,
                        mode: stats.mode
                    });
                }
            }
        }

        await addDirectory(serverDir);

        await Promise.all([
            archive.finalize(),
            outputDone
        ]);

        const stats = await fs.promises.stat(backupFile);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

        try {
            const files = await fs.promises.readdir(backupDir, {
                withFileTypes: true
            });

            const backups = [];

            for (const file of files) {
                if (
                    !file.isFile() ||
                    !file.name.startsWith(`${safeRuleId}-`) ||
                    !file.name.endsWith(`.zip`)
                ) {
                    continue;
                }

                const filePath = path.join(backupDir, file.name);
                const fileStats = await fs.promises.stat(filePath);

                backups.push({
                    name: file.name,
                    time: fileStats.mtimeMs
                });
            }

            const maxBackups = Number(rule.maxBackups ?? 5);

            if (!Number.isSafeInteger(maxBackups) || maxBackups < 0) {
                throw new Error(`Invalid maxBackups setting.`);
            }

            if (maxBackups > 0) {
                backups.sort((a, b) => a.time - b.time);

                while (backups.length > maxBackups) {
                    const oldest = backups.shift();

                    await fs.promises.unlink(
                        path.join(backupDir, oldest.name)
                    );
                }
            }

        } catch (err) {
            console.error("Backup retention cleanup failed:", err);
        }

        handleConsoleUpdate(
            panelLog(`INFO`, `Backup completed: ${sizeMB} MB`)
        );

        return `Backup complete: ${sizeMB} MB`;

    } catch (err) {
        if (archive) archive.abort();

        if (output && !output.destroyed) {
            output.destroy();
        }

        if (outputDone) {
            await outputDone.catch(() => {});
        }

        if (backupFile) {
            await fs.promises.unlink(backupFile).catch(() => {});
        }

        handleConsoleUpdate(
            panelLog(`ERROR`, `Backup failed: ${err.message}`)
        );

        throw err;

    } finally {
    if (progressUpdater) {
        await progressUpdater.flush();
    }

    isBackingUp = false;
    }
}

async function initBackupMenu() {
    if (!panelConfig.panelBackupsChannelId) return;
    const channel = client.channels.cache.get(panelConfig.panelBackupsChannelId);
    if (!channel) return;

    backupMenuState.rules = loadBackupRules();

    try {
        if (panelConfig.panelBackupsMessageId) {
            const msg = await channel.messages.fetch(panelConfig.panelBackupsMessageId).catch(() => null);
            if (msg) {
                await msg.edit(renderBackupMenu(backupMenuState.rules));
                return;
            }
        }
        const newMsg = await channel.send(renderBackupMenu(backupMenuState.rules));
        panelConfig.panelBackupsMessageId = newMsg.id;
        savePanelConfig();
    } catch (err) {
        console.error("Failed to send backup menu:", err);
    }
}

async function refreshBackupMenu() {
    if (!panelConfig.panelBackupsChannelId || !panelConfig.panelBackupsMessageId) return;
    if (backupMenuState.pendingConfirm || backupMenuState.isShowingPopup) return;
    if (backupConfigState.active) return;

    const channel = client.channels.cache.get(panelConfig.panelBackupsChannelId);
    if (!channel) return;

    const menuMsg = await channel.messages.fetch(panelConfig.panelBackupsMessageId).catch(() => null);
    if (!menuMsg) return;

    backupMenuState.rules = loadBackupRules();
    const newText = renderBackupMenu(backupMenuState.rules);
    if (menuMsg.content !== newText) {
        await menuMsg.edit(newText).catch(() => {});
    }
}




// Files




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
            const num = String(index + 1).padStart(2, `0`);
            const displayName = file.isDir ? `${file.name}/` : (file.name ? file.name : ` `);
            prompt += `[${num}] ${displayName}\n`;
        });
    }
    
    return safeCodeBlock(prompt, 3900, `ini`);
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
            const num = String(index + 1).padStart(2, `0`);
            const displayName = file.isDir ? `${file.name}/` : file.name;
            prompt += `[${num}] ${displayName}\n`;
        });
    }
    
    return safeCodeBlock(prompt, 3900, `ini`);
}

function renderConfirmMenu(action, item) {
    let prompt = `[ CONFIRM:${action} ]\n`;
    prompt += `-------------------------\n`;
    if (item.isDir) {
        prompt += `This is a directory. Deleting it will also delete ALL files in it.\n\n`
    }
    prompt += `Are you sure you want to ${action.toLowerCase()} ${item.name}${item.isDir ? `/` : ``}?\n`;
    prompt += `[Y/n]`;
    
    return safeCodeBlock(prompt, 3900, `ini`);
}



// Players




// async function readPlayerData(uuid) {
//     const filePath = path.join(`${panelConfig.panelServerDirectory}` + `world/` + `playerdata/` + uuid + `.dat`);
//     console.log (filePath);
//     const buffer = fs.readFileSync(filePath)
//     const parsedData = await nbt.parse(buffer);
//     return parsedData.parsed
// }

const resolvedNamesCache = new Map();

async function getCachedPlayers() {
    const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
    const playerDataDir = path.join(serverDir, `world`, `playerdata`);
    
    const players = [];

    try {
        if (!fs.existsSync(playerDataDir)) return [];

        const files = await fs.promises.readdir(playerDataDir);
        
        for (const file of files) {
            if (!file.endsWith(`.dat`)) continue;
            
            const rawUuid = file.replace(`.dat`, ``);
            const uuid = rawUuid.length === 32 
                ? `${rawUuid.slice(0,8)}-${rawUuid.slice(8,12)}-${rawUuid.slice(12,16)}-${rawUuid.slice(16,20)}-${rawUuid.slice(20)}`
                : rawUuid;

            let username = null;

            try {
                const buffer = await fs.promises.readFile(path.join(playerDataDir, file));
                const parsedData = await nbt.parse(buffer);
                const data = parsedData.parsed.value;

                if (data.Bukkit && data.Bukkit.value && data.Bukkit.value.lastKnownName) {
                    username = data.Bukkit.value.lastKnownName.value;
                }
            } catch (e) {
            }

            if (!username && resolvedNamesCache.has(uuid)) {
                username = resolvedNamesCache.get(uuid);
            }

                        if (!username) {
                try {
                    const cachePath = path.join(serverDir, `usercache.json`);
                    if (fs.existsSync(cachePath)) {
                        const cacheData = JSON.parse(fs.readFileSync(cachePath, `utf8`));
                        const found = cacheData.find(p => p.uuid === uuid || p.uuid === rawUuid);
                        if (found) {
                            username = found.name;
                        }
                    }
                } catch (e) {}
            }


            if (!username) {
                try {
                    const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, ``)}`);
                    if (res.ok) {
                        const profile = await res.json();
                        if (profile.name) {
                            username = profile.name;
                            resolvedNamesCache.set(uuid, username);
                        }
                    }
                } catch (apiErr) {
                }
            }

            if (!username) {
                username = `Unknown (${rawUuid.substring(0, 4)})`;
            }

            players.push({ username, uuid });
        }

        return players.sort((a, b) => a.username.localeCompare(b.username));

    } catch (err) {
        console.error(`Failed to read player data:`, err);
        return [];
    }
}

function renderPlayerMenu() {
    let prompt = `[ PLAYERS ]\n`;
    prompt += `Select a player number to view details\n`;
    prompt += `-------------------------\n`;
    
    const itemsPerPage = 10;
    const start = playerMenuState.page * itemsPerPage;
    const end = start + itemsPerPage;
    const currentPlayers = playerMenuState.players.slice(start, end);

    if (currentPlayers.length === 0) {
        prompt += `(No players found in playerdata)\n`;
    } else {
        currentPlayers.forEach((player, index) => {
            const globalIndex = start + index + 1;
            const num = String(globalIndex).padStart(2, `0`);
            prompt += `[${num}] ${player.username}\n`;
        });
    }

    prompt += `\n[N] Next Page | [M] Prev Page\n`;
    prompt += `[K <num>] Kick | [B <num>] Ban | [P <num>] Pardon\n`;

    return safeCodeBlock(prompt, 2000, `ini`);
}

async function resolvePlayerName(uuid) {
    try {
        const cleanUuid = uuid.replace(/-/g, ``);
        
        const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${cleanUuid}`);
        if (!res.ok) return `Player-${uuid.substring(0, 4)}`;
        
        const data = await res.json();
        return data.name || `Player-${uuid.substring(0, 4)}`;
    } catch (err) {
        return `Player-${uuid.substring(0, 4)}`;
    }
}

async function getPlayerInventory(player) {
    const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
    const filePath = path.join(serverDir, `world`, `playerdata`, `${player.uuid}.dat`);

    if (!fs.existsSync(filePath)) {
        return "Player data not found.";
    }

    try {
        const buffer = fs.readFileSync(filePath);
        const parsedData = await nbt.parse(buffer);
        const data = parsedData.parsed.value;

        if (!data.Inventory || !data.Inventory.value || !data.Inventory.value.value) {
            return "Inventory is empty or data is missing.";
        }

        const inventoryItems = data.Inventory.value.value;
        let invString = "";

        const sortedItems = inventoryItems.sort((a, b) => {
            const slotA = a.Slot ? a.Slot.value : 0;
            const slotB = b.Slot ? b.Slot.value : 0;
            return slotA - slotB;
        });

        sortedItems.forEach((item, index) => {
            const count = Number(item.count?.value ?? 1);
            const slot  = Number(item.Slot?.value ?? 0);
            const id    = item.id?.value ?? 'unknown';
            
            let itemName = id.replace(`minecraft:`, ``).replace(/_/g, ` `);
            itemName = itemName.replace(/\b\w/g, c => c.toUpperCase());

            let slotName = `Slot ${slot}`;
            if (slot >= 0 && slot <= 8) slotName = `Hotbar ${slot + 1}`;
            else if (slot >= 9 && slot <= 35) slotName = `Inv ${slot - 8}`;
            else if (slot === 100) slotName = `Boots`;
            else if (slot === 101) slotName = `Leggings`;
            else if (slot === 102) slotName = `Chestplate`;
            else if (slot === 103) slotName = `Helmet`;
            else if (slot === -106) slotName = `Offhand`;

            invString += `[${slotName}] ${count}x ${itemName}\n`;
        });

        console.log(JSON.stringify(inventoryItems[0], null, 2));

        return invString.length > 0 ? invString : "Inventory is empty.";

    } catch (err) {
        return `Error parsing inventory: ${err.message}`;
    }
}

async function renderPlayerInfo(player) {
    let prompt = `[ ${player.username} ]\n`;
    prompt += `-------------------------\n`;
    prompt += `UUID: ${player.uuid}\n\n`;

    try {
        const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);
        const filePath = path.join(serverDir, `world`, `playerdata`, `${player.rawUuid || player.uuid}.dat`);
        
        if (fs.existsSync(filePath)) {
            const buffer = fs.readFileSync(filePath);
            const parsedData = await nbt.parse(buffer);
            const data = parsedData.parsed.value;

            const health = data.Health ? data.Health.value : `Unknown`;
            const gamemode = data.playerGameType ? data.playerGameType.value : `Unknown`;
            const xpLevel = data.XpLevel ? data.XpLevel.value : `Unknown`;
            
            let posString = `Unknown`;
            if (data.Pos && data.Pos.value && data.Pos.value.value) {
                const pos = data.Pos.value.value;
                posString = `X: ${pos[0].toFixed(1)}, Y: ${pos[1].toFixed(1)}, Z: ${pos[2].toFixed(1)}`;
            }

            const gameModes = { 0: `Survival`, 1: `Creative`, 2: `Adventure`, 3: `Spectator` };

            prompt += `[ Health ] ${health} / 20\n`;
            prompt += `[ Game mode ] ${gameModes[gamemode] || gamemode}\n`;
            prompt += `[ XP ] ${xpLevel}\n`;
            prompt += `[ Position ] ${posString}\n`;

        } else {
            prompt += `(Player data not found.)\n`;
        }
    } catch (err) {
        prompt += `(Failed to read player data: ${err.message})\n`;
    }

    prompt += `[D] Restore player data`
    prompt += `\n[I] Inventory | [R] Refresh\n`;
    prompt += `[K] Kick | [B] Ban | [Q] Quit`;
    
    return safeCodeBlock(prompt, 2000, `ini`);
}

async function initPlayerMenu() {
    if (!panelConfig.panelPlayersChannelId) return;
    
    const channel = client.channels.cache.get(panelConfig.panelPlayersChannelId);
    if (!channel) return;

    playerMenuState.players = await getCachedPlayers();

    try {
        if (panelConfig.panelPlayersMessageId) {
            const msg = await channel.messages.fetch(panelConfig.panelPlayersMessageId).catch(() => null);
            if (msg) {
                await msg.edit(renderPlayerMenu());
                return;
            }
        }
        
        const newMsg = await channel.send(renderPlayerMenu());
        panelConfig.panelPlayersMessageId = newMsg.id;
        savePanelConfig();
    } catch (err) {
        console.error("Failed to send player menu message:", err);
    }
}

async function refreshPlayerMenu() {
    if (!panelConfig.panelPlayersChannelId || !panelConfig.panelPlayersMessageId) return;
    if (playerMenuState.pendingConfirm || playerMenuState.isShowingPopup) return;
    if (playerMenuState.action !== null) return;
    if (restoreMenuState.active) return;

    const channel = client.channels.cache.get(panelConfig.panelPlayersChannelId);
    if (!channel) return;

    const menuMsg = await channel.messages.fetch(panelConfig.panelPlayersMessageId).catch(() => null);
    if (!menuMsg) return;

    playerMenuState.players = await getCachedPlayers();
    
    const newText = renderPlayerMenu();
    if (menuMsg.content !== newText) {
        await menuMsg.edit(newText).catch(() => {});
    }
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

function getWorldDirectory(serverDir) {
    let levelName = `world`;

    const propertiesPath = path.join(serverDir, `server.properties`);

    if(fs.existsSync(propertiesPath)) {
        const lines = fs.readFileSync(propertiesPath, `utf8`).split(/\r?\n/);

        for (const line of lines) {
            if(line.trim().startsWith(`#`)) continue;

            const seperator = line.indexOf(`=`);
            if(seperator === -1) continue;

            const key = line.slice(0, seperator).trim();

            if(key === `level-name`) {
                levelName = line.slice(seperator + 1).trim() || `world`;
                break;
            }
        }
    }
    
    levelName = levelName.replace(/[\\/]+/g, path.sep);

    if(path.isAbsolute(levelName) || /^[a-zA-Z]:/.test(levelName)) {
        throw new Error(`Invalid world directory name`);
    }

    const worldDir = path.resolve(serverDir, levelName);

    if(worldDir === serverDir || !isPathInside(serverDir, worldDir)) {
        throw new Error(`World directory is not in server directory`)
    }

    return {
        directory: worldDir,
        archivePath: path.relative(serverDir, worldDir).split(path.sep).join(`/`)
    };
}

async function restorePlayerDataFromBackup(
    backupFile,
    playerUuid,
    categories = [`playerdata`, `stats`, `advancements`]
) {
    if (isBackingUp) {
        throw new Error(`A backup is currently running.`);
    }

    if (isRestoringPlayerData) {
        throw new Error(`A player restore is already running.`);
    }

    if (mcProcess) {
        throw new Error(`Stop the Minecraft server before restoring player data.`);
    }

    isRestoringPlayerData = true;

    try {
        if (!panelConfig.panelServerDirectory) {
            throw new Error(`Server directory is not configured.`);
        }

        const uuid = String(playerUuid).toLowerCase();

        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
            throw new Error(`Invalid player UUID.`);
        }

        const serverDir = path.resolve(
            __dirname,
            panelConfig.panelServerDirectory
        );

        const world = getWorldDirectory(serverDir);

        const definitions = {
            playerdata: {
                folder: `playerdata`,
                extension: `dat`
            },
            stats: {
                folder: `stats`,
                extension: `json`
            },
            advancements: {
                folder: `advancements`,
                extension: `json`
            }
        };

        const selectedCategories = [...new Set(categories)];

        if (
            selectedCategories.length === 0 ||
            selectedCategories.some(category => !definitions[category])
        ) {
            throw new Error(`Invalid player data categories.`);
        }

        const filesToRestore = [];
        const missingFiles = [];

        for (const category of selectedCategories) {
            const definition = definitions[category];

            const relativePath =
                `${world.archivePath}/${definition.folder}/${uuid}.${definition.extension}`;

            const buffer = await readZipEntryBuffer(
                backupFile,
                relativePath
            );

            if (!buffer) {
                missingFiles.push(category);
                continue;
            }

            filesToRestore.push({
                category,
                relativePath,
                targetPath: path.join(
                    world.directory,
                    definition.folder,
                    `${uuid}.${definition.extension}`
                ),
                buffer
            });
        }

        if (
            selectedCategories.includes(`playerdata`) &&
            missingFiles.includes(`playerdata`)
        ) {
            throw new Error(`Player data file was not found in this backup.`);
        }

        if (filesToRestore.length === 0) {
            throw new Error(`No matching player files were found in this backup.`);
        }

        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, `-`);

        const safetyDirectory = path.join(
            __dirname,
            `PlayerDataRestoreBackup`,
            timestamp
        );

        const stagedFiles = [];

        try {
            for (const file of filesToRestore) {
                await fs.promises.mkdir(
                    path.dirname(file.targetPath),
                    { recursive: true }
                );

                let safetyPath = null;

                if (fs.existsSync(file.targetPath)) {
                    safetyPath = path.join(
                        safetyDirectory,
                        ...file.relativePath.split(`/`)
                    );

                    await fs.promises.mkdir(
                        path.dirname(safetyPath),
                        { recursive: true }
                    );

                    await fs.promises.copyFile(
                        file.targetPath,
                        safetyPath
                    );
                }

                const tempPath =
                    `${file.targetPath}.restore-${process.pid}-${Date.now()}-${stagedFiles.length}.tmp`;

                await fs.promises.writeFile(
                    tempPath,
                    file.buffer,
                    { flag: `wx` }
                );

                stagedFiles.push({
                    ...file,
                    tempPath,
                    safetyPath
                });
            }

            const committed = [];

            try {
                for (const file of stagedFiles) {
                    try {
                        await fs.promises.rename(
                            file.tempPath,
                            file.targetPath
                        );
                    } catch (err) {
                        if (
                            file.safetyPath &&
                            [`EEXIST`, `EPERM`].includes(err.code)
                        ) {
                            await fs.promises.unlink(file.targetPath);
                            await fs.promises.rename(
                                file.tempPath,
                                file.targetPath
                            );
                        } else {
                            throw err;
                        }
                    }

                    committed.push(file);
                }
            } catch (err) {
                for (const file of committed.reverse()) {
                    if (file.safetyPath) {
                        await fs.promises.copyFile(
                            file.safetyPath,
                            file.targetPath
                        ).catch(() => {});
                    } else {
                        await fs.promises.unlink(file.targetPath)
                            .catch(() => {});
                    }
                }

                throw err;
            }

        } finally {
            for (const file of stagedFiles) {
                await fs.promises.unlink(file.tempPath).catch(() => {});
            }
        }

        return {
            restored: filesToRestore.map(file => file.category),
            missing: missingFiles,
            safetyDirectory
        };

    } finally {
        isRestoringPlayerData = false;
    }
}


function readZipEntryBuffer(zipPath, wantedEntryName) {
    return new Promise((resolve, reject) => {
        archive2.open(
            zipPath,
            {
                lazyEntries: true,
                autoClose: false
            },
            (err, zipfile) => {
                if (err) return reject(err);

                let settled = false;

                function finish(error, buffer = null) {
                    if (settled) return;
                    settled = true;

                    try {
                        zipfile.close();
                    } catch {}

                    if (error) {
                        reject(error);
                    } else {
                        resolve(buffer);
                    }
                }

                zipfile.on(`error`, err => finish(err));

                zipfile.on(`end`, () => finish(null, null));

                zipfile.on(`entry`, entry => {
                    if (entry.fileName !== wantedEntryName) {
                        zipfile.readEntry();
                        return;
                    }

                    if (entry.uncompressedSize > 64 * 1024 * 1024) {
                        finish(new Error(`Player file exceeds size limit.`));
                        return;
                    }

                    zipfile.openReadStream(entry, (err, stream) => {
                        if (err) {
                            finish(err);
                            return;
                        }

                        const chunks = [];
                        let totalSize = 0;

                        stream.on(`data`, chunk => {
                            totalSize += chunk.length;

                            if (totalSize > 64 * 1024 * 1024) {
                                stream.destroy(
                                    new Error(`Player file exceeds size limit.`)
                                );
                                return;
                            }

                            chunks.push(chunk);
                        });

                        stream.on(`error`, err => finish(err));

                        stream.on(`end`, () => {
                            finish(null, Buffer.concat(chunks));
                        });
                    });
                });

                zipfile.readEntry();
            }
        );
    });
}

function getBackups() {
    const rules = loadBackupRules();
    const allBackups = [];

    for (const rule of rules) {
        const serverDir = path.resolve(__dirname, panelConfig.panelServerDirectory);

        const isBotRelative = /^\.([/\\])/.test(rule.destination);
        const normalizedDestination = process.platform === `win32`
        ? rule.destination.replace(/\//g, path.sep)
        : rule.destination.replace(/\\/g, path.sep);

        const backupDir = path.resolve(
            isBotRelative ? __dirname : serverDir,
            normalizedDestination
        );
        
        if (!fs.existsSync(backupDir)) continue;

        try {
            const files = fs.readdirSync(backupDir)
            .filter(f => f.endsWith(`.zip`))
            .map(f => {
                const stats = fs.statSync(path.join(backupDir, f));
                return {
                    name: f,
                    path: path.join(backupDir, f),
                    time: stats.mtime,
                    ruleName: rule.name,
                    sizeMB: (stats.size / 1024 / 1024).toFixed(2)
                };
            });

            allBackups.push(...files);
        } catch(err) {
            console.error(`Failed to read backups for rule {${rule.name}}: ${err.message}`)
        }
    }
    return allBackups.sort((a, b) => b.time - a.time);
}

function renderRestoreMenu(player) {
    const backups = getBackups();
    restoreMenuState.backups = backups;

    let prompt = `[ Restore player data ]\n`;
    prompt += `Player: ${player.username}\n`;
    prompt += `------------------------\n`;
    prompt += `Server must be stopped before restoring player data\n\n`;

    if (backups.length === 0) {
        prompt += `(No backups found in any rules)\n`
    } else {
        const itemsPerPage = 24;
        const start = (restoreMenuState.page || 0) * itemsPerPage;
        const end = start + itemsPerPage;
        const current = backups.slice(start, end);

        current.forEach((b, i) => {
            const num = String(start + i + 1).padStart(2, `0`);
            prompt += `[${num}] ${b.ruleName} | ${b.sizeMB} MB\n`;
            prompt += `     Date: ${b.time.toLocaleString()}\n`
        });

        const totalPages = Math.ceil(backups.length / itemsPerPage);
        if (totalPages > 1) {
            prompt += `\nPage ${(restoreMenuState.page || 0) + 1}/${totalPages}\n`
            prompt += `[N] Next | [P] Prev\n`
        }
    }
    prompt += `\n[Q] Back`;
    return safeCodeBlock(prompt, 2000, `ini`);
}

function renderRestoreConfirm(player, backupName) {
    let prompt = `[ Confirm player data restore ]\n`;
    prompt += `------------------------\n`;
    prompt += `Player: ${player.username}\n`;
    prompt += `Backup: ${backupName}\n\n`;
    prompt += `This will replace their player data, statistics and advancements.\n\n`;
    prompt += `Ensure the server is stopped before proceeding.\n\n`;
    prompt += `[Y/n]`;

    return safeCodeBlock(prompt, 2000, `ini`);
}



// Config menu



const configMenuFiles = [
    { id: `serverProperties`, name: `server.properties` },
    { id: `chatSync`, name: `chatsync-config.json` },
    { id: `panelConfig`, name: `panel-config.json` }
];

const CONFIG_ITEMS_PER_PAGE = 24;

function isPanelConfigLocked() {
    try {
        const config = JSON.parse(
            fs.readFileSync(panelConfigPath, `utf-8`)
        );

        return config.lockServerDirectory === true;
    } catch (err) {
        console.error("Failed to check server directory lock:", err);
        return true;
    }
}

function getConfigFilePath(file) {
    if (file.id === `serverProperties`) {
        if (!panelConfig.panelServerDirectory) {
            throw new Error(`Server directory is not configured.`);
        }

        return path.resolve(
            __dirname,
            panelConfig.panelServerDirectory,
            `server.properties`
        );
    }

    if (file.id === `chatSync`) {
        return chatsyncConfigPath;
    }

    if (file.id === `panelConfig`) {
        return panelConfigPath;
    }

    throw new Error(`Unknown configuration file.`);
}

function loadConfigEntries(file) {
    const filePath = getConfigFilePath(file);

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    if (file.id === `serverProperties`) {
        const content = fs.readFileSync(filePath, `utf8`);
        const lines = content.split(/\r?\n/);

        const entries = [];

        lines.forEach((line) => {
            const separator = line.indexOf(`=`);

            if (separator === -1) return;
            if (line.trim().startsWith(`#`)) return;

            const key = line.slice(0, separator).trim();

            if (!key) return;

            entries.push({
                key,
                value: line.slice(separator + 1).trim()
            });
        });

        return entries;
    }

    const data = JSON.parse(fs.readFileSync(filePath, `utf8`));

    const lockedKeys = file.id === `panelConfig` && isPanelConfigLocked()
        ? [`panelServerDirectory`, `lockServerDirectory`]
        : [];

    return Object.entries(data)
        .filter(([key, value]) => {
            if (lockedKeys.includes(key)) return false;

            return value === null ||
                [`string`, `number`, `boolean`].includes(typeof value);
        })
        .map(([key, value]) => ({
            key,
            value
        }));
}

function formatConfigValue(key, value) {
    if (/password|webhookurl|token|secret/i.test(key)) {
        return value ? `[Hidden]` : `(Empty)`;
    }

    return String(value)
        .replace(/\r?\n/g, `\\n`)
        .replace(/```/g, '``\u200b`')
        .slice(0, 100);
}

function renderConfigMenu() {
    let prompt = `[ Configuration ]\n`;
    prompt += `Select a config to change\n`;
    prompt += `------------------------\n`;

    configMenuFiles.forEach((file, index) => {
        prompt += `[${index + 1}] ${file.name}\n`;
    });

        if (isPanelConfigLocked()) {
        prompt += `\n[LOCKED] Server directory changes are disabled.\n`;
        prompt += `Edit panel-config.json manually to unlock.\n`;
    }
    return safeCodeBlock(prompt, 3900, `ini`);
}

function renderSelectedConfigMenu(file) {
    if (configMenuState.error) {
        return safeCodeBlock(
            `[ Config error ]\n\n` +
            `${configMenuState.error}\n\n` +
            `[Q] Quit`,
            3900,
            `ini`
        );
    }

    const entries = configMenuState.entries;

    const start = configMenuState.page * CONFIG_ITEMS_PER_PAGE;
    const end = start + CONFIG_ITEMS_PER_PAGE;

    const currentEntries = entries.slice(start, end);

    let prompt = `[ ${file.name} ]\n`;
    prompt += `Select a setting to edit\n`;
    prompt += `------------------------\n`;

    if (configMenuState.notice) {
        prompt += `[ File saved ] ${configMenuState.notice}\n\n`;
        configMenuState.notice = null;
    }

    if (entries.length === 0) {
        prompt += `(No editable settings found)\n`;
    } else {
        currentEntries.forEach((entry, index) => {
            const number = start + index + 1;
            const value = formatConfigValue(entry.key, entry.value);

            prompt += `[${number}] ${entry.key} = ${value}\n`;
        });
    }

    const totalPages = Math.max(
        1,
        Math.ceil(entries.length / CONFIG_ITEMS_PER_PAGE)
    );

    prompt += `\nPage ${configMenuState.page + 1}/${totalPages}\n`;
    prompt += `[N] Next | [P] Previous | [Q] Quit`;

    return safeCodeBlock(prompt, 3900, `ini`);
}

function renderConfigEditMenu(file, entry, error = null) {
    let prompt = `[ Edit value ]\n`;
    prompt += `------------------------\n`;
    prompt += `File: ${file.name}\n`;
    prompt += `Setting: ${entry.key}\n`;
    prompt += `Current value: ${formatConfigValue(entry.key, entry.value)}\n\n`;

    if (error) {
        prompt += `[ Error ] ${error}\n\n`;
    }

    prompt += `Enter the new value:\n`;
    prompt += `[Q] Cancel`;

    return safeCodeBlock(prompt, 3900, `ini`);
}

function saveConfigEntry(file, key, input) {
        if (
        file.id === `panelConfig` &&
        isPanelConfigLocked() &&
        [`panelServerDirectory`, `lockServerDirectory`].includes(key)
    ) {
        throw new Error(
            `This setting is locked. Manually edit panel-config.json to unlock it.`
        );
    }
    if (/[\r\n]/.test(input)) {
        throw new Error(`Values cannot contain newlines.`);
    }

    const filePath = getConfigFilePath(file);

    if (file.id === `serverProperties`) {
        const content = fs.readFileSync(filePath, `utf8`);
        const newline = content.includes(`\r\n`) ? `\r\n` : `\n`;

        const lines = content.split(/\r?\n/);

        const index = lines.findIndex(line => {
            const separator = line.indexOf(`=`);

            if (separator === -1) return false;
            if (line.trim().startsWith(`#`)) return false;

            return line.slice(0, separator).trim() === key;
        });

        if (index === -1) {
            throw new Error(`Setting "${key}" was not found.`);
        }

        lines[index] = `${key}=${input}`;

        fs.writeFileSync(filePath, lines.join(newline), 'utf8');

        return;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!Object.prototype.hasOwnProperty.call(data, key)) {
        throw new Error(`Setting "${key}" was not found.`);
    }

    const oldValue = data[key];

    let newValue;

    if (typeof oldValue === 'boolean') {
        if (!['true', 'false'].includes(input.toLowerCase())) {
            throw new Error('Value must be true or false.');
        }

        newValue = input.toLowerCase() === 'true';

    } else if (typeof oldValue === 'number') {
        newValue = Number(input);

        if (!Number.isFinite(newValue)) {
            throw new Error('Value must be a valid number.');
        }

    } else {
        newValue = input;
    }

    data[key] = newValue;

    fs.writeFileSync(
        filePath,
        JSON.stringify(data, null, 2),
        'utf8'
    );

    readConfigs();
}

async function initConfigMenu() {
    if (!panelConfig.panelConfigChannelId) return;

    const channel = client.channels.cache.get(
        panelConfig.panelConfigChannelId
    );

    if (!channel) return;

    try {
        if (panelConfig.panelConfigMessageId) {
            const msg = await channel.messages.fetch(
                panelConfig.panelConfigMessageId
            ).catch(() => null);

            if (msg) {
                await msg.edit(renderConfigMenu());
                return;
            }
        }

        const newMsg = await channel.send(renderConfigMenu());

        panelConfig.panelConfigMessageId = newMsg.id;
        savePanelConfig();

    } catch (err) {
        console.error('Failed to send config menu:', err);
    }
}



// Skin caching




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




// Capability




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


function getGroupStatus(group) {
    if (group.features.length === 0) return 'none';
    const supportedCount = group.features.filter(f => agreed.has(f)).length;
        
    if (supportedCount === group.features.length) return 'full';
    if (supportedCount > 0) return 'partial';
    return 'none';
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

const playerData = await getCachedPlayers();

for (const player of playerData) {
    console.log(`${player.username}: ${player.uuid}`)
}

if (panelTickInterval) clearInterval(panelTickInterval);
panelTickInterval = setInterval(panelTick, panelConfig.panelTickInterval*1000); 
        
initFileMenu();
initPlayerMenu();
initBackupMenu();
initConfigMenu();
setTimeout(updateDashboard, panelConfig.panelTickInterval*1000);

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

            if (Message.channelId === panelConfig.panelBackupsChannelId) {
                const input = Message.content.trim();
                const lowerInput = input.toLowerCase();
                const firstChar = input.charAt(0).toUpperCase();
                
                await Message.delete().catch(() => {});

                if (!panelConfig.panelBackupsMessageId) return;
                const channel = client.channels.cache.get(panelConfig.panelBackupsChannelId);
                const menuMsg = await channel.messages.fetch(panelConfig.panelBackupsMessageId).catch(() => null);
                
                if (!menuMsg) {
                    panelConfig.panelBackupsMessageId = "";
                    savePanelConfig();
                    return initBackupMenu();
                }

                if (backupConfigState.active) {
                    if (lowerInput === 'q') {
                        resetBackupConfigState();
                        backupMenuState.rules = loadBackupRules();
                        return menuMsg.edit(renderBackupMenu(backupMenuState.rules));
                    }

                    if (backupConfigState.step === 1) {
                        backupConfigState.name = input;
                        backupConfigState.step = 2;
                        return menuMsg.edit(renderBackupConfigMenu());
                    }

                    if (backupConfigState.step === 2) {
                        backupConfigState.exclude =
                            ['none..', '-'].includes(lowerInput) ? '' : input;

                        backupConfigState.step = 3;
                        return menuMsg.edit(renderBackupConfigMenu());
                    }

                    if (backupConfigState.step === 3) {
                        backupConfigState.destination = input;
                        backupConfigState.step = 4;
                        return menuMsg.edit(renderBackupConfigMenu());
                    }

                    if (backupConfigState.step === 4) {
                        const maxBackups = Number(input);

                        if (!Number.isSafeInteger(maxBackups) || maxBackups < 0) {
                            return menuMsg.edit(
                                safeCodeBlock(
                                    `[ ERROR ]\nEnter a whole number greater than or equal to 0.`,
                                    2000,
                                    'ini'
                                )
                            );
                        }

                        backupConfigState.maxBackups = maxBackups;

                        const ruleId = backupConfigState.name
                            .trim()
                            .toLowerCase()
                            .replace(/\s+/g, '_')
                            .replace(/[^a-z0-9_-]/g, '');

                        if (!ruleId) {
                            return menuMsg.edit(
                                safeCodeBlock(`[ ERROR ]\nInvalid rule name.`, 2000, 'ini')
                            );
                        }

                        const newRulePath = path.join(backupRulesDir, `${ruleId}.json`);

                        const oldRulePath = backupConfigState.mode === 'edit'
                            ? path.join(backupRulesDir, `${backupConfigState.ruleId}.json`)
                            : null;

                        if (fs.existsSync(newRulePath) && newRulePath !== oldRulePath) {
                            return menuMsg.edit(
                                safeCodeBlock(`[ ERROR ]\nA rule with that name already exists.\n\n[Q] Quit`, 2000, 'ini')
                            );
                        }

                        const ruleData = {
                            exclude: backupConfigState.exclude
                                .split(',')
                                .map(s => s.trim())
                                .filter(Boolean),

                            destination: backupConfigState.destination,
                            maxBackups: backupConfigState.maxBackups
                        };

                        try {
                            if (!fs.existsSync(backupRulesDir)) {
                                fs.mkdirSync(backupRulesDir, { recursive: true });
                            }

                            fs.writeFileSync(
                                newRulePath,
                                JSON.stringify(ruleData, null, 2)
                            );

                            if (oldRulePath && oldRulePath !== newRulePath && fs.existsSync(oldRulePath)) {
                                fs.unlinkSync(oldRulePath);
                            }

                        } catch (err) {
                            return menuMsg.edit(
                                safeCodeBlock(`[ ERROR ]\nFailed to save rule: ${err.message}`, 2000, 'ini')
                            );
                        }

                        resetBackupConfigState();

                        backupMenuState.rules = loadBackupRules();

                        return menuMsg.edit(renderBackupMenu(backupMenuState.rules));
                    }
                }

                if (lowerInput === 'c') {
                    backupConfigState = {
                        active: true,
                        step: 1,
                        mode: "create",
                        ruleId: null,
                        name: "",
                        exclude: "",
                        destination: "",
                        maxBackups: ""
                    };

                    return menuMsg.edit(renderBackupConfigMenu());
                }

                const editMatch = input.match(/^e\s+(\d+)$/i);

                if (editMatch) {
                    backupMenuState.rules = loadBackupRules();

                    const ruleNumber = Number(editMatch[1]);
                    const rule = backupMenuState.rules[ruleNumber - 1];

                    if (!rule) {
                        backupMenuState.isShowingPopup = true;

                        return menuMsg.edit(
                            safeCodeBlock(`[ ERROR ]\nInvalid backup rule number.`, 2000, 'ini')
                        );
                    }

                    backupConfigState = {
                        active: true,
                        step: 1,
                        mode: "edit",
                        ruleId: rule.id,
                        name: rule.name,
                        exclude: rule.exclude.join(', '),
                        destination: rule.destination,
                        maxBackups: rule.maxBackups
                    };

                    return menuMsg.edit(renderBackupConfigMenu());
                }

                    const deleteMatch = input.match(/^d(\d+)$/i);

                    if (deleteMatch) {
                        backupMenuState.rules = loadBackupRules();

                        const ruleNumber = Number(deleteMatch[1]);
                        const rule = backupMenuState.rules[ruleNumber - 1];

                        if (!rule) {
                            backupMenuState.isShowingPopup = true;

                            return menuMsg.edit(
                                safeCodeBlock(`[ ERROR ]\nInvalid backup rule number.`, 2000, 'ini')
                            );
                        }

                        backupMenuState.pendingDelete = rule;
                        backupMenuState.isShowingPopup = true;

                        return menuMsg.edit(renderBackupDeleteConfirmMenu(rule));
                    }

                if (backupMenuState.pendingConfirm) {
                    if (firstChar === 'Y') {
                        const rule = backupMenuState.pendingConfirm;

                        backupMenuState.pendingConfirm = null;
                        backupMenuState.isShowingPopup = true;

                        await menuMsg.edit(
                            safeCodeBlock(
                                `[ BACKUP:RUNNING ]\n\nStarting backup for: ${rule.name}...`,
                                3900,
                                'ini'
                            )
                        );

                        createBackup(rule.id, menuMsg).then(async (result) => {
                            const success = result.startsWith('Backup complete:');

                            await menuMsg.edit(
                                safeCodeBlock(
                                    `[ BACKUP:${success ? 'SUCCESS' : 'ERROR'} ]\n\n` +
                                    (success
                                        ? `${createProgressBar(100)}\n\n${result}`
                                        : result) +
                                    `\n\nReturning to menu...`,
                                    3900,
                                    'ini'
                                )
                            );

                            setTimeout(async () => {
                                backupMenuState.isShowingPopup = false;
                                backupMenuState.rules = loadBackupRules();

                                const checkMsg = await menuMsg.fetch().catch(() => null);

                                if (checkMsg) {
                                    await checkMsg.edit(
                                        renderBackupMenu(backupMenuState.rules)
                                    );
                                }
                            }, 3000);

                        }).catch(async (err) => {
                            await menuMsg.edit(
                                safeCodeBlock(
                                    `[ BACKUP:ERROR ]\n\n${err.message}\n\nReturning to menu...`,
                                    3900,
                                    'ini'
                                )
                            );

                            setTimeout(async () => {
                                backupMenuState.isShowingPopup = false;

                                const checkMsg = await menuMsg.fetch().catch(() => null);

                                if (checkMsg) {
                                    await checkMsg.edit(
                                        renderBackupMenu(backupMenuState.rules)
                                    );
                                }
                            }, 3000);
                        });

                        return;
                    }

                    if (firstChar === 'N' || firstChar === 'Q') {
                        backupMenuState.pendingConfirm = null;
                        backupMenuState.isShowingPopup = false;

                        return menuMsg.edit(
                            renderBackupMenu(backupMenuState.rules)
                        );
                    }

                    return menuMsg.edit(
                        safeCodeBlock(
                            `[ BACKUP:INFO ]\n\nAre you sure you want to run ${backupMenuState.pendingConfirm.name}?\n\n[Y/n]`,
                            3900,
                            'ini'
                        )
                    );
                }

            if (backupMenuState.pendingDelete) {
                if (firstChar === 'Y') {
                    const rule = backupMenuState.pendingDelete;

                    try {
                        const rulePath = path.join(
                            backupRulesDir,
                            `${rule.id}.json`
                        );

                        if (!fs.existsSync(rulePath)) {
                            throw new Error("Rule file no longer exists.");
                        }

                        fs.unlinkSync(rulePath);

                        backupMenuState.pendingDelete = null;
                        backupMenuState.rules = loadBackupRules();

                        await menuMsg.edit(
                            safeCodeBlock(
                                `[ Delete successful ]\n\nDeleted backup rule: ${rule.name}\n\nReturning to menu...`,
                                2000,
                                'ini'
                            )
                        );

                        setTimeout(async () => {
                            backupMenuState.isShowingPopup = false;
                            backupMenuState.rules = loadBackupRules();

                            const checkMsg = await menuMsg.fetch().catch(() => null);

                            if (checkMsg) {
                                await checkMsg.edit(
                                    renderBackupMenu(backupMenuState.rules)
                                );
                            }
                        }, 2000);

                    } catch (err) {
                        backupMenuState.pendingDelete = null;

                        await menuMsg.edit(
                            safeCodeBlock(
                                `[ DELETE:ERROR ]\n\n${err.message}\n\nSend any message to dismiss.`,
                                2000,
                                'ini'
                            )
                        );
                    }

                    return;
                }

                if (firstChar === 'N' || firstChar === 'Q') {
                    backupMenuState.pendingDelete = null;
                    backupMenuState.isShowingPopup = false;

                    backupMenuState.rules = loadBackupRules();

                    return menuMsg.edit(
                        renderBackupMenu(backupMenuState.rules)
                    );
                }

                return menuMsg.edit(
                    renderBackupDeleteConfirmMenu(backupMenuState.pendingDelete)
                );
            }

                if (backupMenuState.isShowingPopup) {
                    backupMenuState.isShowingPopup = false;
                    await menuMsg.edit(renderBackupMenu(backupMenuState.rules));
                    return; 
                }

                if (/^\d+$/.test(input)) {
                    const index = parseInt(input) - 1;
                    const rule = backupMenuState.rules[index];

                    if (rule) {
                        backupMenuState.pendingConfirm = rule;
                        backupMenuState.isShowingPopup = true;
                        await menuMsg.edit(safeCodeBlock(`[ BACKUP:INFO ]\n\nAre you sure you want to run ${rule.name}?\n\n[Y/n]`, 3900, 'ini'));
                    } else {
                        await menuMsg.edit(safeCodeBlock(`[ ERROR ]\nInvalid backup rule number.`, 3900, 'ini'));
                    }
                    return;
                }
            }

            if (Message.channelId === panelConfig.panelPlayersChannelId) {
                const input = Message.content.trim();
                const lowerInput = input.toLowerCase();
                const firstChar = input.charAt(0).toUpperCase();
                
                await Message.delete().catch(() => {});

                if (!panelConfig.panelPlayersMessageId) return;
                const channel = client.channels.cache.get(panelConfig.panelPlayersChannelId);
                const menuMsg = await channel.messages.fetch(panelConfig.panelPlayersMessageId).catch(() => null);
                
                if (!menuMsg) {
                    panelConfig.panelPlayersMessageId = "";
                    savePanelConfig();
                    return initPlayerMenu();
                }

                if (restoreMenuState.active) {
                    const player = restoreMenuState.player;
                    const itemsPerPage = 24;

                    if(lowerInput === `q`) {
                        restoreMenuState.active = false;
                        playerMenuState.action = `VIEWING`;
                        return menuMsg.edit(await renderPlayerInfo(player));
                    }

                    if (lowerInput === `n`) {
                        const total = Math.ceil(restoreMenuState.backups.length / itemsPerPage);

                        if ((restoreMenuState.page || 0) + 1 < total) {
                            restoreMenuState.page = (restoreMenuState.page || 0) + 1;
                        }
                        return menuMsg.edit(renderRestoreMenu(player));
                    }

                    if (lowerInput === `p`) {
                        if ((restoreMenuState.page || 0 ) > 0) {
                            restoreMenuState.page = (restoreMenuState.page || 0) - 1;
                        }
                        return menuMsg.edit(renderRestoreMenu(player));
                    }

                    if (restoreMenuState.pendingConfirm) {
                        if (firstChar === `Y`) {
                            if (mcProcess) {
                                return menuMsg.edit(safeCodeBlock(`[ Error ]\nStop the server before restoring data.`, 2000, `ini`));
                            }

                            const backup = restoreMenuState.backups.find(b => b.name === restoreMenuState.selectedBackup);
                            if (!backup) return menuMsg.edit(safeCodeBlock(`[ Error ]\n Backup not found.`, 3000, `ini`));

                            await menuMsg.edit(safeCodeBlock(`[ Restoring data ]\n\nExtracting player data from ${backup.ruleName}...`, 2000, `ini`))

                            try {
                                await restorePlayerDataFromBackup(backup.path, player.uuid, [`playerdata`, `stats`, `advancements`]);
                                restoreMenuState.pendingConfirm = false;
                                restoreMenuState.active = false;
                                restoreMenuState.selectedBackup = null;
                                await menuMsg.edit(safeCodeBlock(`[ Success ] Restored data of ${player.username}\n\n[Q] Back`, 2000, `ini`));
                            } catch(err) {
                                await menuMsg.edit(safeCodeBlock(`[ Error ]\n\n${err.message}\n\n[Q] Back`, 2000, `ini`));
                            }
                            return;
                        }

                        if (firstChar === `N` || firstChar === `Q`) {
                            restoreMenuState.pendingConfirm = false;
                            return menuMsg.edit(renderRestoreMenu(player));
                        }
                        return
                    }

                    if (/^\d+$/.test(input)) {
                        const idx = parseInt(input) - 1;
                        const backup = restoreMenuState.backups[idx];
                        if (backup) {
                            restoreMenuState.selectedBackup = backup.name;
                            restoreMenuState.pendingConfirm = true;
                            return menuMsg.edit(renderRestoreConfirm(player, backup.name));
                        }
                    }
                    return;
                }

                if (playerMenuState.action === 'VIEWING') {
                    const player = playerMenuState.selectedPlayer;
                    
                    if (lowerInput === 'q') {
                        playerMenuState.action = null;
                        playerMenuState.selectedPlayer = null;
                        return menuMsg.edit(renderPlayerMenu());
                    }

                    if (lowerInput === `d`) {
                        restoreMenuState.active = true;
                        restoreMenuState.player = player;
                        restoreMenuState.page = 0;
                        restoreMenuState.pendingConfirm = false;
                        restoreMenuState.selectedBackup = null;

                        return menuMsg.edit(renderRestoreMenu(player));
                    }

                    if (lowerInput === 'r') {
                        const infoText = await renderPlayerInfo(player);
                        return menuMsg.edit(infoText);
                    }

                    if (lowerInput === 'i') {
                        playerMenuState.action = 'INVENTORY';
                        const invText = await getPlayerInventory(player);
                        let prompt = `[ Inventory of ${player.username} ]\n`;
                        prompt += `-------------------------\n`;
                        prompt += invText + `\n`;
                        prompt += `[Q] Back`;
                        return menuMsg.edit(safeCodeBlock(prompt, 2000, 'ini'));
                    }

                    if (['k', 'b'].includes(lowerInput)) {
                        if (!mcProcess) {
                            return menuMsg.edit(safeCodeBlock(`[ Error ]\nServer is offline.`, 3900, 'ini'));
                        }

                        if (lowerInput === 'k') {
                            mcProcess.stdin.write(`kick ${player.username}\n`);
                        } else if (lowerInput === 'b') {
                            mcProcess.stdin.write(`ban ${player.username}\n`);
                        }

                        await menuMsg.edit(safeCodeBlock(`[ Success ]\nExecuted ${lowerInput.toUpperCase()} on ${player.username}.\n\nReturning to list...`, 3900, 'ini'));
                        
                        setTimeout(async () => {
                            playerMenuState.action = null;
                            playerMenuState.selectedPlayer = null;
                            const checkMsg = await menuMsg.fetch().catch(() => null);
                            if (checkMsg) await checkMsg.edit(renderPlayerMenu());
                        }, 2000);
                        return;
                    }
                    
                    const infoText = await renderPlayerInfo(player);
                    return menuMsg.edit(infoText);
                }

                if (playerMenuState.action === 'INVENTORY') {
                    if (lowerInput === 'q') {
                        playerMenuState.action = 'VIEWING';
                        const infoText = await renderPlayerInfo(playerMenuState.selectedPlayer);
                        return menuMsg.edit(infoText);
                    }
                    return;
                }

                if (lowerInput === 'n') {
                    playerMenuState.page++;
                    if (playerMenuState.page * 10 >= playerMenuState.players.length) {
                        playerMenuState.page = 0;
                    }
                    return menuMsg.edit(renderPlayerMenu());
                }
                if (lowerInput === 'm') {
                    playerMenuState.page--;
                    if (playerMenuState.page < 0) {
                        playerMenuState.page = Math.max(0, Math.ceil(playerMenuState.players.length / 10) - 1);
                    }
                    return menuMsg.edit(renderPlayerMenu());
                }

                if (/^\d+$/.test(lowerInput)) {
                    const playerIndex = parseInt(lowerInput) - 1;
                    const selectedPlayer = playerMenuState.players[playerIndex];

                    if (selectedPlayer) {
                        playerMenuState.selectedPlayer = selectedPlayer;
                        playerMenuState.action = 'VIEWING';
                        
                        const infoText = await renderPlayerInfo(selectedPlayer);
                        return menuMsg.edit(infoText);
                    } else {
                        return menuMsg.edit(safeCodeBlock(`[ Error ]\nInvalid player number.`, 3900, 'ini'));
                    }
                }

                const parts = input.split(' ');
                const action = parts[0].toUpperCase();
                const targetNum = parseInt(parts[1]);

                if (['K', 'B', 'P'].includes(action)) {
                    if (isNaN(targetNum) || !playerMenuState.players[targetNum - 1]) {
                        playerMenuState.isShowingPopup = true;
                        return menuMsg.edit(safeCodeBlock(`[ Error ]\nInvalid player number.`, 3900, 'ini'));
                    }

                    const targetPlayer = playerMenuState.players[targetNum - 1];

                    if (!mcProcess) {
                        playerMenuState.isShowingPopup = true;
                        return menuMsg.edit(safeCodeBlock(`[ Error ]\nServer is offline. Cannot run commands.`, 3900, 'ini'));
                    }

                    if (action === 'K') {
                        mcProcess.stdin.write(`kick ${targetPlayer.username}\n`);
                    } else if (action === 'B') {
                        mcProcess.stdin.write(`ban ${targetPlayer.username}\n`);
                    } else if (action === 'P') {
                        mcProcess.stdin.write(`pardon ${targetPlayer.username}\n`);
                    }

                    playerMenuState.isShowingPopup = true;
                    await menuMsg.edit(safeCodeBlock(`[ Success ]\nExecuted ${action} on ${targetPlayer.username}.\n\nReturning to menu...`, 3900, 'ini'));

                    setTimeout(async () => {
                        playerMenuState.isShowingPopup = false;
                        const checkMsg = await menuMsg.fetch().catch(() => null);
                        if (checkMsg) await checkMsg.edit(renderPlayerMenu());
                    }, 2000);
                    return;
                }
            }

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
                            await menuMsg.edit(safeCodeBlock(`[ Delete ]\n\nDeleted ${itemToDelete.name}.`, 3900, 'ini'));

                            setTimeout(async () => {
                                const checkMsg = await menuMsg.fetch().catch(() => null);
                                if (checkMsg && !fileMenuState.isShowingPopup) await menuMsg.edit(renderFileMenu());
                            }, 2000);
                        } catch (err) {
                            fileMenuState.pendingConfirm = null;
                            fileMenuState.isShowingPopup = false;
                            await menuMsg.edit(safeCodeBlock(`[ Delete: error ]\nFailed to delete: ${err.message}\n\nPress any key to dismiss.`, 3900, 'ini'));
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

                    return menuMsg.edit(renderConfirmMenu('Delete', fileMenuState.pendingConfirm));
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
                            await menuMsg.edit(safeCodeBlock(`[ Select ]\n\nFile: ${selectedItem.name}\n\nSend any message to dismiss`, 3900, 'ini'));
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
                        return menuMsg.edit(safeCodeBlock(`[ Select: error ]\nInvalid file number selected\n\nSend any message to dismiss`, 3900, 'ini'));
                    }
                    
                    fileMenuState.pendingConfirm = selectedItem;
                    fileMenuState.isShowingPopup = true;
                    return menuMsg.edit(renderConfirmMenu('Delete', selectedItem));
                }

                if (firstChar === 'R') {
                    if (!selectedItem) {
                        fileMenuState.isShowingPopup = true;
                        return menuMsg.edit(safeCodeBlock(`[ Select: error ]\nInvalid file number.\nUsage: r[file number] [new name]\n\nSend any message to dismiss`, 3900, 'ini'));
                    }

                    const parts = input.split(' ');
                    const newName = parts.slice(1).join(' ');
                    
                    if (!newName) {
                        fileMenuState.isShowingPopup = true;
                        return menuMsg.edit(safeCodeBlock(`[ Rename: error ]\nYou must provide a new name.\nUsage: r[file number] [new name]\n\nSend any message to dismiss`, 3900, 'ini'));
                    }

                    try {
                        fs.renameSync(path.join(targetDir, selectedItem.name), path.join(targetDir, newName));
                        loadFiles();
                        
                        fileMenuState.isShowingPopup = true;
                        await menuMsg.edit(safeCodeBlock(`[ Rename ]\n\nRenamed ${selectedItem.name} to ${newName}.\n\nReturning to menu...`, 3900, 'ini'));
                        
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

            if (Message.channelId === panelConfig.panelConfigChannelId) {
                const input = Message.content.trim();
                const lowerInput = input.toLowerCase();

                await Message.delete().catch(() => {});

                if (!panelConfig.panelConfigMessageId) return;

                const channel = client.channels.cache.get(
                    panelConfig.panelConfigChannelId
                );

                if (!channel) return;

                const menuMsg = await channel.messages.fetch(
                    panelConfig.panelConfigMessageId
                ).catch(() => null);

                if (!menuMsg) {
                    panelConfig.panelConfigMessageId = '';
                    savePanelConfig();
                    return initConfigMenu();
                }

                if (configMenuState.editing) {
                    const entry = configMenuState.editing;
                    const file = configMenuState.selectedFile;

                    if (lowerInput === 'q') {
                        configMenuState.editing = null;

                        return menuMsg.edit(
                            renderSelectedConfigMenu(file)
                        );
                    }

                    try {
                        saveConfigEntry(file, entry.key, input);

                        configMenuState.entries = loadConfigEntries(file);
                        configMenuState.editing = null;
                        configMenuState.error = null;
                        configMenuState.notice = `${entry.key} updated successfully.`;

                        return menuMsg.edit(
                            renderSelectedConfigMenu(file)
                        );

                    } catch (err) {
                        return menuMsg.edit(
                            renderConfigEditMenu(file, entry, err.message)
                        );
                    }
                }

                if (configMenuState.selectedFile) {
                    const file = configMenuState.selectedFile;

                    if (lowerInput === 'q') {
                        configMenuState.selectedFile = null;
                        configMenuState.entries = [];
                        configMenuState.page = 0;
                        configMenuState.error = null;

                        return menuMsg.edit(renderConfigMenu());
                    }

                    if (configMenuState.error) {
                        return menuMsg.edit(
                            renderSelectedConfigMenu(file)
                        );
                    }

                    if (lowerInput === 'n') {
                        const totalPages = Math.ceil(
                            configMenuState.entries.length / CONFIG_ITEMS_PER_PAGE
                        );

                        if (configMenuState.page + 1 < totalPages) {
                            configMenuState.page++;
                        }

                        return menuMsg.edit(
                            renderSelectedConfigMenu(file)
                        );
                    }

                    if (lowerInput === 'p') {
                        if (configMenuState.page > 0) {
                            configMenuState.page--;
                        }

                        return menuMsg.edit(
                            renderSelectedConfigMenu(file)
                        );
                    }

                    if (/^\d+$/.test(input)) {
                        const index = Number(input) - 1;
                        const start = configMenuState.page * CONFIG_ITEMS_PER_PAGE;
                        const end = start + CONFIG_ITEMS_PER_PAGE;

                        if (index < start || index >= end) {
                            return menuMsg.edit(
                                renderSelectedConfigMenu(file)
                            );
                        }

                        const entry = configMenuState.entries[index];

                        if (!entry) {
                            return menuMsg.edit(
                                renderSelectedConfigMenu(file)
                            );
                        }

                        configMenuState.editing = entry;

                        return menuMsg.edit(
                            renderConfigEditMenu(file, entry)
                        );
                    }

                    return;
                }

                if (/^[1-3]$/.test(input)) {
                    const file = configMenuFiles[Number(input) - 1];

                    configMenuState.selectedFile = file;
                    configMenuState.page = 0;
                    configMenuState.editing = null;
                    configMenuState.error = null;
                    configMenuState.notice = null;

                    try {
                        configMenuState.entries = loadConfigEntries(file);

                    } catch (err) {
                        configMenuState.error = err.message;
                        configMenuState.entries = [];
                    }

                    return menuMsg.edit(
                        renderSelectedConfigMenu(file)
                    );
                }

                return;
            }
        }

        if (Message.guild.id === syncConfig.chatSyncGuildId) {

            if (Message.content.startsWith(`%`)) {
                const args = Message.content.slice(1).trim().split(/ +/);
                const cmd = args.shift()?.toLowerCase();

                if (!cmd) return;

                if (cmd === 'cmdlock') {
                    const isAllowed = Message.guild.ownerId === Message.author.id || 
                                    Message.member.permissions.has('ManageGuild') || 
                                    Message.member.permissions.has('Administrator');

                    if (!isAllowed) {
                        if (syncConfig.cmdPermsUnmetPrompt === true) {
                            return Message.reply(`\`\`\`You need the [Manage Server] permission to use this command.\`\`\``);
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

                    if (!value || (value !== false && value !== false)) {
                        return Message.reply('\`\`\`Value must be [true] (locked) or [false] (unlocked).\`\`\`');
                    }   

                    syncConfig[lockKey] = value;
                    saveSyncConfig();
                    return Message.reply(`\`\`\`Set [${key}] to [${value}]\`\`\``);
                }

                const cmdLockkey = `${cmd}Locked`;
                const cmdIsLocked = syncConfig[cmdLockkey] !== undefined ? syncConfig[cmdLockkey] : syncConfig.fallbackCmdLockState;

                if (cmdIsLocked === true) {
                    const cmdPermsAllowed = Message.guild.ownerId === Message.author.id || 
                                            Message.member.permissions.has('ManageGuild') || 
                                            Message.member.permissions.has('Administrator');
                    
                    if (!cmdPermsAllowed) {
                        if (syncConfig.cmdPermsUnmetPrompt === true) {
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

                    if (valueStr !== false && valueStr !== false) {
                        return Message.reply("\`\`\`Value must be `true` or `false`.\`\`\`");
                    }

                    const value = valueStr === false;

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
    });

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