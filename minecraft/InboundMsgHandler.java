package com.chatSync;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.neoforged.neoforge.server.ServerLifecycleHooks;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class InboundMsgHandler {

    private static final Gson gson = new Gson();

    public static void handleIncomingMsg(String jsonstring) {
        try {
            JsonObject json = JsonParser.parseString(jsonstring).getAsJsonObject();
            String type = json.get("type").getAsString();

            if (type.equals("cap")) {
                handleCap(json);
                return;
            }

            if (!Main.chatSyncClient.isNegotiated()) {
                System.out.println("[Chat Sync] Dropping " + type + " (not negotiated)");
                return;
            }

            if (type.equals("config")) {
                if (json.has("key") && !json.get("key").isJsonNull()) {
                    String key = json.get("key").getAsString();
                    boolean value = json.get("value").getAsBoolean();
                    ConfigHandler.update(key, value);
                    System.out.println("[Chat Sync] Config updated via Discord: " + key + "=" + value);
                } else {
                    String response = String.format(
                        "{\"type\":\"config_sync\",\"forwardChat\":%b,\"forwardJoinLeave\":%b,\"forwardDeaths\":%b,\"forwardAdvancements\":%b}",
                        Config.forwardChat, Config.forwardJoinLeave, Config.forwardDeaths, Config.forwardAdvancements
                    );
                    if (Main.chatSyncClient != null && Main.chatSyncClient.isOpen()) {
                        Main.chatSyncClient.send(response);
                    }
                    System.out.println("[Chat Sync] Config sent to Discord.");
                }
                return;
            }

            if (type.equals("discord_chat")) {
                String username = json.get("username").getAsString();
                String message = json.get("message").getAsString();
                String formatted = "[" + username + "] " + message;

                MinecraftServer server = ServerLifecycleHooks.getCurrentServer();
                if (server != null) {
                    server.getPlayerList().broadcastSystemMessage(Component.literal(formatted), false);
                }
            }

        } catch (Exception e) {
            System.out.println("[Chat Sync] Error parsing incoming JSON: " + e.getMessage());
        }
    }

    private static void handleCap(JsonObject json) {
        try {
            Set<String> botFeatures = new HashSet<>();
            List<String> echoed = new ArrayList<>();
            if (json.has("features")) {
                for (var el : json.getAsJsonArray("features")) {
                    String f = el.getAsString();
                    botFeatures.add(f);
                    if (f.startsWith("x-") && echoed.size() < 64) {
                        echoed.add(f);
                    }
                }
            }

            List<String> ackFeatures = new ArrayList<>(Capabilities.FEATURES);
            ackFeatures.addAll(echoed);

            Set<String> mine = new HashSet<>(Capabilities.FEATURES);
            mine.retainAll(botFeatures);

            JsonObject ack = new JsonObject();
            ack.addProperty("type", "cap");
            ack.addProperty("impl", "java");
            ack.addProperty("modVersion", Capabilities.MOD_VERSION);
            ack.addProperty("mcVersion", Capabilities.MC_VERSION);
            ack.addProperty("schema", Capabilities.SCHEMA);
            ack.add("features", gson.toJsonTree(ackFeatures));

            if (Main.chatSyncClient != null && Main.chatSyncClient.isOpen()) {
                Main.chatSyncClient.send(ack.toString());
            }

            Main.chatSyncClient.setNegotiated(mine);
            System.out.println("[Chat Sync] Negotiated. Agreed: " + mine);

        } catch (Exception e) {
            System.out.println("[Chat Sync] Failed to handle cap: " + e.getMessage());
        }
    }
}