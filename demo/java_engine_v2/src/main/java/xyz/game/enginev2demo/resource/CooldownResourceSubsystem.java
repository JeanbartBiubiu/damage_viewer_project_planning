package xyz.game.enginev2demo.resource;

import java.util.Map;

import xyz.game.enginev2demo.action.ActionTemplate;
import xyz.game.enginev2demo.formula.FormulaCatalog;
import xyz.game.enginev2demo.formula.FormulaEvalContext;
import xyz.game.enginev2demo.formula.FormulaService;
import xyz.game.enginev2demo.runtime.ActionRuntimeState;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.ResourceState;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 冷却与资源子系统——负责动作施放前的冷却和资源可用性检查，
 * 以及统一的冷却时长求值。
 */
public final class CooldownResourceSubsystem {

    private final FormulaService formulaService;
    private final FormulaCatalog formulaCatalog;

    public CooldownResourceSubsystem(FormulaService formulaService, FormulaCatalog formulaCatalog) {
        this.formulaService = formulaService;
        this.formulaCatalog = formulaCatalog;
    }

    /**
     * 求本次冷却时长（毫秒），已做归一化。
     * 非法数值或 &lt;= 0 钳成 1ms。
     */
    public long evaluateCooldownMs(RuntimeState state, ActorRuntime source, ActorRuntime target, ActionTemplate actionTemplate) {
        double raw = formulaService.evaluate(
                formulaCatalog.require(actionTemplate.cooldownFormulaId()),
                new FormulaEvalContext(state, source, target, Map.of()));
        return normalizeCooldown(raw);
    }

    public void assertResourcesAvailable(ActorRuntime actorRuntime, ActionTemplate actionTemplate) {
        for (Map.Entry<String, Double> entry : actionTemplate.resourceCosts().entrySet()) {
            ResourceState resourceState = actorRuntime.resource(entry.getKey());
            double current = resourceState == null ? 0.0 : resourceState.current();
            if (current < entry.getValue()) {
                throw new IllegalStateException("action_blocked:resource:" + entry.getKey());
            }
        }
    }

    public void assertNotOnCooldown(RuntimeState state, ActorRuntime actorRuntime, String actionId) {
        ActionRuntimeState actionRuntimeState = actorRuntime.actionState(actionId);
        if (actionRuntimeState.readyAtMs() > state.nowMs()) {
            throw new IllegalStateException("action_blocked:cooldown");
        }
    }

    private long normalizeCooldown(double raw) {
        if (!Double.isFinite(raw) || raw <= 0.0) {
            return 1L;
        }
        return Math.max(1L, Math.round(raw));
    }
}
