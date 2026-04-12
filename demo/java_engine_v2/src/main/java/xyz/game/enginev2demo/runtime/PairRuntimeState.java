package xyz.game.enginev2demo.runtime;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * pair 级运行时状态。
 * 只放 source -> target 这条有向关系上的状态，避免把 pair 语义污染到 ActorRuntime。
 */
public final class PairRuntimeState {

    private final String sourceActorId;
    private final String targetActorId;
    private final Map<String, MarkState> marks = new LinkedHashMap<>();
    private final Map<String, CounterState> pairCounters = new LinkedHashMap<>();
    private final Map<String, Long> perTargetLockouts = new LinkedHashMap<>();

    public PairRuntimeState(String sourceActorId, String targetActorId) {
        this.sourceActorId = sourceActorId;
        this.targetActorId = targetActorId;
    }

    public String sourceActorId() {
        return sourceActorId;
    }

    public String targetActorId() {
        return targetActorId;
    }

    public Map<String, Long> perTargetLockouts() {
        return Map.copyOf(perTargetLockouts);
    }

    public Map<String, MarkState> marks() {
        return Map.copyOf(marks);
    }

    public MarkState mark(String markId) {
        return marks.get(markId);
    }

    public void putMark(MarkState markState) {
        marks.put(markState.markId(), markState);
    }

    public void removeMark(String markId) {
        marks.remove(markId);
    }

    public Map<String, CounterState> pairCounters() {
        return Map.copyOf(pairCounters);
    }

    public CounterState pairCounter(String counterId) {
        return pairCounters.computeIfAbsent(counterId, CounterState::new);
    }
}
