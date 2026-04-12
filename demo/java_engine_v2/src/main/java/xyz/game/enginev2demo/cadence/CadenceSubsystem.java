package xyz.game.enginev2demo.cadence;

import java.util.Collections;
import java.util.Iterator;
import java.util.List;
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
 * 统一节奏子系统——冷却 + 充能 + 节奏修改。
 * <p>
 * 取代原 {@code CooldownResourceSubsystem}，负责：
 * <ul>
 *   <li>动作可用性检查（冷却 / 充能 / 资源）</li>
 *   <li>施放后消耗（写 readyAtMs / 扣充能层 / 开启回充）</li>
 *   <li>回充结算（settleRecharges）</li>
 *   <li>通用节奏修改（modifyCadence）</li>
 *   <li>冷却公式求值</li>
 * </ul>
 */
public final class CadenceSubsystem {

    private final FormulaService formulaService;
    private final FormulaCatalog formulaCatalog;
    private final Map<String, ActionTemplate> actionTemplates;

    public CadenceSubsystem(FormulaService formulaService, FormulaCatalog formulaCatalog,
                            Map<String, ActionTemplate> actionTemplates) {
        this.formulaService = formulaService;
        this.formulaCatalog = formulaCatalog;
        this.actionTemplates = actionTemplates;
    }

    // ── 可用性检查 ─────────────────────────────────────────────

