# Minecraft Chat Sync + Server Panel
## Features
- **Bidirectional chat sync** Messages in Minecraft show in a specified Discord channel, and messages in this Discord channel show in Minecraft server chat
- **Server event forwarding** Forwards server events such as player join/leave, death messages, and advancements
- **WebSocket connection** Lower latency, better performance , and universal compatibility compared to RCON or reading `latest.log`
- **Server start/stop/restart controls** For server management, this is WIP
- **Server console in Discord** Server management, this is also WIP
## Requirements
- Minecraft Java 1.21.1
- NeoForge 21.1.250
- Server must be running in Online Mode (for correct player skins)
- Node.js 18+
## Installation
1. Download and extract `discord.zip`
2. Download and add the `.jar` file to the server's mods folder
3. Register a bot user at https://discord.com/developers/applications
4. In the discord folder, add the bot token to `.env` after DISCORD_TOKEN=
5. In the discord folder, open a terminal and run `npm install` to install required packages and `node discord.js` to run the bot
6. For versions with server management, invite the bot to both a panel server and a chat sync server, and run `%panel setup` in the panel server, and `%chatsync setup` in the chat sync server.
   For all versions: run `%setup` in the chat sync server and select a channel to sync from the dropdown.
8. Look for the `WebSocket connected` message in the terminal, that means both ends are connected and the chat sync should work.
## Planned features
### Chat sync
- Port Minecraft mod to other versions and loaders
- Server online/offline notifications

### Server panel
- Add text based UI with cursor for all features (especially files feature)
- Add dashboard feature (shows player count and server status such as RAM and CPU usage)
- Add schedules feature (schedules events for server eg. start/stop/restart, shell commands, etc.)
  - Especially advanced schedule logic with and/or/nor logic and many conditions (time/system/player related), for example, reboot when server is empty and it is between 00:00 and 7:00
- Add configurable backups (configurable time/number of backups to keep/etc.)
- Add player management feature (lists all players that have played, actions for player eg. ban, kick, op/deop, maybe view inventory)
- Add file manager feature (text based file browser for server directory with upload/download through Discord or WebServer)
- Add config feature (configs for panel and basic server configs)
- Add help commands (user guide)
