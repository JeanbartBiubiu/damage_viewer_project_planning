package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.AttrModifierDef;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.crit.ScalarEffectLogEntry;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

/**
 * ApplyStatus 的 attrModifier 值在 allowCrit=true + 暴击时被放大。
 * <p>
 * 场景：ON_ACTION_CAST → apply ATTRIBUTE_MODIFIER status with flat +20 attack_damage。
 * crit_chance=1.0, critMultiplier=2.0 → flat modifier = 20 * 2.0 = 40。
 * 然后 probe action 读 source's resolved attack_damage，
 * 验证 resolved attack_damage = 100 + 40 = 140。
 */
class CritAttrModifierValueCanCritTest {

    @Test
    void attrModifierValueIsCrittedWhenAllowCrit() {
        // buff_action (action-owned ON_ACTION_CAST trigger) → apply status (ATTR_MOD) with allowCrit=true
        // Use critActionWithTriggers so trigger is action-owned, not actor-owned
        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 500.0, "attack_damage", 100.0, "crit_chance", 1.0),
                                "buff_action", "probe"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 500.0))),
                Map.of(
                        "buff_action", DemoFixtures.critActionWithTriggers(
                                "buff_action", "Buff",
                                DemoFixtures.TRUE_PROFILE, "zero_formula",
                                DemoFixtures.CRIT_TYPE_PHYSICAL,
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.critApplyStatusEffect(
                                                "ad_buff",
                                                EventActorRole.SOURCE,
                                                EventActorRole.SOURCE)))),
                        "probe", DemoFixtures.action(
                                "probe", "Probe",
                                DemoFixtures.TRUE_PROFILE, "probe_formula")),
                Map.of(),
                Map.of("ad_buff", DemoFixtures.status(
                        "ad_buff",
                        "AD Buff",
                        StatusKind.ATTRIBUTE_MODIFIER,
                        5000L,
                        StatusRefreshPolicy.REPLACE,
                        null,
                        List.of(new AttrModifierDef("attack_damage",
                                xyz.game.enginev2demo.runtime.AttrModifierMode.FLAT,
                                "attr_mod_formula")))),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.constantFormula("attr_mod_formula", 20.0),
                DemoFixtures.sourceAttrFormula("probe_formula", "attack_damage"),
                DemoFixtures.constantFormula(DemoFixtures.FORMULA_CRIT_MULTIPLIER, 2.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(2),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(
                                new ActionRequest(0, "self", "enemy", "buff_action"),
                                new ActionRequest(1, "self", "enemy", "probe"))));

        // Verify scalar effect log for attr_modifier crit
        ScalarEffectLogEntry attrLog = result.logs().stream()
                .filter(log -> log instanceof ScalarEffectLogEntry)
                .map(log -> (ScalarEffectLogEntry) log)
                .filter(log -> "attr_modifier".equals(log.effectKind()))
                .findFirst()
                .orElseThrow();
        assertTrue(attrLog.isCritical());
        assertEquals(20.0, attrLog.baseValue(), 1e-9);
        assertEquals(40.0, attrLog.finalValue(), 1e-9);

        // attack_damage resolved = 100 (base) + 40 (critted flat) = 140
        // probe reads source attr → deals 140 true damage to enemy
        DamageLogEntry dmg = result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry)
                .map(log -> (DamageLogEntry) log)
                .findFirst()
                .orElseThrow();
        assertEquals(140.0, dmg.dealtDamage(), 1e-9);
        assertEquals(140.0, result.actors().get("self").attributes().get("attack_damage"), 1e-9);
    }
}
