package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.formula.FormulaDefinition;
import xyz.game.enginev2demo.formula.FormulaNode;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;
import xyz.game.enginev2demo.pipeline.DamageProfileTemplate;

class DamageProfileFormulaRoutingTest {

    @Test
    void customDamageProfileUsesConfiguredFormulasInsteadOfHardcodedTypeBranch() {
        String customProfileId = "profile_quarter_damage";
        String actionFormulaId = "quarter_damage_action";
        String effectiveResistanceFormulaId = "quarter_damage_effective_resistance";
        String mitigationFormulaId = "quarter_damage_mitigation";

        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 500.0, "armor_pen_flat", 999.0),
                                "custom_bolt"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 300.0, "armor", 500.0, "magic_resist", 500.0))),
                Map.of("custom_bolt", DemoFixtures.action(
                        "custom_bolt",
                        "Custom Bolt",
                        customProfileId,
                        actionFormulaId)),
                Map.of(customProfileId, new DamageProfileTemplate(
                        customProfileId,
                        effectiveResistanceFormulaId,
                        mitigationFormulaId)),
                DemoFixtures.constantFormula(actionFormulaId, 200.0),
                DemoFixtures.constantFormula(effectiveResistanceFormulaId, 7.0),
                new FormulaDefinition(mitigationFormulaId, new FormulaNode.Constant(0.25)));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "custom_bolt"))));

        assertEquals(250.0, result.actors().get("enemy").currentHp(), 1e-9);
        DamageLogEntry damageLog = assertInstanceOf(DamageLogEntry.class, result.logs().get(1));
        assertEquals(customProfileId, damageLog.damageProfileId());
        assertEquals(7.0, damageLog.effectiveResistance(), 1e-9);
        assertEquals(0.25, damageLog.mitigationMultiplier(), 1e-9);
        assertEquals(50.0, damageLog.dealtDamage(), 1e-9);
    }
}
