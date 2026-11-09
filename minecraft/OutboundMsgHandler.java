package com.chatSync;

import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.event.ServerChatEvent;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import net.neoforged.neoforge.event.entity.player.AdvancementEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.minecraft.world.entity.player.Player;

public class OutboundMsgHandler {
    
        @SubscribeEvent 
    public static void onPlayerChat(ServerChatEvent event) {
        if (!Config.forwardChat) return;

        String playerName = event.getPlayer().getName().getString();
        String uuid = event.getPlayer().getStringUUID(); 
        String message = event.getMessage().getString();

        if (Main.chatSyncClient != null && Main.chatSyncClient.isOpen()) {
            Main.chatSyncClient.sendMsg("chat", playerName, message, uuid);
        }
    }

    @SubscribeEvent
    public static void onPlayerDeath(LivingDeathEvent event) {
        if (!Config.forwardDeaths) return;

        if (event.getEntity() instanceof Player player) {
            String playerName = player.getName().getString();
            String deathMessage = event.getSource().getLocalizedDeathMessage(player).getString();
            
            if (Main.chatSyncClient != null && Main.chatSyncClient.isOpen()) {
                Main.chatSyncClient.sendMsg("death", playerName, deathMessage, null);
            }
        }
    }

    @SubscribeEvent
    public static void onAdvancement(AdvancementEvent.AdvancementEarnEvent event) {
        if (!Config.forwardAdvancements) return;

        String playerName = event.getEntity().getName().getString();
        String advancementName = event.getAdvancement().value().display().get().getTitle().getString();
//        String advanvementDesc = event.getAdvancement().value().display().get().getDescription().getString();
        
        if (Main.chatSyncClient != null && Main.chatSyncClient.isOpen()) {
            Main.chatSyncClient.sendMsg("advancement", playerName, "has made the advancement" + " **[" + advancementName + "]**", null);
        }
    }

    @SubscribeEvent
    public static void onPlayerJoin(PlayerEvent.PlayerLoggedInEvent event) {
        if (!Config.forwardJoinLeave) return;

        String playerName = event.getEntity().getName().getString();
        if (Main.chatSyncClient != null && Main.chatSyncClient.isOpen()) {
            Main.chatSyncClient.sendMsg("join", playerName, "joined the game", null);
        }
    }

    @SubscribeEvent
    public static void onPlayerLeave(PlayerEvent.PlayerLoggedOutEvent event) {
        if (!Config.forwardJoinLeave) return;

        String playerName = event.getEntity().getName().getString();
        if (Main.chatSyncClient != null && Main.chatSyncClient.isOpen()) {
            Main.chatSyncClient.sendMsg("leave", playerName, "left the game", null);
        }
    }
}