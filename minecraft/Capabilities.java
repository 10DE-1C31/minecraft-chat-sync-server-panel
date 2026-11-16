package com.chatSync;

import java.util.List;

public final class Capabilities {
    public static final String MOD_VERSION = "0.2.0";
    public static final String MC_VERSION  = "1.21.1";
    public static final int    SCHEMA      = 1;

    public static final List<String> FEATURES = List.of(
        "core:chat", "core:join", "core:leave", "core:death", "core:advancement",
        "core:discord_chat",

        "config:configQuery", "config:configWrite",

        "cfgKey:forwardChat", "cfgKey:forwardJoinLeave", "cfgKey:forwardDeaths", "cfgKey:forwardAdvancements"
    );

    private Capabilities() {}
}