# Minecraft Chat Sync + Server Panel
## Features
- **Bidirectional chat sync** Messages in Minecraft show in a specified Discord channel, and messages in this Discord channel show in Minecraft server chat
- **Server event forwarding** Forwards server events such as player join/leave, death messages, and advancements
- **WebSocket connection** Lower latency, better performance , and universal compatibility compared to RCON or reading `latest.log`
- **CORRECT LOOKING PLAYER HEADS IN DISCORD!** The problem with many other chat sync bots is that the head image gets its corners cropped off by Discord. This solution uses local image editing to add padding to the edges of the head.
- **Head image caching** Caches head image of the 100 most recent players for faster loading and less API calls.
- **Server start/stop/restart controls** For server management, this is WIP
- **Server console in Discord** Server management, this is also WIP
- **File browser in Discord** For Minecraft server files, folder browsing works, rename/delete works, uploading/downloading files does not yet
## Requirements
- Minecraft Java 1.21.1 (will port to other versions)
- NeoForge 21.1.250 (will port to other loaders)
- Fairly recent version of Node.js
## Installation
1. Download and extract `discord.zip`
2. Download and add the `.jar` file to the server's mods folder
3. Register a bot user at https://discord.com/developers/applications
4. In the discord folder, add the bot token to `.env` after `DISCORD_TOKEN=`
5. In the discord folder, open a terminal and run `npm install` to install required packages and `node discord.js` to run the bot
6. For versions with server management, invite the bot to both a panel server and a chat sync server on Discord, and run `%panel setup` in the panel server, and `%chatsync setup` in the chat sync server.
   For all versions: run `%setup` in the chat sync server and select a channel to sync from the dropdown.
## Planned features
### Chat sync
- Port Minecraft mod to other versions and loaders
- Server online/offline notifications
- Add more caching options for head image(eg. location, expiry time, max number of caches, update cache policy)
- Add more display styles (eg. terminal, natural-chat, compact, etc)
- Add image verification against multiple APIs (prevents fallback images because one API didn't have a player's UUID in its database)
- Add options for API to get head image
  - Custom link with {uuid} to insert uuid, {username} to insert username, and a `type` field for what the link gets (head/skin) and a `responseType` field for what the API responds

### Server panel
- Add schedules feature (schedules events for server eg. start/stop/restart, shell commands, etc.)
  - Especially advanced schedule logic with and/or/nor logic and many conditions (time/system/player related), for example, reboot when server is empty and it is between 00:00 and 7:00
- Add configurable backups (configurable time/number of backups to keep/etc.)
- Add player management feature (lists all players that have played, actions for player eg. ban, kick, op/deop, maybe view inventory)
- Add file download/upload via a small web server.
- Add config feature (configs for panel and basic server configs)
- Add help commands (user guide)