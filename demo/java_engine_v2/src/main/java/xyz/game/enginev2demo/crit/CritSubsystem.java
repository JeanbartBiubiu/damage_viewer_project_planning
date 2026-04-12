package xyz.game.enginev2demo.crit;

import java.util.LinkedHashMap;
import java.util.Map;

import xyz.game.enginev2demo.action.ActionTemplate;
import xyz.game.enginev2demo.formula.FormulaCatalog;
import xyz.game.enginev2demo.formula.FormulaEvalContext;
import xyz.game.enginev2demo.formula.FormulaService;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 暴击子系统。
 * <p>
 * 职责：
 * <ul>
 *   <li>持有 critType → CritRuleTemplate 映射</li>
 *   <li>在 active 的前置阶段做一次判定（{@link #resolveExecutionCrit}）</li>
 *   <li>通过可插拔 {@link CritStrategy} 接口做实际判定</li>
 *   <li>暴击倍率由公式求值，不写死常量</li>
 * </ul>
 */
public final class CritSubsystem {

    private final Map<String, CritRuleTemplate> critRules;
    private final Map<CritStrategyKind, CritStrategy> strategies;
    private final FormulaService formulaService;
    private final FormulaCatalog formulaCatalog;

    public CritSubsystem(
            Map<String, CritRuleTemplate> critRules,
            FormulaService formulaService,
            FormulaCatalog formulaCatalog) {
        this.critRules = Map.copyOf(critRules);
        this.formulaService = formulaService;
        this.formulaCatalog = formulaCatalog;
        // 注册策略实例
        this.strategies = new LinkedHashMap<>();
        this.strategies.put(CritStrategyKind.DETERMINISTIC_COUNTER, new DeterministicCounterCritStrategy());
    }

    /**
     * 在一次 active（action execution）前置阶段做暴击判定。
     * <p>
     * 判定逻辑：
     * <ol>
     *   <li>从 ActionTemplate 获取 critType</li>
     *   <li>若 critType 为 null/空，或找不到匹配 CritRule，或 rule disabled → 不暴击，不推进计数器</li>
     *   <li>从 source actor resolved attr 读 crit_chance</li>
     *   <li>委托给对应 CritStrategy</li>
     *   <li>若暴击，通过 multiplierFormulaId 求倍率</li>
     * </ol>
     */
    public ExecutionCritResult resolveExecutionCrit(
            RuntimeState state,
            ActorRuntime source,
            ActorRuntime target,
            ActionTemplate actionTemplate) {
        String critType = actionTemplate.critType();

        if (critType == null || critType.isEmpty()) {
            return ExecutionCritResult.noCrit();
        }

        CritRuleTemplate rule = critRules.get(critType);
        if (rule == null || !rule.enabled()) {
            return ExecutionCritResult.noCrit();
        }

        double critChance = source.attr("crit_chance");
        if (critChance <= 0.0) {
            return ExecutionCritResult.noCrit();
        }

        CritStrategy strategy = strategies.get(rule.strategyKind());
        if (strategy == null) {
            return ExecutionCritResult.noCrit();
        }

        CritEvalContext evalContext = new CritEvalContext(
                state, source, target, actionTemplate.actionId(), critType, critChance);
        CritResolution resolution = strategy.resolve(evalContext);

        if (!resolution.isCritical()) {
            return ExecutionCritResult.noCrit();
        }

        // 求取暴击倍率
        double multiplier = formulaService.evaluate(
                formulaCatalog.require(rule.multiplierFormulaId()),
                new FormulaEvalContext(state, source, target,
                        Map.of("crit_chance", critChance)));

        return ExecutionCritResult.crit(multiplier, critType);
    }

    /**
     * 将暴击倍率应用到基础数值上。
     *
     * @param baseValue       公式求值得到的基础值
     * @param allowCrit       该字段是否允许暴击
     * @param critTypeOverride 效果级 critType 覆盖（可为 null）
     * @param actionCritType  动作级 critType（可为 null）
     * @param executionCritResult 本次 execution 的暴击结果
     * @return 应用暴击后的最终值
     */
    public double applyCrit(
            double baseValue,
            boolean allowCrit,
            String critTypeOverride,
            String actionCritType,
            ExecutionCritResult executionCritResult) {
        if (!allowCrit) {
            return baseValue;
        }
        String effectiveCritType = (critTypeOverride != null && !critTypeOverride.isEmpty())
                ? critTypeOverride : actionCritType;
        if (effectiveCritType == null || effectiveCritType.isEmpty()) {
            return baseValue;
        }
        if (!executionCritResult.resolved() || !executionCritResult.isCritical()) {
            return baseValue;
        }
        return baseValue * executionCritResult.critMultiplier();
    }
}
