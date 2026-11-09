package com.chatSync;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.FileWriter;
import java.nio.file.Files;
import java.nio.file.Paths;

public class ConfigHandler {
    private static final String CONFIG_PATH = "config/chatsync-config.json";
    private static final Gson gson = new GsonBuilder().setPrettyPrinting().create();

public static void update(String key, boolean value) {
    if (!Capabilities.FEATURES.contains("cfgKey:" + key)) {
    System.out.println("[Chat Sync] Ignoring unknown config key: " + key);
    return;
    }

    try {
        String content = new String(Files.readAllBytes(Paths.get(CONFIG_PATH)));
        JsonObject json = JsonParser.parseString(content).getAsJsonObject();
        json.addProperty(key, value);
        try (FileWriter writer = new FileWriter(CONFIG_PATH)) {
            gson.toJson(json, writer);
        }
        load();
    } catch (Exception e) {
        System.out.println("[Chat Sync] Failed to update config: " + e.getMessage());
    }
}

    public static void load() {
        try {
            if (!Files.exists(Paths.get(CONFIG_PATH))) {
                System.out.println("[Chat Sync] Config not not found. Creating file with defaults...");
                saveDefaults();
                return; 
            }

            String content = new String(Files.readAllBytes(Paths.get(CONFIG_PATH)));
            JsonObject json = JsonParser.parseString(content).getAsJsonObject();

            if (json.has("forwardChat")) Config.forwardChat = json.get("forwardChat").getAsBoolean();
            if (json.has("forwardJoinLeave")) Config.forwardJoinLeave = json.get("forwardJoinLeave").getAsBoolean();
            if (json.has("forwardDeaths")) Config.forwardDeaths = json.get("forwardDeaths").getAsBoolean();
            if (json.has("forwardAdvancements")) Config.forwardAdvancements = json.get("forwardAdvancements").getAsBoolean();
            
            System.out.println("[Chat Sync] Config loaded from file.");
            
        } catch (Exception e) {
            System.out.println("[Chat Sync] Failed to load config: " + e.getMessage());
        }
    }

    private static void saveDefaults() {
        try {
            java.io.File configDir = new java.io.File("config");
            if (!configDir.exists()) {
                configDir.mkdirs();
            }

            JsonObject json = new JsonObject();
            json.addProperty("forwardChat", true);
            json.addProperty("forwardJoinLeave", true);
            json.addProperty("forwardDeaths", true);
            json.addProperty("forwardAdvancements", true);
            
            try (FileWriter writer = new FileWriter(CONFIG_PATH)) {
                gson.toJson(json, writer);
            }
            System.out.println("[Chat Sync] Successfully created config file");
            load(); 
        } catch (Exception e) {
            System.out.println("[Chat Sync] Failed to create config: " + e.getMessage());
        }
    }
}