    /**
     * 统一替代 assertNotOnCooldown：非充能检查 readyAtMs，充能检查 currentCharges。
     */
    public void assertActionAvailable(RuntimeState state, ActorRuntime actorRuntime, String actionId) {
        ActionRuntimeState ars = actorRuntime.actionState(actionId);
        settleRecharges(state.nowMs(), ars);
        if (ars.maxCharges() > 1) {
            if (ars.currentCharges() <= 0) {
                throw new IllegalStateException("action_blocked:cooldown");
            }
        } else {
            if (ars.readyAtMs() > state.nowMs()) {
                throw new IllegalStateException("action_blocked:cooldown");
            }
        }
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

    // ── 施放消耗 ──────────────────────────────────────────────

    /**
     * 施放成功后消耗冷却 / 充能。
     * <p>
     * 非充能动作：根据 cooldownFormulaId 写 readyAtMs。<br>
     * 充能动作：扣 1 层 currentCharges，新增一条回充结束时刻；
     * 扣完后若 currentCharges==0，readyAtMs 设为最早回充完成时刻。
     */
    public void consumeOnCast(RuntimeState state, ActorRuntime source, ActorRuntime target, ActionTemplate actionTemplate) {
        ActionRuntimeState ars = source.actionState(actionTemplate.actionId());
        long cooldownMs = evaluateCooldownMs(state, source, target, actionTemplate);

        if (ars.maxCharges() > 1) {
            ars.setCurrentCharges(ars.currentCharges() - 1);
            long rechargeEnd = state.nowMs() + cooldownMs;
            insertSorted(ars.rechargeEndTimesMs(), rechargeEnd);
            if (ars.currentCharges() <= 0) {
                ars.setReadyAtMs(ars.rechargeEndTimesMs().get(0));
            }
        } else {
            ars.setReadyAtMs(state.nowMs() + cooldownMs);
        }
    }

    // ── 回充结算 ──────────────────────────────────────────────

    /**
     * 把已到时的 rechargeEndTimesMs 收割进 currentCharges，并重新计算 readyAtMs。
     */
    public void settleRecharges(long nowMs, ActionRuntimeState ars) {
        if (ars.rechargeEndTimesMs().isEmpty()) {
            return;
        }
        Iterator<Long> it = ars.rechargeEndTimesMs().iterator();
        while (it.hasNext()) {
            long endTime = it.next();
            if (endTime <= nowMs) {
                ars.setCurrentCharges(Math.min(ars.maxCharges(), ars.currentCharges() + 1));
                it.remove();
            }
        }
        if (ars.currentCharges() > 0) {
            ars.setReadyAtMs(Math.min(ars.readyAtMs(), nowMs));
        } else if (!ars.rechargeEndTimesMs().isEmpty()) {
            ars.setReadyAtMs(ars.rechargeEndTimesMs().get(0));
        }
    }

    // ── 节奏修改 ──────────────────────────────────────────────

    /**
     * 响应 ModifyCadenceCommand：按 tag 过滤 actor 名下的动作，逐个应用节奏修改。
     */
    public void modifyCadence(RuntimeState state, ActorRuntime actor, List<String> targetActionTags, CadenceOp op, double value) {
        long nowMs = state.nowMs();
        for (ActionRuntimeState ars : actor.actions().values()) {
            ActionTemplate at = actionTemplates.get(ars.actionId());
            if (at == null || !hasTagIntersection(at.tags(), targetActionTags)) {
                continue;
            }
            settleRecharges(nowMs, ars);
            applyModification(nowMs, ars, op, value);
        }
    }

    // ── 冷却公式求值 ──────────────────────────────────────────

    /**
     * 求本次冷却时长（毫秒），已做归一化。 非法数值或 &le; 0 钳成 1ms。
     */
    public long evaluateCooldownMs(RuntimeState state, ActorRuntime source, ActorRuntime target, ActionTemplate actionTemplate) {
        double raw = formulaService.evaluate(
                formulaCatalog.require(actionTemplate.cooldownFormulaId()),
                new FormulaEvalContext(state, source, target, Map.of()));
        return normalizeCooldown(raw);
    }

    // ── 内部实现 ──────────────────────────────────────────────

    private void applyModification(long nowMs, ActionRuntimeState ars, CadenceOp op, double value) {
        switch (op) {
            case REDUCE_REMAINING_CD_FLAT_MS -> {
                long remaining = Math.max(0, ars.readyAtMs() - nowMs);
                if (remaining <= 0) return; // already ready
                remaining = Math.max(0, remaining - (long) value);
                ars.setReadyAtMs(nowMs + remaining);
            }
            case REDUCE_REMAINING_CD_PERCENT -> {
                long remaining = Math.max(0, ars.readyAtMs() - nowMs);
                if (remaining <= 0) return;
                remaining = Math.max(0, (long) (remaining * (1.0 - value)));
                ars.setReadyAtMs(nowMs + remaining);
            }
            case RESET_CD -> {
                if (ars.maxCharges() > 1) {
                    ars.setCurrentCharges(ars.maxCharges());
                    ars.rechargeEndTimesMs().clear();
                }
                ars.setReadyAtMs(nowMs);
            }
            case GRANT_CHARGE -> {
                if (ars.maxCharges() <= 1) return;
                ars.setCurrentCharges(Math.min(ars.maxCharges(), ars.currentCharges() + 1));
                if (ars.currentCharges() >= ars.maxCharges() && !ars.rechargeEndTimesMs().isEmpty()) {
                    ars.rechargeEndTimesMs().remove(0);
                }
                if (ars.currentCharges() > 0) {
                    ars.setReadyAtMs(Math.min(ars.readyAtMs(), nowMs));
                }
            }
            case REDUCE_RECHARGE_FLAT_MS -> {
                if (ars.maxCharges() <= 1 || ars.rechargeEndTimesMs().isEmpty()) return;
                for (int i = 0; i < ars.rechargeEndTimesMs().size(); i++) {
                    long end = ars.rechargeEndTimesMs().get(i);
                    ars.rechargeEndTimesMs().set(i, Math.max(nowMs, end - (long) value));
                }
                Collections.sort(ars.rechargeEndTimesMs());
                settleRecharges(nowMs, ars);
            }
            case REDUCE_RECHARGE_PERCENT -> {
                if (ars.maxCharges() <= 1 || ars.rechargeEndTimesMs().isEmpty()) return;
                for (int i = 0; i < ars.rechargeEndTimesMs().size(); i++) {
                    long end = ars.rechargeEndTimesMs().get(i);
                    long rem = Math.max(0, (long) ((end - nowMs) * (1.0 - value)));
                    ars.rechargeEndTimesMs().set(i, nowMs + rem);
                }
                Collections.sort(ars.rechargeEndTimesMs());
                settleRecharges(nowMs, ars);
            }
        }
    }

    private static boolean hasTagIntersection(List<String> actionTags, List<String> targetTags) {
        for (String t : targetTags) {
            if (actionTags.contains(t)) {
                return true;
            }
        }
        return false;
    }

    private static void insertSorted(List<Long> sortedList, long value) {
        int idx = Collections.binarySearch(sortedList, value);
        if (idx < 0) idx = -(idx + 1);
        sortedList.add(idx, value);
    }

    private long normalizeCooldown(double raw) {
        if (!Double.isFinite(raw) || raw <= 0.0) {
            return 1L;
        }
        return Math.max(1L, Math.round(raw));
    }
}
