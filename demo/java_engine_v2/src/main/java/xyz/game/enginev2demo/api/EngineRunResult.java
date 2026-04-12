package xyz.game.enginev2demo.api;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 引擎模拟的运行结果。
 *
 * @param actors          各角色终态快照，key 为 actorId
 * @param logs            按时间顺序的完整日志列表
 * @param finalTimeMs     模拟结束时的时间戳（毫秒）
 * @param processedEvents 已处理的事件总数
 * @param stopReason      停止原因：{@code "queue_empty"} 或 {@code "max_events"}
 */
public record EngineRunResult(
        Map<String, ActorSnapshot> actors,
        List<EngineLogEntry> logs,
        long finalTimeMs,
        long processedEvents,
        String stopReason) {

    public EngineRunResult {
        Objects.requireNonNull(actors, "actors");
        Objects.requireNonNull(logs, "logs");
        Objects.requireNonNull(stopReason, "stopReason");
        actors = Map.copyOf(actors);
        logs = List.copyOf(logs);
    }
}
