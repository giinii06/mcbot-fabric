package kr.mcbot.bridge.runtime;

import kr.mcbot.bridge.bridge.OpsBackend;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Runs every game-state operation on the Minecraft server thread and gives the
 * HTTP thread a hard timeout, so a busy or stopping server can never hang a
 * bot request.
 */
public final class FabricOpsBackend implements OpsBackend {

    private final MinecraftServer server;
    private final FabricWhitelist whitelist;
    private final FabricPlaytime playtime;
    private final int syncTimeoutMillis;

    public FabricOpsBackend(
            MinecraftServer server,
            FabricWhitelist whitelist,
            FabricPlaytime playtime,
            int syncTimeoutMillis) {
        this.server = server;
        this.whitelist = whitelist;
        this.playtime = playtime;
        this.syncTimeoutMillis = Math.max(500, syncTimeoutMillis);
    }

    @Override
    public MutationResult addJava(UUID uuid, String username) {
        return sync(() -> toMutation(whitelist.addJava(uuid, username)));
    }

    @Override
    public MutationResult removeJava(UUID uuid, String username) {
        return sync(() -> toMutation(whitelist.removeJava(uuid, username)));
    }

    @Override
    public List<WhitelistItem> whitelist() {
        return sync(() -> {
            List<WhitelistItem> items = new ArrayList<>();
            for (var entry : whitelist.list()) {
                items.add(new WhitelistItem(entry.uuid(), entry.name()));
            }
            return items;
        });
    }

    @Override
    public Playtime playtime(UUID uuid) {
        FabricPlaytime.Playtime value = playtime.get(uuid);
        return new Playtime(value.ticks(), value.seconds(), value.source());
    }

    @Override
    public List<OnlinePlayer> onlinePlayers() {
        return sync(() -> {
            List<OnlinePlayer> players = new ArrayList<>();
            for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
                players.add(new OnlinePlayer(player.getUuidAsString(), player.getNameForScoreboard()));
            }
            return players;
        });
    }

    @Override
    public ServerStatus status() {
        return sync(() -> {
            var playerManager = server.getPlayerManager();
            return new ServerStatus(
                    true,
                    playerManager.getPlayerList().size(),
                    playerManager.getMaxPlayerCount(),
                    server.getVersion() + " (fabric)",
                    playerManager.isWhitelistEnabled(),
                    server.isEnforceWhitelist());
        });
    }

    private static MutationResult toMutation(FabricWhitelist.Result result) {
        return new MutationResult(result.ok(), result.applied(), result.reason());
    }

    private <T> T sync(Callable<T> task) {
        if (server == null || !server.isRunning()) {
            throw new BackendUnavailableException();
        }
        CompletableFuture<T> future = new CompletableFuture<>();
        try {
            server.execute(() -> {
                try {
                    future.complete(task.call());
                } catch (Throwable ex) {
                    future.completeExceptionally(ex);
                }
            });
        } catch (RejectedExecutionException ex) {
            throw new BackendUnavailableException();
        }

        try {
            return future.get(syncTimeoutMillis, TimeUnit.MILLISECONDS);
        } catch (TimeoutException ex) {
            throw new BackendTimeoutException();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new BackendUnavailableException();
        } catch (ExecutionException ex) {
            throw new BackendFailureException(ex.getCause());
        }
    }
}
