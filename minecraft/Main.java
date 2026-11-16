package com.chatSync;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;

import java.net.URI;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@Mod(Main.MODID)
public class Main {

    public static volatile boolean isShuttingDown = false;
    
    public static final String MODID = "chatsync";
    public static WsClient chatSyncClient; 
    
   private static final ScheduledExecutorService scheduler =
    Executors.newScheduledThreadPool(1, r -> {
        Thread t = new Thread(r, "chatsync-scheduler");
        t.setDaemon(true);
        return t;
    });

    public Main(IEventBus modEventBus) {
        ConfigHandler.load();
        NeoForge.EVENT_BUS.register(OutboundMsgHandler.class);
        NeoForge.EVENT_BUS.register(LifecycleHandler.class);
        startConnectionLoop();
    }

    public static void startConnectionLoop() {
        if (isShuttingDown) return;
        try {
            URI uri = new URI("ws://localhost:38200");
            chatSyncClient = new WsClient(uri);
            
            System.out.println("[Chat Sync] [Info] Attempting to connect to WebSocket...");
            boolean connected = chatSyncClient.connectBlocking();
            
            if (!connected) {
                scheduleReconnect();
            }
        } catch (Exception e) {
            System.out.println("[Chat Sync] [Error] Connection failed: " + e.getMessage());
            scheduleReconnect();
        }
    }

    public static void shutdown() {
    isShuttingDown = true;

    scheduler.shutdownNow();

    if (chatSyncClient != null) {
        try {
            chatSyncClient.closeBlocking();
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        chatSyncClient = null;
    }
}

    private static boolean isReconnecting = false;

static void scheduleReconnect() {
    if (isShuttingDown) return;
    if (isReconnecting) return;
    isReconnecting = true;
    System.out.println("[Chat Sync] Retrying connection in 30 seconds...");
    scheduler.schedule(() -> {
        isReconnecting = false;
        if (isShuttingDown) return;
        startConnectionLoop();
    }, 30, TimeUnit.SECONDS);
}
}