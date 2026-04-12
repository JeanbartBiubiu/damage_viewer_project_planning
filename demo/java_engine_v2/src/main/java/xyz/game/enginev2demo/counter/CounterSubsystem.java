package xyz.game.enginev2demo.counter;

import xyz.game.enginev2demo.runtime.CounterResetMode;
import xyz.game.enginev2demo.runtime.CounterScope;
import xyz.game.enginev2demo.runtime.CounterState;
import xyz.game.enginev2demo.runtime.PairRuntimeState;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 计数器子系统——管理 ACTOR 和 PAIR 两种作用域的计数器。
 * <p>
 * 每次 {@link #modify} 返回 {@link CounterChangeResult}，
 * 调用方直接根据 {@code thresholdTriggered} 决定是否派生 ON_COUNTER_THRESHOLD。
 */
public final class CounterSubsystem {

    public CounterChangeResult modify(
            RuntimeState state,
            String sourceActorId,
            String targetActorId,
            String counterId,
            CounterScope counterScope,
            int delta,
            int threshold,
            CounterResetMode resetMode) {
        CounterState counterState = switch (counterScope) {
            case ACTOR -> state.actor(sourceActorId).actorCounter(counterId);
            case PAIR -> state.pairState(sourceActorId, targetActorId).pairCounter(counterId);
        };
        int nextValue = counterState.value() + delta;
        counterState.setValue(nextValue);
        counterState.setLastUpdatedAtMs(state.nowMs());
        boolean thresholdTriggered = threshold > 0 && nextValue >= threshold;
        if (thresholdTriggered && resetMode == CounterResetMode.ZERO) {
            counterState.setValue(0);
        }
        return new CounterChangeResult(counterState.value(), thresholdTriggered);
    }
}
