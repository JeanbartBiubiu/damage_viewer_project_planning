package xyz.game.enginev2demo.crit;

/**
 * 可插拔暴击判定策略接口。
 * <p>
 * 第一版仅实现 {@link DeterministicCounterCritStrategy}，
 * 但 {@link CritSubsystem} 通过此接口调用，不直接绑定具体实现。
 */
public interface CritStrategy {

    /**
     * 对给定上下文做暴击判定。
     *
     * @param context 暴击评估上下文
     * @return 判定结果
     */
    CritResolution resolve(CritEvalContext context);
}
