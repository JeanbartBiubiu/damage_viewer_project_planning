package xyz.game.enginev2demo.runtime;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * 滑动窗口历史状态——记录近期伤害和控制效果，支持时间窗口内的聚合查询。
 * <p>
 * 内部使用 {@link ArrayDeque} 保持时间顺序，查询时自动裁剪过期记录。
 * 用于 Sett W（基于近期受伤计算护盾/伤害）和竞技场 CC 阈值等场景。
 */
public final class HistoryWindowState {

    private final Deque<DamageRecord> recentDamage = new ArrayDeque<>();
    private final Deque<ControlRecord> recentControl = new ArrayDeque<>();

    public void recordDamage(long timeMs, double amount) {
        recentDamage.addLast(new DamageRecord(timeMs, amount));
    }

    public void recordControl(long startAtMs, long endAtMs) {
        recentControl.addLast(new ControlRecord(startAtMs, endAtMs));
    }

    public double recentDamageTaken(long nowMs, long windowMs) {
        pruneDamage(nowMs, windowMs);
        return recentDamage.stream().mapToDouble(DamageRecord::amount).sum();
    }

    public double recentControlDuration(long nowMs, long windowMs) {
        pruneControl(nowMs, windowMs);
        long windowStart = Math.max(0L, nowMs - windowMs);
        return recentControl.stream()
                .mapToDouble(record -> overlap(windowStart, nowMs, record.startAtMs(), record.endAtMs()))
                .sum();
    }

    private void pruneDamage(long nowMs, long windowMs) {
        long windowStart = Math.max(0L, nowMs - windowMs);
        while (!recentDamage.isEmpty() && recentDamage.peekFirst().timeMs() < windowStart) {
            recentDamage.removeFirst();
        }
    }

    private void pruneControl(long nowMs, long windowMs) {
        long windowStart = Math.max(0L, nowMs - windowMs);
        while (!recentControl.isEmpty() && recentControl.peekFirst().endAtMs() < windowStart) {
            recentControl.removeFirst();
        }
    }

    private double overlap(long windowStart, long windowEnd, long recordStart, long recordEnd) {
        long start = Math.max(windowStart, recordStart);
        long end = Math.min(windowEnd, recordEnd);
        return Math.max(0L, end - start);
    }
}
