package xyz.game.enginev2demo;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import xyz.game.enginev2demo.action.ActionGateDef;
import xyz.game.enginev2demo.action.ActionTemplate;
import xyz.game.enginev2demo.cadence.CadenceOp;
import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.ActorTemplate;
import xyz.game.enginev2demo.api.AttrModifierDef;
import xyz.game.enginev2demo.api.CombatantRunInit;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunInput;
import xyz.game.enginev2demo.api.ItemTemplate;
import xyz.game.enginev2demo.api.StatusTemplate;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.crit.CritRuleTemplate;
import xyz.game.enginev2demo.crit.CritStrategyKind;
import xyz.game.enginev2demo.formula.FormulaDefinition;
import xyz.game.enginev2demo.formula.FormulaNode;
import xyz.game.enginev2demo.pipeline.DamageProfileTemplate;
import xyz.game.enginev2demo.runtime.AttrModifierMode;
import xyz.game.enginev2demo.runtime.CounterResetMode;
import xyz.game.enginev2demo.runtime.CounterScope;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.EffectDef;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerSubscriptionDef;
import xyz.game.enginev2demo.trigger.TriggerType;

final class DemoFixtures {

    static final String PHYSICAL_PROFILE = "profile_physical";
    static final String MAGICAL_PROFILE = "profile_magical";
    static final String TRUE_PROFILE = "profile_true";

    private static final String FORMULA_PHYSICAL_EFFECTIVE_RESISTANCE = "profile_physical_effective_resistance";
    private static final String FORMULA_MAGICAL_EFFECTIVE_RESISTANCE = "profile_magical_effective_resistance";
    private static final String FORMULA_TRUE_EFFECTIVE_RESISTANCE = "profile_true_effective_resistance";
    private static final String FORMULA_STANDARD_MITIGATION = "profile_standard_mitigation";
    private static final String FORMULA_TRUE_MITIGATION = "profile_true_mitigation";

    /** 默认零冷却公式 ID，求值为 0 → 归一化钳成 1ms。 */
    static final String FORMULA_ZERO_COOLDOWN = "formula_zero_cooldown";

    private DemoFixtures() {
    }

    static ActorTemplate actor(String templateId, Map<String, Double> attributes, String... actionIds) {
        return new ActorTemplate(templateId, attributes, Map.of(), List.of(actionIds), List.of());
    }

    static ActorTemplate actorWithResources(
            String templateId,
            Map<String, Double> attributes,
            Map<String, Double> initialResources,
            String... actionIds) {
        return new ActorTemplate(templateId, attributes, initialResources, List.of(actionIds), List.of());
    }

    static ActorTemplate actorWithTriggers(
            String templateId,
            Map<String, Double> attributes,
            List<TriggerSubscriptionDef> triggerSubscriptions,
            String... actionIds) {
        return new ActorTemplate(templateId, attributes, Map.of(), List.of(actionIds), triggerSubscriptions);
    }

    static ActorTemplate actorWithResourcesAndTriggers(
            String templateId,
            Map<String, Double> attributes,
            Map<String, Double> initialResources,
            List<TriggerSubscriptionDef> triggerSubscriptions,
            String... actionIds) {
        return new ActorTemplate(templateId, attributes, initialResources, List.of(actionIds), triggerSubscriptions);
    }

