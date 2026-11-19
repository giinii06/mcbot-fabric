package kr.mcbot.bridge.mixin;

import kr.mcbot.bridge.MinecraftBridgeMod;
import net.minecraft.advancement.AdvancementEntry;
import net.minecraft.advancement.PlayerAdvancementTracker;
import net.minecraft.server.network.ServerPlayerEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Fabric API has no advancement-completed event in 1.21.1, so this minimal
 * mixin reports the grant to the bridge. The bridge filters by
 * {@code shouldAnnounceToChat()} and by completed progress, and dedupes per
 * player, so only publicly announced advancements are published.
 */
@Mixin(PlayerAdvancementTracker.class)
public abstract class PlayerAdvancementTrackerMixin {

    @Shadow
    private ServerPlayerEntity owner;

    @Inject(method = "grantCriterion", at = @At("RETURN"))
    private void minecraftbridge$afterGrantCriterion(
            AdvancementEntry advancement,
            String criterionName,
            CallbackInfoReturnable<Boolean> callback) {
        if (!Boolean.TRUE.equals(callback.getReturnValue())) {
            return;
        }
        if (owner == null) {
            return;
        }
        MinecraftBridgeMod.onAdvancement(owner, advancement);
    }
}
