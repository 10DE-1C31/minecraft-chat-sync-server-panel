package com.chatSync;

import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

public class LifecycleHandler {

    @SubscribeEvent
    public static void onServerStopping(ServerStoppingEvent event) {
        System.out.println("[Chat Sync] Server stopping, closing WebSocket...");
        Main.shutdown();
    }
}