    static ActionTemplate action(String actionId, String label, String damageProfileId, String formulaId) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                FORMULA_ZERO_COOLDOWN, false, 1, List.of(), Map.of(), List.of(), List.of());
    }

    static ActionTemplate repeatingAction(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            String cooldownFormulaId) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                cooldownFormulaId, true, 1, List.of(), Map.of(), List.of(), List.of());
    }

    static ActionTemplate actionWithTriggers(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            List<TriggerSubscriptionDef> triggerSubscriptions) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                FORMULA_ZERO_COOLDOWN, false, 1, List.of(), Map.of(), List.of(), triggerSubscriptions);
    }

    static ActionTemplate actionWithConfig(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            String cooldownFormulaId,
            Map<String, Double> resourceCosts,
            List<ActionGateDef> actionGates,
            List<TriggerSubscriptionDef> triggerSubscriptions) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                cooldownFormulaId, false, 1, List.of(), resourceCosts, actionGates, triggerSubscriptions);
    }

    static ActionTemplate taggedAction(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            String cooldownFormulaId,
            List<String> tags) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                cooldownFormulaId, false, 1, tags, Map.of(), List.of(), List.of());
    }

    static ActionTemplate taggedRepeatingAction(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            String cooldownFormulaId,
            List<String> tags) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                cooldownFormulaId, true, 1, tags, Map.of(), List.of(), List.of());
    }

    static ActionTemplate chargedAction(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            String cooldownFormulaId,
            int maxCharges,
            List<String> tags) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                cooldownFormulaId, false, maxCharges, tags, Map.of(), List.of(), List.of());
    }

    static ItemTemplate item(String itemId, String label, TriggerSubscriptionDef... triggerSubscriptions) {
        return new ItemTemplate(itemId, label, List.of(triggerSubscriptions));
    }

    static StatusTemplate status(
            String statusId,
            String label,
            StatusKind statusKind,
            long durationMs,
            StatusRefreshPolicy refreshPolicy,
            String magnitudeFormulaId,
            List<AttrModifierDef> attrModifiers,
            TriggerSubscriptionDef... triggerSubscriptions) {
        return new StatusTemplate(
                statusId,
                label,
                statusKind,
                durationMs,
                refreshPolicy,
                magnitudeFormulaId,
                attrModifiers,
                List.of(triggerSubscriptions));
    }

    static StatusTemplate status(
            String statusId,
            String label,
            StatusKind statusKind,
            long durationMs,
            StatusRefreshPolicy refreshPolicy,
            String magnitudeFormulaId,
            TriggerSubscriptionDef... triggerSubscriptions) {
        return status(
                statusId,
                label,
                statusKind,
                durationMs,
                refreshPolicy,
                magnitudeFormulaId,
                List.of(),
                triggerSubscriptions);
    }

    static StatusTemplate status(String statusId, String label, TriggerSubscriptionDef... triggerSubscriptions) {
        return status(
                statusId,
                label,
                StatusKind.SHIELD,
                0L,
                StatusRefreshPolicy.TAKE_MAX,
                null,
                List.of(),
                triggerSubscriptions);
    }

    static StatusTemplate attributeModifierStatus(
            String statusId,
            String label,
            long durationMs,
            AttrModifierDef... attrModifiers) {
        return new StatusTemplate(
                statusId,
                label,
                StatusKind.ATTRIBUTE_MODIFIER,
                durationMs,
                StatusRefreshPolicy.REPLACE,
                null,
                List.of(attrModifiers),
                List.of());
    }

    static AttrModifierDef flatModifier(String attrKey, String formulaId) {
        return new AttrModifierDef(attrKey, AttrModifierMode.FLAT, formulaId);
    }

    static AttrModifierDef percentModifier(String attrKey, String formulaId) {
        return new AttrModifierDef(attrKey, AttrModifierMode.PERCENT, formulaId);
    }

    static TriggerSubscriptionDef trigger(
            TriggerType triggerType,
            EventActorRole ownerEventRole,
            boolean requiresPositiveDamage,
            EffectDef... effects) {
        return new TriggerSubscriptionDef(triggerType, ownerEventRole, null, requiresPositiveDamage, List.of(effects));
    }

    static TriggerSubscriptionDef conditionalTrigger(
            TriggerType triggerType,
            EventActorRole ownerEventRole,
            String conditionFormulaId,
            boolean requiresPositiveDamage,
            EffectDef... effects) {
        return new TriggerSubscriptionDef(triggerType, ownerEventRole, conditionFormulaId, requiresPositiveDamage, List.of(effects));
    }

    static EffectDef.DealDamageEffect dealDamageEffect(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) {
        return new EffectDef.DealDamageEffect(actionId, label, damageProfileId, formulaId, sourceActorRole, targetActorRole);
    }

    static EffectDef.GrantShieldEffect grantShieldEffect(
            String label,
            String formulaId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) {
        return new EffectDef.GrantShieldEffect(label, formulaId, sourceActorRole, targetActorRole);
    }

    static EffectDef.ApplyStatusEffect applyStatusEffect(
            String statusId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) {
        return new EffectDef.ApplyStatusEffect(statusId, sourceActorRole, targetActorRole);
    }

    static EffectDef.ApplyMarkEffect applyMarkEffect(
            String markId,
            long durationMs,
            boolean consumable,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) {
        return new EffectDef.ApplyMarkEffect(markId, durationMs, consumable, sourceActorRole, targetActorRole);
    }

    static EffectDef.ConsumeMarkEffect consumeMarkEffect(
            String markId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) {
        return new EffectDef.ConsumeMarkEffect(markId, sourceActorRole, targetActorRole);
    }

    static EffectDef.ModifyCounterEffect modifyCounterEffect(
            String counterId,
            CounterScope counterScope,
            int delta,
            int threshold,
            CounterResetMode resetMode,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) {
        return new EffectDef.ModifyCounterEffect(
                counterId,
                counterScope,
                delta,
                threshold,
                resetMode,
                sourceActorRole,
                targetActorRole);
    }

    static EffectDef.ModifyCadenceEffect modifyCadenceEffect(
            EventActorRole affectedActorRole,
            List<String> targetActionTags,
            CadenceOp op,
            String valueFormulaId) {
        return new EffectDef.ModifyCadenceEffect(affectedActorRole, targetActionTags, op, valueFormulaId);
    }

    static FormulaDefinition sourceAttrFormula(String formulaId, String attrKey) {
        return new FormulaDefinition(formulaId, new FormulaNode.Attr(FormulaNode.Scope.SOURCE, attrKey));
    }

    static FormulaDefinition targetAttrFormula(String formulaId, String attrKey) {
        return new FormulaDefinition(formulaId, new FormulaNode.Attr(FormulaNode.Scope.TARGET, attrKey));
    }

    static FormulaDefinition constantFormula(String formulaId, double value) {
        return new FormulaDefinition(formulaId, new FormulaNode.Constant(value));
    }

    static FormulaDefinition inputValueFormula(String formulaId, String key) {
        return new FormulaDefinition(formulaId, new FormulaNode.InputValue(key));
    }

    static FormulaDefinition multiplyFormula(String formulaId, FormulaNode... nodes) {
        return new FormulaDefinition(formulaId, new FormulaNode.Multiply(List.of(nodes)));
    }

    static FormulaDefinition addFormula(String formulaId, FormulaNode... nodes) {
        return new FormulaDefinition(formulaId, new FormulaNode.Add(List.of(nodes)));
    }

    static FormulaDefinition recentDamageFormula(String formulaId, FormulaNode.Scope scope, long windowMs) {
        return new FormulaDefinition(formulaId, new FormulaNode.RecentDamageTaken(scope, windowMs));
    }

    static FormulaDefinition recentControlFormula(String formulaId, FormulaNode.Scope scope, long windowMs) {
        return new FormulaDefinition(formulaId, new FormulaNode.RecentControlDuration(scope, windowMs));
    }

    static FormulaDefinition resourceValueFormula(String formulaId, FormulaNode.Scope scope, String resourceId) {
        return new FormulaDefinition(formulaId, new FormulaNode.ResourceValue(scope, resourceId));
    }

    static FormulaDefinition counterValueFormula(
            String formulaId,
            CounterScope counterScope,
            FormulaNode.Scope scope,
            String counterId) {
        return new FormulaDefinition(formulaId, new FormulaNode.CounterValue(counterScope, scope, counterId));
    }

    static ActionGateDef.RequireMarkGate requireMarkGate(String markId) {
        return new ActionGateDef.RequireMarkGate(markId);
    }

    static EngineBundle bundle(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            FormulaDefinition... formulas) {
        return bundle(actorTemplates, actionTemplates, Map.of(), Map.of(), Map.of(), formulas);
    }

    static EngineBundle bundle(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            Map<String, DamageProfileTemplate> extraDamageProfiles,
            FormulaDefinition... formulas) {
        return bundle(actorTemplates, actionTemplates, Map.of(), Map.of(), extraDamageProfiles, formulas);
    }

    static EngineBundle bundle(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            Map<String, ItemTemplate> itemTemplates,
            Map<String, StatusTemplate> statusTemplates,
            FormulaDefinition... formulas) {
        return bundle(actorTemplates, actionTemplates, itemTemplates, statusTemplates, Map.of(), formulas);
    }

    static EngineBundle bundle(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            Map<String, ItemTemplate> itemTemplates,
            Map<String, StatusTemplate> statusTemplates,
            Map<String, DamageProfileTemplate> extraDamageProfiles,
            FormulaDefinition... formulas) {
        Map<String, DamageProfileTemplate> mergedProfiles = new LinkedHashMap<>(standardDamageProfiles());
        mergedProfiles.putAll(extraDamageProfiles);
        return new EngineBundle(
                actorTemplates,
                actionTemplates,
                itemTemplates,
                statusTemplates,
                mergedProfiles,
                mergeDefaultFormulas(formulas));
    }

    static CombatantRunInit combatant(String actorId, String templateId) {
        return new CombatantRunInit(actorId, templateId, List.of(), List.of());
    }

    static CombatantRunInit combatant(
            String actorId,
            String templateId,
            List<String> equippedItemIds,
            List<String> initialStatusIds) {
        return new CombatantRunInit(actorId, templateId, equippedItemIds, initialStatusIds);
    }

    static EngineRunInput runInput(List<ActionRequest> initialActions) {
        return runInput(combatant("self", "self_template"), combatant("enemy", "enemy_template"), initialActions);
    }

    static EngineRunInput runInput(
            CombatantRunInit self,
            CombatantRunInit enemy,
            List<ActionRequest> initialActions) {
        return runInput(7L, StopCondition.defaultStop(), self, enemy, initialActions);
    }

    static EngineRunInput runInput(
            long seed,
            StopCondition stopCondition,
            CombatantRunInit self,
            CombatantRunInit enemy,
            List<ActionRequest> initialActions) {
        return new EngineRunInput(
                seed,
                stopCondition,
                self,
                enemy,
                initialActions);
    }

    private static Map<String, DamageProfileTemplate> standardDamageProfiles() {
        return Map.of(
                PHYSICAL_PROFILE, new DamageProfileTemplate(
                        PHYSICAL_PROFILE,
                        FORMULA_PHYSICAL_EFFECTIVE_RESISTANCE,
                        FORMULA_STANDARD_MITIGATION),
                MAGICAL_PROFILE, new DamageProfileTemplate(
                        MAGICAL_PROFILE,
                        FORMULA_MAGICAL_EFFECTIVE_RESISTANCE,
                        FORMULA_STANDARD_MITIGATION),
                TRUE_PROFILE, new DamageProfileTemplate(
                        TRUE_PROFILE,
                        FORMULA_TRUE_EFFECTIVE_RESISTANCE,
                        FORMULA_TRUE_MITIGATION));
    }

    private static List<FormulaDefinition> mergeDefaultFormulas(FormulaDefinition... formulas) {
        List<FormulaDefinition> merged = new ArrayList<>(defaultDamageProfileFormulas());
        merged.add(new FormulaDefinition(FORMULA_ZERO_COOLDOWN, new FormulaNode.Constant(0.0)));
        merged.addAll(List.of(formulas));
        return List.copyOf(merged);
    }

    private static List<FormulaDefinition> defaultDamageProfileFormulas() {
        FormulaNode targetArmor = new FormulaNode.Attr(FormulaNode.Scope.TARGET, "armor");
        FormulaNode sourceArmorPen = new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "armor_pen_flat");
        FormulaNode targetMagicResist = new FormulaNode.Attr(FormulaNode.Scope.TARGET, "magic_resist");
        FormulaNode sourceMagicPen = new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "magic_pen_flat");
        FormulaNode effectiveResistance = new FormulaNode.InputValue("effective_resistance");
        FormulaDefinition physicalEffectiveResistance = new FormulaDefinition(
                FORMULA_PHYSICAL_EFFECTIVE_RESISTANCE,
                new FormulaNode.Max(List.of(
                        new FormulaNode.Constant(-99.0),
                        new FormulaNode.Add(List.of(
                                targetArmor,
                                new FormulaNode.Multiply(List.of(new FormulaNode.Constant(-1.0), sourceArmorPen)))))));
        FormulaDefinition magicalEffectiveResistance = new FormulaDefinition(
                FORMULA_MAGICAL_EFFECTIVE_RESISTANCE,
                new FormulaNode.Max(List.of(
                        new FormulaNode.Constant(-99.0),
                        new FormulaNode.Add(List.of(
                                targetMagicResist,
                                new FormulaNode.Multiply(List.of(new FormulaNode.Constant(-1.0), sourceMagicPen)))))));
        FormulaDefinition trueEffectiveResistance = constantFormula(FORMULA_TRUE_EFFECTIVE_RESISTANCE, 0.0);

        FormulaNode positiveMultiplier = new FormulaNode.Divide(
                new FormulaNode.Constant(100.0),
                new FormulaNode.Add(List.of(new FormulaNode.Constant(100.0), effectiveResistance)));
        FormulaNode negativeDenominator = new FormulaNode.Add(List.of(
                new FormulaNode.Constant(100.0),
                new FormulaNode.Multiply(List.of(new FormulaNode.Constant(-1.0), effectiveResistance))));
        FormulaNode negativeMultiplier = new FormulaNode.Add(List.of(
                new FormulaNode.Constant(2.0),
                new FormulaNode.Multiply(List.of(
                        new FormulaNode.Constant(-1.0),
                        new FormulaNode.Divide(new FormulaNode.Constant(100.0), negativeDenominator)))));
        FormulaDefinition standardMitigation = new FormulaDefinition(
                FORMULA_STANDARD_MITIGATION,
                new FormulaNode.SignSwitch(effectiveResistance, positiveMultiplier, negativeMultiplier));
        FormulaDefinition trueMitigation = constantFormula(FORMULA_TRUE_MITIGATION, 1.0);

        return List.of(
                physicalEffectiveResistance,
                magicalEffectiveResistance,
                trueEffectiveResistance,
                standardMitigation,
                trueMitigation);
    }

    // ──────────────── Crit Helpers ────────────────

    /** 默认暴击倍率公式 ID（测试中常用 2.0）。 */
    static final String FORMULA_CRIT_MULTIPLIER = "formula_crit_multiplier";

    /** 默认暴击类型标签。 */
    static final String CRIT_TYPE_PHYSICAL = "physical_crit";

    /** 带 critType 的普通动作（零冷却，不自动重复）。 */
    static ActionTemplate critAction(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            String critType) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                FORMULA_ZERO_COOLDOWN, false, 1, List.of(), Map.of(), List.of(), List.of(), critType);
    }

    /** 带 critType 和触发器的动作。 */
    static ActionTemplate critActionWithTriggers(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            String critType,
            List<TriggerSubscriptionDef> triggerSubscriptions) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                FORMULA_ZERO_COOLDOWN, false, 1, List.of(), Map.of(), List.of(), triggerSubscriptions, critType);
    }

    /** 带 critType 和自动重复的动作。 */
    static ActionTemplate critRepeatingAction(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            String cooldownFormulaId,
            String critType) {
        return new ActionTemplate(actionId, label, damageProfileId, formulaId,
                cooldownFormulaId, true, 1, List.of(), Map.of(), List.of(), List.of(), critType);
    }

    /** 创建启用的暴击规则。 */
    static CritRuleTemplate critRule(String critType, String multiplierFormulaId) {
        return new CritRuleTemplate(critType, true, CritStrategyKind.DETERMINISTIC_COUNTER, multiplierFormulaId);
    }

    /** 创建禁用的暴击规则。 */
    static CritRuleTemplate disabledCritRule(String critType, String multiplierFormulaId) {
        return new CritRuleTemplate(critType, false, CritStrategyKind.DETERMINISTIC_COUNTER, multiplierFormulaId);
    }

    /** 允许暴击的 DealDamage 效果。 */
    static EffectDef.DealDamageEffect critDealDamageEffect(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) {
        return new EffectDef.DealDamageEffect(actionId, label, damageProfileId, formulaId,
                sourceActorRole, targetActorRole, true, null);
    }

    /** 允许暴击的 GrantShield 效果。 */
    static EffectDef.GrantShieldEffect critGrantShieldEffect(
            String label,
            String formulaId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) {
        return new EffectDef.GrantShieldEffect(label, formulaId, sourceActorRole, targetActorRole, true, null);
    }

    /** 允许暴击的 ApplyStatus 效果。 */
    static EffectDef.ApplyStatusEffect critApplyStatusEffect(
            String statusId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) {
        return new EffectDef.ApplyStatusEffect(statusId, sourceActorRole, targetActorRole, true, null);
    }

    /** 允许暴击的 ModifyCadence 效果。 */
    static EffectDef.ModifyCadenceEffect critModifyCadenceEffect(
            EventActorRole affectedActorRole,
            List<String> targetActionTags,
            CadenceOp op,
            String valueFormulaId) {
        return new EffectDef.ModifyCadenceEffect(affectedActorRole, targetActionTags, op, valueFormulaId, true, null);
    }

    /** 带暴击规则的 bundle（最简形式）。 */
    static EngineBundle bundleWithCrit(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            Map<String, CritRuleTemplate> critRules,
            FormulaDefinition... formulas) {
        return bundleWithCrit(actorTemplates, actionTemplates, Map.of(), Map.of(), Map.of(), critRules, formulas);
    }

    /** 带暴击规则的 bundle（带 item 和 status）。 */
    static EngineBundle bundleWithCrit(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            Map<String, ItemTemplate> itemTemplates,
            Map<String, StatusTemplate> statusTemplates,
            Map<String, CritRuleTemplate> critRules,
            FormulaDefinition... formulas) {
        return bundleWithCrit(actorTemplates, actionTemplates, itemTemplates, statusTemplates, Map.of(), critRules, formulas);
    }

    /** 带暴击规则的 bundle（完整形式）。 */
    static EngineBundle bundleWithCrit(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            Map<String, ItemTemplate> itemTemplates,
            Map<String, StatusTemplate> statusTemplates,
            Map<String, DamageProfileTemplate> extraDamageProfiles,
            Map<String, CritRuleTemplate> critRules,
            FormulaDefinition... formulas) {
        Map<String, DamageProfileTemplate> mergedProfiles = new LinkedHashMap<>(standardDamageProfiles());
        mergedProfiles.putAll(extraDamageProfiles);
        return new EngineBundle(
                actorTemplates,
                actionTemplates,
                itemTemplates,
                statusTemplates,
                mergedProfiles,
                mergeDefaultFormulas(formulas),
                critRules);
    }
}
