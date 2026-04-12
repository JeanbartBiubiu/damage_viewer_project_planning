package xyz.game.enginev2demo.event;

/**
 * 事件队列中的调度条目，包装了触发时间、优先级和序列号。
 * <p>
 * 排序规则：先比较 triggerAtMs（时间先到先处理），
 * 同时比较 priority（值小优先），再比较 sequence（先入队先处理）。
 *
 * @param triggerAtMs 触发时间（毫秒）
 * @param priority    优先级，值越小越先处理
 * @param sequence    入队序列号，确保同时同优先级的事件有稳定顺序
 * @param payload     内部事件 payload
 */
public record ScheduledEvent(
        long triggerAtMs,
        int priority,
        long sequence,
        InternalEvent payload) implements Comparable<ScheduledEvent> {

    @Override
    public int compareTo(ScheduledEvent other) {
        int timeCompare = Long.compare(triggerAtMs, other.triggerAtMs);
        if (timeCompare != 0) {
            return timeCompare;
        }
        int priorityCompare = Integer.compare(priority, other.priority);
        if (priorityCompare != 0) {
            return priorityCompare;
        }
        return Long.compare(sequence, other.sequence);
    }
}
