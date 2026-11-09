package com.chatSync;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.util.Collections;    
import java.util.HashSet;        
import java.util.Set;            

public class WsClient extends WebSocketClient {

    private volatile boolean negotiated = false;
    private volatile Set<String> agreed = Collections.emptySet();

    public WsClient(URI serverUri) {
        super(serverUri);
    }
    
    @Override
    public void onOpen(ServerHandshake handshakedata) {
        System.out.println("[Chat Sync] Connected to Websocket, awaiting capability negotiation");
    }

    @Override 
    public void onMessage(String message) {
        System.out.println("[Chat Sync] Recieved: "+ message);
        InboundMsgHandler.handleIncomingMsg(message);
    }

    @Override 
    public void onClose(int code, String reason, boolean remote) {
        negotiated = false;
        agreed = Collections.emptySet();
        System.out.println("[Chat Sync] [Info] WebSocket disconnected: " + reason);

        new Thread(Main::scheduleReconnect).start();
    }

    @Override
    public void onError(Exception ex) {
        System.err.println("[Chat Sync] WebSocket error: " + ex.getMessage());
    }

    public boolean isNegotiated() { return negotiated; }

    public void setNegotiated(Set<String> agreedFeatures) {
        this.agreed = Collections.unmodifiableSet(new HashSet<>(agreedFeatures));
        this.negotiated = true;
    }

    public void sendMsg(String type, String username, String message, String uuid) {

        if (!negotiated) return;
        boolean supported = agreed.contains(type) || agreed.contains("core:" + type);
        if (!supported) return;

        if (this.isOpen()) {
            String safeName = username.replace("\\", "\\\\").replace("\"", "\\\"");
            String safeMsg = message.replace("\\", "\\\\").replace("\"", "\\\"");
            String safeUuid = uuid != null ? uuid.replace("\"", "\\\"") : "";

            String json = String.format(
                "{\"type\":\"%s\",\"username\":\"%s\",\"message\":\"%s\",\"uuid\":\"%s\"}",
                type, safeName, safeMsg, safeUuid);

            this.send(json);
            System.out.println("[Chat Sync] Sending: " + json);
        } else {
            System.out.println("[Chat Sync] Failed to send message");
        }
    }
}
