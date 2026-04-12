package xyz.game.enginev2demo.crit;

import java.util.Map;

import xyz.game.enginev2demo.formula.FormulaCatalog;
import xyz.game.enginev2demo.formula.FormulaEvalContext;
import xyz.game.enginev2demo.formula.FormulaService;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 统一数值求值入口——先公式求 base value，再根据暴击上下文决定是否放大。
 * <p>
 * 所有来自公式的数值字段（伤害、护盾、治疗、属性修正、CD 修改、status magnitude/duration）
 * 都应通过此服务求值，以便统一接入暴击放大。
 */
public final class ScalarResolutionService {

    private final FormulaService formulaService;
    private final FormulaCatalog formulaCatalog;
    private final CritSubsystem critSubsystem;

    public ScalarResolutionService(
            FormulaService formulaService,
            FormulaCatalog formulaCatalog,
            CritSubsystem critSubsystem) {
        this.formulaService = formulaService;
        this.formulaCatalog = formulaCatalog;
        this.critSubsystem = critSubsystem;
    }

    /**
     * 求值一个标量数值字段。
     *
     * @param spec                 数值字段描述
     * @param state                runtime state
     * @param source               来源 actor
     * @param target               目标 actor
     * @param inputValues          公式求值输入
     * @param actionCritType       动作级 critType（可为 null）
     * @param executionCritResult  本次 execution 的暴击结果
     * @return 求值结果
     */
    public ResolvedScalar resolveScalar(
            ScalarSpec spec,
            RuntimeState state,
            ActorRuntime source,
            ActorRuntime target,
            Map<String, Double> inputValues,
            String actionCritType,
            ExecutionCritResult executionCritResult) {

        double baseValue = formulaService.evaluate(
                formulaCatalog.require(spec.formulaId()),
                new FormulaEvalContext(state, source, target, inputValues));

        if (!spec.allowCrit()) {
            return ResolvedScalar.plain(baseValue);
        }

        String effectiveCritType = (spec.critTypeOverride() != null && !spec.critTypeOverride().isEmpty())
                ? spec.critTypeOverride() : actionCritType;

        if (effectiveCritType == null || effectiveCritType.isEmpty()) {
            return ResolvedScalar.plain(baseValue);
        }

        if (executionCritResult == null || !executionCritResult.resolved() || !executionCritResult.isCritical()) {
            return new ResolvedScalar(baseValue, baseValue, false, 1.0, effectiveCritType);
        }

        double finalValue = baseValue * executionCritResult.critMultiplier();
        return new ResolvedScalar(
                baseValue,
                finalValue,
                true,
                executionCritResult.critMultiplier(),
                executionCritResult.critType());
    }

    /**
     * 简单求值——不参与暴击（向后兼容快捷方法）。
     */
    public double evaluateRaw(String formulaId, RuntimeState state, ActorRuntime source, ActorRuntime target,
                              Map<String, Double> inputValues) {
        return formulaService.evaluate(
                formulaCatalog.require(formulaId),
                new FormulaEvalContext(state, source, target, inputValues));
    }
}
