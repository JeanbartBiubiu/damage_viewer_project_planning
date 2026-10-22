package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;
import static xyz.game.datamanage.support.authoring.TargetTimingAuthoringFixture.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.attribute.*;
import xyz.game.datamanage.model.damagetype.*;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotTargetTimingRootsTest {
    private SimulationSnapshotFixture fixture;
    private ObjectNode timing;

    @BeforeEach void setUp() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, OWNER, DRIVER); fixture.attach("hero_b", ATTACK, OWNER, DRIVER);
        timing = configuration(); save();
        ObjectNode driver = node("""
            {"processes":[{"processKey":"cast","activationType":"ACTIVE","cooldown":null,
             "steps":[{"stepKey":"execute","stepType":"IMMEDIATE","occupiesAction":false,"detail":{}}],"effectBindings":[],"stateOperations":[]}],
             "effects":[],"triggerRules":[
             {"ruleKey":"on_used","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"actual_active","useKind":"ACTIVE","castPhase":"INITIAL"}},"conditionGroups":[],
              "actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"cast"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[],"resultModifiers":[]}]},
             {"ruleKey":"actual_hit","eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"actual_active"}},"conditionGroups":[],
              "actions":[{"actionKey":"hit","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"driver_damage"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        driver.withArray("effects").add(find(configuration(), "effects", "effectKey", "pulse_damage").deepCopy().put("effectKey", "driver_damage").put("skillKey", DRIVER));
        fixture.configuration(DRIVER, 5, driver.toString());
        when(fixture.damageTypes.get(GAME, "magic")).thenReturn(new DamageTypeResponse(GAME, "magic", "魔法", null, DamageTypeStatus.ENABLED, 0, null, null, true));
        when(fixture.damageTypes.getFormula(GAME, "magic")).thenReturn(new DamageTypeFormulaResponse(GAME, "magic", xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition("1"), null));
        when(fixture.attributes.get(GAME, "mana")).thenReturn(new AttributeResponse(GAME, "mana", "法力", AttributeValueType.DECIMAL, BigDecimal.ZERO, null, null, AttributeStatus.ENABLED, 0, null, null));
        when(fixture.attributes.get(GAME, "hp")).thenReturn(new AttributeResponse(GAME, "hp", "生命", AttributeValueType.DECIMAL, BigDecimal.ZERO, null, null, AttributeStatus.ENABLED, 0, null, null));
    }

    private void save() throws Exception { fixture.configuration(OWNER, 1, timing.toString()); }
    private Selection selection(boolean planned) {
        return new Selection("hero_a", 1, "hero_b", 2, ATTACK, 1, List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_a"), OWNER, true, 1), new SkillSetting(Origin.character("hero_a"), DRIVER, true, 1)),
            List.of(new SkillSetting(Origin.character("hero_b"), OWNER, true, 1), new SkillSetting(Origin.character("hero_b"), DRIVER, true, 1)),
            planned ? List.of(new PlannedSkill(Origin.character("hero_a"), DRIVER, 1, List.of("INITIAL"))) : List.of());
    }
    private SkillSource source(SimulationSnapshotResponse response, String side) {
        return (side.equals("source") ? response.source() : response.target()).skillSources().stream().filter(s -> s.skillKey().equals(OWNER)).findFirst().orElseThrow();
    }

    @Test void basicAttacksAloneDoNotLeaveAnIsolatedRefundListenerOrFabricateBurn() {
        var result = fixture.service.get(GAME, selection(false));
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(result, "source").inactiveReason());
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, source(result, "target").inactiveReason());
        assertTrue(source(result, "source").enabled());
        assertTrue(source(result, "source").enabledRuleKeys().isEmpty());
        assertTrue(source(result, "target").enabledRuleKeys().isEmpty());
        assertFalse(result.references().stream().anyMatch(r -> r.sourceSkillKey().equals(OWNER)));
    }

    @Test void realSiblingPlanRetainsAllTimingDeclarationsProductionBodiesAndRefundTail() {
        var result = fixture.service.get(GAME, selection(true));
        assertNull(source(result, "source").inactiveReason());
        assertTrue(source(result, "source").enabledRuleKeys().containsAll(List.of("apply_hit", "refund")));
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, source(result, "target").inactiveReason());
        assertEquals(4, result.references().stream().filter(r -> r.sourceSkillKey().equals(OWNER) && r.fieldPath().equals("detail.targetTiming.processKey")).count());
        assertTrue(result.references().stream().anyMatch(r -> r.sourceSkillKey().equals(OWNER) && r.targetType().equals("PROCESS") && r.targetKey().equals("renew")));
        assertTrue(result.references().stream().anyMatch(r -> r.sourceSkillKey().equals(OWNER) && r.targetType().equals("EFFECT") && r.targetKey().equals("burst_damage")));
    }

    @Test void malformedDeclaredGraphIsRejectedBeforeAnUnplannedSourceCouldBeDeferred() throws Exception {
        ((ObjectNode) find(timing, "internalStates", "stateKey", "slot_1").path("detail").path("targetTiming")).put("processKey", "missing"); save();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection(false)));
    }

    @Test void aSecondTickLeafCannotBeHiddenByNoPlanDormancy() throws Exception {
        ObjectNode pulse = find(timing, "processes", "processKey", "pulse"); pulse.withArray("effectBindings").add(pulse.path("effectBindings").get(0).deepCopy()); save();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection(false)));
    }

    @Test void missingOrdinaryHitProcessIsRejectedBeforeAnOtherwiseValidGraphCanBecomeDormant() throws Exception {
        ((ObjectNode) find(timing, "triggerRules", "ruleKey", "apply_hit").path("actions").get(0).path("detail"))
            .put("processKey", "missing_process");
        save();
        var error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection(false)));
        assertTrue(error.getDetails().toString().contains("missing_process") || error.getDetails().toString().contains("processKey"));
    }

    @Test void missingNestedOrdinaryHitEffectIsAlsoRejectedBeforeDormancy() throws Exception {
        ObjectNode apply = find(timing, "processes", "processKey", "apply");
        ObjectNode binding = (ObjectNode) find(timing, "processes", "processKey", "pulse").path("effectBindings").get(0).deepCopy();
        binding.put("effectKey", "missing_effect"); apply.withArray("effectBindings").add(binding);
        save();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection(false)));
    }

    @Test void independentNaturalRootIsPreservedInsteadOfApplyingWholeGraphDormancy() throws Exception {
        ObjectNode independent = node("""
            {"ruleKey":"independent","name":"独立初始化","sortOrder":9,"eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],
             "actions":[{"actionKey":"restore","actionType":"EXECUTE_EFFECT","sortOrder":0,"targetContext":"EVENT_SOURCE","detail":{"effectKey":"mana"},"runtimeInputBindings":[],"resultModifiers":[]}],
             "oncePerUse":null,"perTargetCooldown":null,"maxTriggersPerProcess":null}
            """);
        timing.withArray("triggerRules").add(independent); save();
        var result = fixture.service.get(GAME, selection(false));
        assertNull(source(result, "source").inactiveReason());
        assertTrue(source(result, "source").enabledRuleKeys().contains("independent"));
    }

    @Test void independentDamageDealtRecoveryIsNotMistakenForTheTimingKillTail() throws Exception {
        actualBackgroundDamage();
        ObjectNode independent = find(timing, "triggerRules", "ruleKey", "refund").deepCopy().put("ruleKey", "independent_damage");
        independent.putArray("conditionGroups"); timing.withArray("triggerRules").add(independent); save();
        var result = fixture.service.get(GAME, selection(false));
        assertNull(source(result, "source").inactiveReason());
        assertTrue(source(result, "source").enabledRuleKeys().contains("independent_damage"));
    }

    @Test void readingAPreDamageValueAloneDoesNotAuthorizeHidingAnIndependentNonKillRoot() throws Exception {
        actualBackgroundDamage();
        ObjectNode independent = find(timing, "triggerRules", "ruleKey", "refund").deepCopy().put("ruleKey", "independent_before");
        ((com.fasterxml.jackson.databind.node.ArrayNode) independent.path("conditionGroups").get(0).path("conditions")).remove(1);
        timing.withArray("triggerRules").add(independent); save();
        var result = fixture.service.get(GAME, selection(false));
        assertNull(source(result, "source").inactiveReason());
        assertTrue(source(result, "source").enabledRuleKeys().contains("independent_before"));
    }

    @Test void anUnplannedScenePreservesARealBackgroundAttackFirstKillRefundInsteadOfDeferringItAsBurn() throws Exception {
        actualBackgroundDamage();
        ObjectNode refund = find(timing, "triggerRules", "ruleKey", "refund");
        ((ObjectNode) refund.path("eventSource").path("detail")).put("sourceSkillKey", ATTACK);
        ((ObjectNode) refund.path("conditionGroups").get(0).path("conditions").get(0).path("detail")).put("comparator", "EQ");
        save();
        var result = fixture.service.get(GAME, selection(false));
        assertNull(source(result, "source").inactiveReason());
        assertTrue(source(result, "source").enabledRuleKeys().contains("refund"));
        assertFalse(source(result, "source").enabledRuleKeys().contains("apply_hit"));
        assertTrue(result.references().stream().anyMatch(r -> r.sourceSkillKey().equals(OWNER) && r.targetKey().equals("mana")));
    }

    private void actualBackgroundDamage() throws Exception {
        fixture.configuration(ATTACK,1,"""
            {"effects":[{"effectKey":"attack","results":[{"resultKey":"damage","resultType":"DAMAGE","target":"TARGET",
              "detail":{"damageTypeKey":"magic","deliveryKind":"BASIC_ATTACK","originKind":"DIRECT","critical":{"mode":"DISALLOWED"},"vampQualification":"UNRESOLVED","vampOverrides":[]},
              "valueRule":{"value":{"kind":"FIXED","value":10}}}]}],
             "triggerRules":[{"ruleKey":"hit","eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},"conditionGroups":[],
              "actions":[{"actionKey":"damage","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"attack"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
    }

    @ParameterizedTest @ValueSource(strings = {"slot_1", "pending"})
    void oldEnsureOnEitherTimingAnchorCannotBeHiddenByAnUnplannedSnapshot(String key) throws Exception {
        ObjectNode rule = find(timing, "triggerRules", "ruleKey", "apply_hit");
        ObjectNode action = (ObjectNode) rule.path("actions").get(1).deepCopy();
        ((ObjectNode) action.path("detail")).put("operation", "ENSURE_REMAINING").put("stateKey", key);
        rule.putArray("actions").add(action); rule.putArray("conditionGroups");
        rule.set("eventSource", node("{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"actual_active\",\"useKind\":\"ACTIVE\",\"castPhase\":\"INITIAL\"}}"));
        save();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection(false)));
    }

    @Test void anotherPlannedSkillDoesNotAuthorizeTheDeclaredHitSource() throws Exception {
        String other = "other_active";
        fixture.attach("hero_a", ATTACK, OWNER, DRIVER, other);
        fixture.configuration(other, 1, """
            {"processes":[{"processKey":"cast","activationType":"ACTIVE","cooldown":null,
             "steps":[{"stepKey":"instant","stepType":"IMMEDIATE","occupiesAction":false,"detail":{}}],"effectBindings":[],"stateOperations":[]}],
             "triggerRules":[{"ruleKey":"on_used","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"other_active","useKind":"ACTIVE","castPhase":"INITIAL"}},"conditionGroups":[],
             "actions":[{"actionKey":"cast","actionType":"START_PROCESS","detail":{"processKey":"cast"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        Selection base = selection(false);
        var sourceSettings = new java.util.ArrayList<>(base.sourceSkillSettings());
        sourceSettings.add(new SkillSetting(Origin.character("hero_a"), other, true, 1));
        var choice = new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(), base.basicAttackSkillKey(), base.basicAttackLevel(),
            base.sourceEquipmentKeys(), base.targetEquipmentKeys(), base.sourceBuildConfigurations(), base.targetBuildConfigurations(), sourceSettings, base.targetSkillSettings(),
            List.of(new PlannedSkill(Origin.character("hero_a"), other, 1, List.of("INITIAL"))));
        var result = fixture.service.get(GAME, choice);
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(result, "source").inactiveReason());
        assertTrue(source(result, "source").enabledRuleKeys().isEmpty());
    }

    @Test void disabledOrUnlearnedTimingSourceKeepsTheOldSceneGates() {
        Selection base = selection(true);
        for (boolean disabled : List.of(true, false)) {
            var settings = List.of(new SkillSetting(Origin.character("hero_a"), OWNER, !disabled, disabled ? 1 : 0), new SkillSetting(Origin.character("hero_a"), DRIVER, true, 1));
            var choice = new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(), base.basicAttackSkillKey(), base.basicAttackLevel(),
                base.sourceEquipmentKeys(), base.targetEquipmentKeys(), base.sourceBuildConfigurations(), base.targetBuildConfigurations(), settings, base.targetSkillSettings(), base.plannedSkills());
            var result = fixture.service.get(GAME, choice);
            assertEquals(disabled ? InactiveReason.SCENE_DISABLED : InactiveReason.UNLEARNED, source(result, "source").inactiveReason());
            assertTrue(source(result, "source").enabledRuleKeys().isEmpty());
            assertFalse(result.references().stream().anyMatch(r -> r.sourceSkillKey().equals(OWNER)));
        }
    }
}
