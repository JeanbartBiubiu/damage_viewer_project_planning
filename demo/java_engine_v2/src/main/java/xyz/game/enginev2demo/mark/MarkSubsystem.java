package xyz.game.enginev2demo.mark;

import xyz.game.enginev2demo.runtime.MarkState;
import xyz.game.enginev2demo.runtime.PairRuntimeState;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 标记子系统——管理 source → target 方向上的有向可消耗标记。
 * <p>
 * 标记过期采用懒检查策略：读取时再判断 expireAtMs。
 */
public final class MarkSubsystem {

    public void applyMark(
            RuntimeState state,
            String sourceActorId,
            String targetActorId,
            String markId,
            long expireAtMs,
            boolean consumable) {
        PairRuntimeState pairRuntimeState = state.pairState(sourceActorId, targetActorId);
        pairRuntimeState.putMark(new MarkState(
                markId,
                sourceActorId,
                targetActorId,
                state.nowMs(),
                expireAtMs,
                consumable,
                true));
    }

    public boolean hasConsumableMark(RuntimeState state, String sourceActorId, String targetActorId, String markId) {
        MarkState markState = getActiveMark(state, sourceActorId, targetActorId, markId);
        return markState != null && markState.consumable();
    }

    public void consumeMark(RuntimeState state, String sourceActorId, String targetActorId, String markId) {
        PairRuntimeState pairRuntimeState = state.pairState(sourceActorId, targetActorId);
        MarkState markState = getActiveMark(state, sourceActorId, targetActorId, markId);
        if (markState != null) {
            pairRuntimeState.removeMark(markId);
        }
    }

    public MarkState getActiveMark(RuntimeState state, String sourceActorId, String targetActorId, String markId) {
        PairRuntimeState pairRuntimeState = state.pairState(sourceActorId, targetActorId);
        MarkState markState = pairRuntimeState.mark(markId);
        if (markState == null || !markState.active()) {
            return null;
        }
        if (markState.expireAtMs() > 0 && markState.expireAtMs() <= state.nowMs()) {
            pairRuntimeState.removeMark(markId);
            return null;
        }
        return markState;
    }
}
