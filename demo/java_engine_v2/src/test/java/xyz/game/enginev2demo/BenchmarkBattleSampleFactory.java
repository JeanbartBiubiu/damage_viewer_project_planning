package xyz.game.enginev2demo;

import java.util.List;
import java.util.Map;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunInput;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.formula.FormulaNode;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

final class BenchmarkBattleSampleFactory {

    private BenchmarkBattleSampleFactory() {
    }

    static EngineBundle bundle() {
        return DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actorWithResources(
                                "self_template",
                                Map.of(
                                        "max_hp", 1450.0,
                                        "attack_damage", 92.0,
                                        "ability_power", 110.0,
                                        "armor", 38.0,
                                        "magic_resist", 34.0,
                                        "armor_pen_flat", 15.0),
                                Map.of("mana", 220.0),
                                "skill_basic_attack",
                                "skill_mystic_shot",
                                "skill_arcane_shift",
                                "skill_generate_shield",
                                "skill_benchmark_final_kill"),
                        "enemy_template", DemoFixtures.actorWithResources(
                                "enemy_template",
                                Map.of(
                                        "max_hp", 1650.0,
                                        "attack_damage", 88.0,
                                        "ability_power", 45.0,
                                        "armor", 62.0,
                                        "magic_resist", 45.0),
                                Map.of("mana", 120.0),
                                "enemy_basic_attack",
                                "enemy_stun_bolt")),
                Map.of(
                        "skill_basic_attack", DemoFixtures.action(
                                "skill_basic_attack",
                                "Basic Attack",
                                DemoFixtures.PHYSICAL_PROFILE,
                                "formula_basic_attack_damage"),
                        "skill_mystic_shot", DemoFixtures.actionWithConfig(
                                "skill_mystic_shot",
                                "Mystic Shot",
                                DemoFixtures.MAGICAL_PROFILE,
                                "formula_mystic_shot_damage",
                                "formula_mystic_shot_cd",
                                Map.of("mana", 35.0),
                                List.of(),
                                List.of()),
                        "skill_arcane_shift", DemoFixtures.actionWithConfig(
                                "skill_arcane_shift",
                                "Arcane Shift",
                                DemoFixtures.MAGICAL_PROFILE,
                                "formula_arcane_shift_damage",
                                "formula_arcane_shift_cd",
                                Map.of("mana", 45.0),
                                List.of(),
                                List.of()),
                        "skill_generate_shield", DemoFixtures.actionWithConfig(
                                "skill_generate_shield",
                                "Generate Shield",
                                DemoFixtures.TRUE_PROFILE,
                                "formula_zero_damage",
                                "formula_generate_shield_cd",
                                Map.of("mana", 40.0),
                                List.of(),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect(
                                                "status_benchmark_barrier",
                                                EventActorRole.SOURCE,
                                                EventActorRole.SOURCE)))),
                        "skill_benchmark_final_kill", DemoFixtures.actionWithConfig(
                                "skill_benchmark_final_kill",
                                "Benchmark Final Kill",
                                DemoFixtures.TRUE_PROFILE,
                                "formula_benchmark_final_kill",
                                "formula_benchmark_final_kill_cd",
                                Map.of("mana", 60.0),
                                List.of(),
                                List.of()),
                        "enemy_basic_attack", DemoFixtures.action(
                                "enemy_basic_attack",
                                "Enemy Basic Attack",
                                DemoFixtures.PHYSICAL_PROFILE,
                                "formula_enemy_basic_attack_damage"),
                        "enemy_stun_bolt", DemoFixtures.actionWithConfig(
                                "enemy_stun_bolt",
                                "Enemy Stun Bolt",
                                DemoFixtures.TRUE_PROFILE,
                                "formula_zero_damage",
                                "formula_enemy_stun_bolt_cd",
                                Map.of("mana", 20.0),
                                List.of(),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect(
                                                "status_benchmark_stun",
                                                EventActorRole.SOURCE,
                                                EventActorRole.TARGET))))),
                Map.of("item_thorn_armor", DemoFixtures.item(
                        "item_thorn_armor",
                        "Thorn Armor",
                        DemoFixtures.trigger(
                                TriggerType.ON_DAMAGE_TAKEN,
                                EventActorRole.TARGET,
                                true,
                                DemoFixtures.dealDamageEffect(
                                        "thorn_armor_reflect",
                                        "Thorn Armor Reflect",
                                        DemoFixtures.MAGICAL_PROFILE,
                                        "formula_thorn_armor_damage",
                                        EventActorRole.TARGET,
                                        EventActorRole.SOURCE)))),
                Map.of(
                        "status_benchmark_barrier", DemoFixtures.status(
                                "status_benchmark_barrier",
                                "Benchmark Barrier",
                                StatusKind.SHIELD,
                                1500L,
                                StatusRefreshPolicy.TAKE_MAX,
                                "formula_generate_shield_amount"),
                        "status_benchmark_stun", DemoFixtures.status(
                                "status_benchmark_stun",
                                "Benchmark Stun",
                                StatusKind.STUN,
                                300L,
                                StatusRefreshPolicy.REPLACE,
                                null)),
                DemoFixtures.sourceAttrFormula("formula_basic_attack_damage", "attack_damage"),
                DemoFixtures.sourceAttrFormula("formula_enemy_basic_attack_damage", "attack_damage"),
                DemoFixtures.constantFormula("formula_zero_damage", 0.0),
                DemoFixtures.constantFormula("formula_thorn_armor_damage", 25.0),
                DemoFixtures.constantFormula("formula_mystic_shot_cd", 350.0),
                DemoFixtures.constantFormula("formula_arcane_shift_cd", 450.0),
                DemoFixtures.constantFormula("formula_generate_shield_cd", 600.0),
                DemoFixtures.constantFormula("formula_benchmark_final_kill_cd", 1000.0),
                DemoFixtures.constantFormula("formula_enemy_stun_bolt_cd", 700.0),
                DemoFixtures.multiplyFormula(
                        "formula_generate_shield_amount",
                        new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "ability_power"),
                        new FormulaNode.Constant(0.8)),
                DemoFixtures.addFormula(
                        "formula_mystic_shot_damage",
                        new FormulaNode.Multiply(List.of(
                                new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "attack_damage"),
                                new FormulaNode.Constant(0.8))),
                        new FormulaNode.Multiply(List.of(
                                new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "ability_power"),
                                new FormulaNode.Constant(0.35))),
                        new FormulaNode.Constant(40.0)),
                DemoFixtures.addFormula(
                        "formula_arcane_shift_damage",
                        new FormulaNode.Multiply(List.of(
                                new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "ability_power"),
                                new FormulaNode.Constant(0.9))),
                        new FormulaNode.Constant(60.0)),
                DemoFixtures.addFormula(
                        "formula_benchmark_final_kill",
                        new FormulaNode.Multiply(List.of(
                                new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "attack_damage"),
                                new FormulaNode.Constant(1.2))),
                        new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "ability_power"),
                        new FormulaNode.Constant(1120.0)));
    }

    static EngineRunInput runInput() {
        return new EngineRunInput(
                7L,
                new StopCondition(64L),
                DemoFixtures.combatant("self", "self_template", List.of(), List.of()),
                DemoFixtures.combatant("enemy", "enemy_template", List.of("item_thorn_armor"), List.of()),
                List.of(
                        new ActionRequest(0, "self", "enemy", "skill_basic_attack"),
                        new ActionRequest(150, "enemy", "self", "enemy_basic_attack"),
                        new ActionRequest(300, "self", "enemy", "skill_mystic_shot"),
                        new ActionRequest(500, "enemy", "self", "enemy_stun_bolt"),
                        new ActionRequest(900, "self", "enemy", "skill_generate_shield"),
                        new ActionRequest(1000, "enemy", "self", "enemy_basic_attack"),
                        new ActionRequest(1200, "self", "enemy", "skill_arcane_shift"),
                        new ActionRequest(1450, "enemy", "self", "enemy_basic_attack"),
                        new ActionRequest(1600, "self", "enemy", "skill_basic_attack"),
                        new ActionRequest(1900, "self", "enemy", "skill_benchmark_final_kill")));
    }
}
