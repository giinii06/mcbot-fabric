package kr.mcbot.bridge;

import kr.mcbot.bridge.config.BridgeConfig;
import kr.mcbot.bridge.runtime.BridgeRuntime;
import net.fabricmc.api.DedicatedServerModInitializer;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.advancement.AdvancementEntry;
import net.minecraft.server.network.ServerPlayerEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Fabric server entrypoint for the Discord bridge.
 *
 * <p>The bridge starts with the Minecraft server and stops with it. It never
 * runs arbitrary commands and every game-state access is marshalled onto the
 * server thread by the runtime.</p>
 */
public final class MinecraftBridgeMod implements DedicatedServerModInitializer {

    private static final Logger LOGGER = LoggerFactory.getLogger("minecraftbridge");
    private static volatile BridgeRuntime runtime;

    @Override
    public void onInitializeServer() {
        BridgeConfig config;
        try {
            config = BridgeConfig.load(FabricLoader.getInstance().getConfigDir(), LOGGER);
        } catch (Exception ex) {
            LOGGER.error("bridge disabled: could not load config - {}", ex.getMessage());
            return;
        }

        if (!config.enabled) {
            LOGGER.info("bridge disabled via config (enabled: false)");
            return;
        }

        String secret = config.resolveSecret();
        if (secret.isEmpty()) {
            LOGGER.error("bridge disabled: bot secret is missing, shorter than 16 chars, or still CHANGE_ME.");
            LOGGER.error("Set MC_BRIDGE_SECRET (or mount /run/secrets/bridge_secret) to the same value used by the Discord bot.");
            return;
        }

        String version = FabricLoader.getInstance()
                .getModContainer("minecraftbridge")
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("1.1.0");

        BridgeRuntime bridge = new BridgeRuntime(config, secret, version, LOGGER);
        runtime = bridge;

        ServerLifecycleEvents.SERVER_STARTED.register(bridge::onServerStarted);
        ServerLifecycleEvents.SERVER_STOPPING.register(bridge::onServerStopping);
        ServerTickEvents.END_SERVER_TICK.register(bridge::onTick);
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> bridge.onJoin(handler.player));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> bridge.onDisconnect(handler.player));
        ServerMessageEvents.CHAT_MESSAGE.register(
                (message, sender, params) -> bridge.onChat(sender, message.getContent().getString()));
        ServerLivingEntityEvents.AFTER_DEATH.register((entity, source) -> {
            if (entity instanceof ServerPlayerEntity player) {
                bridge.onDeath(player, source);
            }
        });

        LOGGER.info("MinecraftBridge {} loaded; HTTP starts when the server is ready", version);
    }

    /** Called from the advancement mixin (server thread). */
    public static void onAdvancement(ServerPlayerEntity player, AdvancementEntry entry) {
        BridgeRuntime current = runtime;
        if (current != null && player != null) {
            current.onAdvancement(player, entry);
        }
    }
}
