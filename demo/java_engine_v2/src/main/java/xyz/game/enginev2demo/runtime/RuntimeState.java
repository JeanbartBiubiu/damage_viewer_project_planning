package xyz.game.enginev2demo.runtime;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;

import xyz.game.enginev2demo.api.EngineLogEntry;
import xyz.game.enginev2demo.event.ScheduledEvent;

/**
 * 单次 run 的根状态容器。
 * 这里集中保存时间、事件队列、actor 运行时、pair 运行时和日志。
 */
public final class RuntimeState {

    private final long seed;
    private long nowMs;
    private long nextSequence;
    private long processedEvents;
    private final PriorityQueue<ScheduledEvent> queue = new PriorityQueue<>();
    private final Map<String, ActorRuntime> actors = new LinkedHashMap<>();
    private final Map<String, PairRuntimeState> pairStates = new LinkedHashMap<>();
    private final List<EngineLogEntry> logs = new ArrayList<>();

    public RuntimeState(long seed) {
        this.seed = seed;
    }

    public long seed() {
        return seed;
    }

    public long nowMs() {
        return nowMs;
    }

    public void setNowMs(long nowMs) {
        this.nowMs = nowMs;
    }

    public long nextSequence() {
        return nextSequence++;
    }

    public long processedEvents() {
        return processedEvents;
    }

    public void incrementProcessedEvents() {
        processedEvents += 1;
    }

    public void enqueue(ScheduledEvent event) {
        queue.add(event);
    }

    public ScheduledEvent pollNextEvent() {
        return queue.poll();
    }

    public boolean isQueueEmpty() {
        return queue.isEmpty();
    }

    public void addActor(ActorRuntime actorRuntime) {
        actors.put(actorRuntime.actorId(), actorRuntime);
    }

    public Map<String, ActorRuntime> actors() {
        return Map.copyOf(actors);
    }

    public ActorRuntime actor(String actorId) {
        ActorRuntime actorRuntime = actors.get(actorId);
        if (actorRuntime == null) {
            throw new IllegalArgumentException("missing runtime actor: " + actorId);
        }
        return actorRuntime;
    }

    public void createPairState(String sourceActorId, String targetActorId) {
        // pair state 专门承载 “我对你” 维度的状态，例如 mark 和 per-target counter。
        pairStates.put(pairKey(sourceActorId, targetActorId), new PairRuntimeState(sourceActorId, targetActorId));
    }

    public PairRuntimeState pairState(String sourceActorId, String targetActorId) {
        PairRuntimeState pairRuntimeState = pairStates.get(pairKey(sourceActorId, targetActorId));
        if (pairRuntimeState == null) {
            throw new IllegalArgumentException("missing pair state for %s -> %s".formatted(sourceActorId, targetActorId));
        }
        return pairRuntimeState;
    }

    public void log(EngineLogEntry entry) {
        logs.add(entry);
    }

    public List<EngineLogEntry> logs() {
        return List.copyOf(logs);
    }

    private String pairKey(String sourceActorId, String targetActorId) {
        return sourceActorId + "->" + targetActorId;
    }
}
