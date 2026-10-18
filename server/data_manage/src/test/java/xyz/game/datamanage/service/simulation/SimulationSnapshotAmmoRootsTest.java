package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.InactiveReason;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Origin;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.PlannedSkill;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SkillSetting;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SkillSource;

class SimulationSnapshotAmmoRootsTest {
    private static final String SPELL = "recharge_spell";
    private SimulationSnapshotFixture fixture;

    @BeforeEach void setUp() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, SPELL);
        fixture.attach("hero_b", ATTACK, SPELL);
        configure(SPELL, "BASIC_ATTACK_HIT", false);
    }

    @ParameterizedTest @ValueSource(strings = {"BASIC_ATTACK_START", "BASIC_ATTACK_HIT", "HIT_LINK_APPLIED", "ATTACK_LINK_APPLIED"})
    void unplannedPureStateActionsAreNotNaturalAttackRootsAndTargetKeepsItsReason(String event) throws Exception {
        configure(SPELL, event, false);
        var result = fixture.service.get(GAME, selection(ATTACK, List.of()));
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(result, "source", SPELL).inactiveReason());
        assertEquals(List.of(), source(result, "source", SPELL).enabledRuleKeys());
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, source(result, "target", SPELL).inactiveReason());
        assertEquals(List.of(), source(result, "target", SPELL).enabledRuleKeys());
        assertTrue(source(result, "source", SPELL).enabled());
        assertTrue(result.skillConfigurations().stream().anyMatch(configuration -> configuration.skill().skillKey().equals(SPELL)));
        assertFalse(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)));
    }

    @Test void sameSkillPlanKeepsTheRefundRootAndActiveRootsInOneActualSource() {
        var result = fixture.service.get(GAME, selection(ATTACK, plans(SPELL)));
        assertNull(source(result, "source", SPELL).inactiveReason());
        assertEquals(List.of("on_used", "refund_on_attack"), source(result, "source", SPELL).enabledRuleKeys());
        assertEquals(1, result.source().skillSources().stream().filter(source -> source.skillKey().equals(SPELL)).count());
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)
            && reference.sourceKey().equals("refund_on_attack") && reference.targetType().equals("STATE") && reference.targetKey().equals("ammo")));
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, source(result, "target", SPELL).inactiveReason());
        assertTrue(source(result, "target", SPELL).enabledRuleKeys().isEmpty());
    }

    @Test void anotherSkillsPlanDoesNotEnableUnusedOwnAmmoOrItsInitialInputs() throws Exception {
        fixture.attach("hero_a", ATTACK, SPELL, "another_spell");
        configure("another_spell", "BASIC_ATTACK_HIT", false);
        var result = fixture.service.get(GAME, selection(ATTACK, plans("another_spell")));
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(result, "source", SPELL).inactiveReason());
        assertTrue(source(result, "source", SPELL).enabledRuleKeys().isEmpty());
        assertFalse(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)));
        assertNull(source(result, "source", "another_spell").inactiveReason());
        assertTrue(source(result, "source", "another_spell").enabledRuleKeys().contains("refund_on_attack"));
    }

    @Test void sameSkillPlanMatchesHostPolicyAcrossActualOriginsWithoutChangingPlanIdentity() throws Exception {
        fixture.equipment("recharge_item", SPELL);
        Selection base = selection(ATTACK, plans(SPELL));
        var result = fixture.service.get(GAME, new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), base.basicAttackLevel(), List.of("recharge_item"), base.targetEquipmentKeys(),
            List.of(), List.of(), base.sourceSkillSettings(), base.targetSkillSettings(), base.plannedSkills()));
        var characterSource = result.source().skillSources().stream().filter(source -> source.skillKey().equals(SPELL)
            && source.origin().equals(Origin.character("hero_a"))).findFirst().orElseThrow();
        var equipmentSource = result.source().skillSources().stream().filter(source -> source.skillKey().equals(SPELL)
            && source.origin().equals(Origin.equipment("recharge_item"))).findFirst().orElseThrow();
        assertTrue(characterSource.enabledRuleKeys().contains("refund_on_attack"));
        assertTrue(equipmentSource.enabledRuleKeys().contains("refund_on_attack"));
        assertEquals(List.of(new PlannedSkill(Origin.character("hero_a"), SPELL, 1, List.of("INITIAL"))), result.selection().plannedSkills());
    }

    @Test void aMixedRuleKeepsItsOtherExecutableActionWithoutAnOwnSkillPlan() throws Exception {
        configure(SPELL, "BASIC_ATTACK_HIT", true);
        var result = fixture.service.get(GAME, selection(ATTACK, List.of()));
        assertNull(source(result, "source", SPELL).inactiveReason());
        assertEquals(List.of("refund_on_attack"), source(result, "source", SPELL).enabledRuleKeys());
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)
            && reference.targetType().equals("EFFECT") && reference.targetKey().equals("hit_heal")));
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)
            && reference.targetType().equals("STATE") && reference.targetKey().equals("ammo")));
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, source(result, "target", SPELL).inactiveReason());
    }

    @Test void unusedRefundDoesNotFollowAMissingInitialRemainingReference() throws Exception {
        var configured = fixture.configurations.get(GAME, SPELL);
        ObjectNode data = fixture.json.valueToTree(configured);
        ObjectNode detail = (ObjectNode) data.path("internalStates").get(0).path("detail");
        detail.set("initialRemainingValue", fixture.json.readTree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"missing_unused_remaining\"}"));
        fixture.configuration(SPELL, 1, data.toString());
        var result = fixture.service.get(GAME, selection(ATTACK, List.of()));
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(result, "source", SPELL).inactiveReason());
        assertTrue(source(result, "source", SPELL).enabledRuleKeys().isEmpty());
        assertFalse(result.references().stream().anyMatch(reference -> reference.targetKey().equals("missing_unused_remaining")));
        assertEquals("missing_unused_remaining", result.skillConfigurations().stream()
            .filter(configuration -> configuration.skill().skillKey().equals(SPELL)).findFirst().orElseThrow()
            .internalStates().getFirst().detail() instanceof xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoDetail ammo
                ? ammo.initialRemainingValue().parameterKey() : null);
    }

    @Test void noBasicAttackDriverDoesNotGainARefundRootEvenWithAnActiveSkillPlan() {
        var result = fixture.service.get(GAME, selection(null, plans(SPELL)));
        assertNull(source(result, "source", SPELL).inactiveReason());
        assertEquals(List.of("on_used"), source(result, "source", SPELL).enabledRuleKeys());
        assertTrue(source(result, "target", SPELL).enabledRuleKeys().isEmpty());
    }

    private void configure(String skillKey, String attackEvent, boolean mixed) throws Exception {
        String extra = mixed ? ", {\"actionKey\":\"heal\",\"actionType\":\"EXECUTE_EFFECT\",\"targetContext\":\"CURRENT_TARGET\",\"detail\":{\"effectKey\":\"hit_heal\"},\"runtimeInputBindings\":[],\"resultModifiers\":[]}" : "";
        fixture.configuration(skillKey, 1, """
            {"internalStates":[{"stateKey":"ammo","stateType":"AMMO","scope":"SKILL","detail":{
               "initialValue":{"kind":"FIXED","value":1},"maxValue":{"kind":"FIXED","value":4},
               "recoveryIntervalValue":{"kind":"FIXED","value":20000},"recoveryMode":"ONE_BY_ONE","recoveryStartCondition":"AFTER_CONSUME"}}],
             "effects":[%s],"processes":[{"processKey":"cast","activationType":"ACTIVE",
               "steps":[{"stepKey":"instant","stepType":"IMMEDIATE","detail":{}}],
               "effectBindings":[{"bindingKey":"heal","effectKey":"hit_heal","moment":{"momentType":"PROCESS_COMPLETE"}}],"stateOperations":[]}],
             "triggerRules":[{"ruleKey":"on_used","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"%s","castPhase":"INITIAL"}},
                "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","targetContext":"CURRENT_TARGET",
                "detail":{"processKey":"cast"},"runtimeInputBindings":[],"resultModifiers":[]}]},
              {"ruleKey":"refund_on_attack","eventSource":{"eventType":"%s","detail":{}},"conditionGroups":[],"actions":[
                {"actionKey":"refund","actionType":"MODIFY_INTERNAL_STATE","targetContext":"EVENT_SOURCE",
                 "detail":{"stateSkillKey":"%s","stateKey":"ammo","operation":"REDUCE_RECOVERY","value":{"kind":"FIXED","value":2000}},
                 "runtimeInputBindings":[],"resultModifiers":[]}%s]}]}
            """.formatted(heal("hit_heal", "{\"kind\":\"FIXED\",\"value\":1}"), skillKey, attackEvent, skillKey, extra));
    }

    private Selection selection(String attack, List<PlannedSkill> plans) {
        var settings = new ArrayList<SkillSetting>();
        settings.add(new SkillSetting(Origin.character("hero_a"), SPELL, true, 1));
        if (plans.stream().anyMatch(plan -> plan.skillKey().equals("another_spell"))) {
            settings.add(new SkillSetting(Origin.character("hero_a"), "another_spell", true, 1));
        }
        return new Selection("hero_a", 1, "hero_b", 2, attack, attack == null ? null : 1, List.of(), List.of(), List.of(), List.of(),
            settings,
            List.of(new SkillSetting(Origin.character("hero_b"), SPELL, true, 1)), plans);
    }

    private static List<PlannedSkill> plans(String skillKey) {
        return List.of(new PlannedSkill(Origin.character("hero_a"), skillKey, 1, List.of("INITIAL")));
    }
    private static SkillSource source(SimulationSnapshotResponse result, String side, String key) {
        return (side.equals("source") ? result.source() : result.target()).skillSources().stream()
            .filter(source -> source.skillKey().equals(key)).findFirst().orElseThrow();
    }
}
