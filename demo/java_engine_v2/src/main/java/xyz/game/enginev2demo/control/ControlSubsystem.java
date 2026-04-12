package xyz.game.enginev2demo.control;

import java.util.OptionalLong;

import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.StatusInstance;
import xyz.game.enginev2demo.runtime.StatusKind;

/**
 * 控制效果子系统——基于角色当前现存的状态，提供控制相关语义查询。
 * <p>
 * 去中心化地只封装检查逻辑，不直接修改 ActorRuntime。
 */
public final class ControlSubsystem {

    public boolean blocksAction(ActorRuntime actorRuntime) {
        return actorRuntime.hasStatusKind(StatusKind.STUN);
    }

    public boolean preventsControl(ActorRuntime actorRuntime) {
        return actorRuntime.hasStatusKind(StatusKind.CONTROL_IMMUNE);
    }

    public boolean forcesZeroDamage(ActorRuntime actorRuntime) {
        return actorRuntime.hasStatusKind(StatusKind.FORCE_DAMAGE_TO_ZERO);
    }

    public boolean canApply(ActorRuntime actorRuntime, StatusKind statusKind) {
        if (statusKind == StatusKind.STUN) {
            return !preventsControl(actorRuntime);
        }
        return true;
    }

    /**
     * 返回当前所有阻断施法的 STUN 状态中最早的 expireAtMs（必须 &gt; nowMs）。
     * 若无有效的未来解除时刻，返回 empty。
     */
    public OptionalLong nextActionUnblockAt(ActorRuntime actorRuntime, long nowMs) {
        long earliest = Long.MAX_VALUE;
        for (StatusInstance si : actorRuntime.activeStatuses().values()) {
            if (si.statusKind() == StatusKind.STUN && si.active() && si.expireAtMs() > nowMs) {
                earliest = Math.min(earliest, si.expireAtMs());
            }
        }
        return earliest == Long.MAX_VALUE ? OptionalLong.empty() : OptionalLong.of(earliest);
    }

    public void putStatus(ActorRuntime actorRuntime, StatusInstance statusInstance) {
        actorRuntime.putStatus(statusInstance);
    }
}
