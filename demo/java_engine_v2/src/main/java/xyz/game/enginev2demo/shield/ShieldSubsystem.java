package xyz.game.enginev2demo.shield;

import java.util.Comparator;

import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.StatusInstance;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;

/**
 * 护盾子系统——负责护盾授予、状态刷新和伤害吸收。
 * <p>
 * 护盾在运行时直接存储为 StatusInstance（COMPAT_PREFIX + label），
 * 伤害管线内优先选择量最大的活跃护盾吸收。
 */
public final class ShieldSubsystem {

    private static final String COMPAT_PREFIX = "__shield__:";

    public ShieldGrantResult grantShield(ActorRuntime actorRuntime, long nowMs, String label, double requestedAmount) {
        double shieldBefore = actorRuntime.shieldAmount();
        double nextMagnitude = Math.max(shieldBefore, Math.max(0.0, requestedAmount));
        actorRuntime.putStatus(new StatusInstance(
                COMPAT_PREFIX + label,
                actorRuntime.actorId(),
                actorRuntime.actorId(),
                StatusKind.SHIELD,
                nowMs,
                0L,
                nextMagnitude,
                true));
        return new ShieldGrantResult(requestedAmount, shieldBefore, actorRuntime.shieldAmount());
    }

    public void applyShieldStatus(ActorRuntime actorRuntime, StatusInstance statusInstance, StatusRefreshPolicy refreshPolicy) {
        StatusInstance existing = actorRuntime.status(statusInstance.statusId());
        if (existing == null || !existing.active() || refreshPolicy == StatusRefreshPolicy.REPLACE) {
            actorRuntime.putStatus(statusInstance);
            return;
        }
        existing.setMagnitude(Math.max(existing.magnitude(), statusInstance.magnitude()));
    }

    public double absorbBeforeHp(ActorRuntime actorRuntime, double incomingDamage) {
        if (incomingDamage <= 0.0) {
            return 0.0;
        }
        StatusInstance activeShield = actorRuntime.activeStatuses().values().stream()
                .filter(status -> status.active() && status.statusKind() == StatusKind.SHIELD && status.magnitude() > 0.0)
                .max(Comparator.comparingDouble(StatusInstance::magnitude))
                .orElse(null);
        if (activeShield == null) {
            return 0.0;
        }
        double absorbed = Math.min(activeShield.magnitude(), incomingDamage);
        activeShield.setMagnitude(activeShield.magnitude() - absorbed);
        if (activeShield.magnitude() <= 0.0) {
            actorRuntime.removeStatus(activeShield.statusId());
        }
        return absorbed;
    }
}
