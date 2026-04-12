package xyz.game.enginev2demo.formula;

import java.util.Map;
import java.util.Objects;

import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 公式求值上下文——封装求值时需要的运行时信息。
 *
 * @param state       当前全局运行时状态（用于访问时间、pair state 等），仅纯公式求值时可为 null
 * @param source      施放者 ActorRuntime
 * @param target      目标 ActorRuntime
 * @param inputValues 事件上下文传入的键值对（如 dealt_damage、raw_damage 等）
 */
public record FormulaEvalContext(
        RuntimeState state,
        ActorRuntime source,
        ActorRuntime target,
        Map<String, Double> inputValues) {

    public FormulaEvalContext {
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(target, "target");
        inputValues = Map.copyOf(inputValues);
    }

    public FormulaEvalContext(
            ActorRuntime source,
            ActorRuntime target,
            Map<String, Double> inputValues) {
        this(null, source, target, inputValues);
    }
}
