package xyz.game.enginev2demo.crit;

import xyz.game.enginev2demo.runtime.ActorRuntime;

/**
 * 确定性计数器暴击策略。
 * <p>
 * 规则：
 * <ul>
 *   <li>{@code crit_chance <= 0} → 不暴击，不推进计数器</li>
 *   <li>{@code crit_chance >= 1} → 必暴击，计数器保持 0</li>
 *   <li>否则 threshold = ceil(1 / crit_chance)，counter++ ≥ threshold 时暴击并重置</li>
 * </ul>
 * 本策略只负责"是否暴击"的判定和计数器推进，
 * 暴击倍率由 {@link CritSubsystem} 通过公式求值。
 */
public final class DeterministicCounterCritStrategy implements CritStrategy {

    @Override
    public CritResolution resolve(CritEvalContext context) {
        double critChance = context.critChance();

        if (critChance <= 0.0) {
            // 不暴击，不推进计数器
            return new CritResolution(false, 1.0);
        }

        ActorRuntime source = context.source();

        if (critChance >= 1.0) {
            // 必暴击，计数器保持 0
            source.setCritCounter(0);
            return new CritResolution(true, 1.0);
        }

        // 确定性计数器
        int threshold = (int) Math.ceil(1.0 / critChance);
        int counter = source.critCounter() + 1;

        if (counter >= threshold) {
            source.setCritCounter(0);
            return new CritResolution(true, 1.0);
        } else {
            source.setCritCounter(counter);
            return new CritResolution(false, 1.0);
        }
    }
}
