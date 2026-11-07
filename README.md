# Minecraft Chat Sync
## Features
- **Bidirectional chat sync** Messages in Minecraft show in a specified Discord channel, and messages in this Discord channel show in Minecraft server chat
- **Server event forwarding** Forwards server events such as player join/leave, death messages, and advancements
- **WebSocket connection** Lower latency, better performance , and universal compatibility compared to RCON or reading `latest.log`
## Requirements
- Minecraft Java 1.21.1
- NeoForge 21.1.250
- Server must be running in Online Mode (to fetch correct player skins)
- Node.js 18+
## Installation
1. Download and extract `discord.zip`
2. Download and add `chatsync-1.0.0.jar` to the server's mods folder
3. Register a bot user at https://discord.com/developers/applications
4. In the discord folder, add the bot token to `.env` after DISCORD_TOKEN=
5. In the discord folder, open a terminal and run `npm install` to install required packages and `node discord.js` to run the bot
Look for the `WebSocket connected` message in the terminal, that means both ends are connected and the chat sync should work.
## Planned features
- Port Minecraft mod to other versions and loaders
- Event config editing (individual toggles for each message/event type)
- Server online/offline notifications
- Notifications in Discord when the message is unable to send
