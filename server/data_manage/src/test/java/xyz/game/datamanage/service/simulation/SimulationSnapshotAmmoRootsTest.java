package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.math.BigDecimal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.attribute.AttributeValueType;
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

    @Test void unplannedPureOwnCooldownReductionDoesNotBecomeAnAttackRoot() throws Exception {
        configureCooldown(false);
        var result = fixture.service.get(GAME, selection(ATTACK, List.of()));
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(result, "source", SPELL).inactiveReason());
        assertTrue(source(result, "source", SPELL).enabledRuleKeys().isEmpty());
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, source(result, "target", SPELL).inactiveReason());
        assertFalse(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)));
    }

    @Test void plannedOwnCooldownReductionKeepsItsRealAttackRoot() throws Exception {
        configureCooldown(false);
        var result = fixture.service.get(GAME, selection(ATTACK, plans(SPELL)));
        assertNull(source(result, "source", SPELL).inactiveReason());
        assertEquals(List.of("on_used", "refund_on_attack"), source(result, "source", SPELL).enabledRuleKeys());
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)
            && reference.targetType().equals("EFFECT") && reference.targetKey().equals("reduce_own")));
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, source(result, "target", SPELL).inactiveReason());
    }

    @Test void mixedOwnCooldownRuleDoesNotHideItsOtherEffectWhenUnplanned() throws Exception {
        configureCooldown(true);
        var result = fixture.service.get(GAME, selection(ATTACK, List.of()));
        assertNull(source(result, "source", SPELL).inactiveReason());
        assertEquals(List.of("refund_on_attack"), source(result, "source", SPELL).enabledRuleKeys());
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)
            && reference.targetType().equals("EFFECT") && reference.targetKey().equals("hit_heal")));
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)
            && reference.targetType().equals("EFFECT") && reference.targetKey().equals("reduce_own")));
    }

    @Test void cooldownMaintenanceNeedsABasicAttackDriverEvenWhenPlanned() throws Exception {
        configureCooldown(false);
        var result = fixture.service.get(GAME, selection(null, plans(SPELL)));
        assertEquals(List.of("on_used"), source(result, "source", SPELL).enabledRuleKeys());
        assertTrue(source(result, "target", SPELL).enabledRuleKeys().isEmpty());
    }

    private void configureCooldown(boolean mixed) throws Exception {
        ObjectNode data = fixture.json.valueToTree(fixture.configurations.get(GAME, SPELL));
        var effects = (com.fasterxml.jackson.databind.node.ArrayNode) data.path("effects");
        effects.add(fixture.json.readTree("""
            {"effectKey":"reduce_own","name":"减少自身冷却","lifecycle":null,"results":[{
              "resultKey":"remaining","resultType":"COOLDOWN_CHANGE","target":"SOURCE",
              "lifecycleBehavior":null,"spellShieldBlockScope":null,
              "valueRule":{"value":{"kind":"FIXED","value":1000},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
              "detail":{"operation":"REDUCE","affectedSkillScope":{"mode":"SKILLS","skillKeys":["recharge_spell"],"skillCategoryKeys":[]}}}]}
            """));
        ObjectNode refund = (ObjectNode) data.path("triggerRules").get(1);
        var actions = refund.putArray("actions");
        actions.add(fixture.json.readTree("""
            {"actionKey":"reduce","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"reduce_own"},
             "runtimeInputBindings":[],"resultModifiers":[]}
            """));
        if (mixed) actions.add(fixture.json.readTree("""
            {"actionKey":"heal","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"hit_heal"},
             "runtimeInputBindings":[],"resultModifiers":[]}
            """));
        fixture.configuration(SPELL, 1, data.toString());
    }

    @ParameterizedTest @ValueSource(strings = {"with_attack", "without_attack"})
    void unplannedOwnDurationMaintenanceKeepsInitializationWhileSiblingIsPlanned(String mode) throws Exception {
        fixture.attach("hero_a", ATTACK, SPELL, "another_spell");
        configure("another_spell", "BASIC_ATTACK_HIT", false);
        configureDuration(false);
        var result = fixture.service.get(GAME, selection(mode.equals("with_attack") ? ATTACK : null, plans("another_spell")));
        assertNull(source(result, "source", SPELL).inactiveReason());
        assertEquals(List.of("initialize"), source(result, "source", SPELL).enabledRuleKeys());
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL) && reference.targetKey().equals("passive")));
        assertFalse(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)
            && List.of("maintain", "window").contains(reference.targetKey())));
    }

    @Test void mixedUnplannedDurationMaintenanceIsPreservedForHostRejection() throws Exception {
        configureDuration(true);
        var result = fixture.service.get(GAME, selection(ATTACK, List.of()));
        assertEquals(List.of("ensure_on_attack", "initialize"), source(result, "source", SPELL).enabledRuleKeys());
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL) && reference.targetKey().equals("maintain")));
    }

    private void configureDuration(boolean mixed) throws Exception {
        when(fixture.attributes.get(GAME, "armor")).thenReturn(new AttributeResponse(GAME, "armor", "护甲", AttributeValueType.DECIMAL,
            BigDecimal.ZERO, null, null, AttributeStatus.ENABLED, 0, null, null));
        fixture.configuration(SPELL, 1, """
            {"internalStates":[],"effects":[
             {"effectKey":"passive","name":"初始化双抗","lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},
               "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE","reapplicationStackMode":"KEEP",
               "reapplicationDurationMode":null,"expiryMode":"EXPLICIT_ONLY","periodicIntervalValue":null,"firstPeriodicExecution":null},
              "results":[{"resultKey":"armor","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE","spellShieldBlockScope":null,
                "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED","reapplicationValueMode":"REPLACE","periodicExecutionMode":null},
                "valueRule":{"value":{"kind":"FIXED","value":10},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
                "detail":{"attributeKey":"armor","operation":"INCREASE","modifierZoneKey":"bonus_zone"}}]},
             {"effectKey":"window","name":"有限攻击力","lifecycle":{"durationValue":{"kind":"FIXED","value":3000},"maxStacksValue":{"kind":"FIXED","value":1},
               "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE","reapplicationStackMode":"KEEP","reapplicationDurationMode":"REFRESH_ALL",
               "expiryMode":"ALL_AT_ONCE","periodicIntervalValue":null,"firstPeriodicExecution":null},"results":[]},
             {"effectKey":"maintain","name":"保持余时","lifecycle":null,"results":[{"resultKey":"ensure","resultType":"LIFECYCLE_OPERATION","target":"SOURCE",
                "lifecycleBehavior":null,"spellShieldBlockScope":null,"valueRule":{"value":{"kind":"FIXED","value":2500},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
                "detail":{"operation":"ENSURE_REMAINING","targetEffectKey":"window"}}]},%s],
             "processes":[{"processKey":"cast","activationType":"ACTIVE","steps":[{"stepKey":"instant","stepType":"IMMEDIATE","detail":{}}],
               "effectBindings":[{"bindingKey":"window","effectKey":"window","moment":{"momentType":"PROCESS_START"}}],"stateOperations":[]}],
             "triggerRules":[
              {"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],"actions":[
                {"actionKey":"passive","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE","detail":{"effectKey":"passive"},"runtimeInputBindings":[],"resultModifiers":[]}]},
              {"ruleKey":"on_used","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"recharge_spell","castPhase":"INITIAL"}},"conditionGroups":[],"actions":[
                {"actionKey":"start","actionType":"START_PROCESS","targetContext":"CURRENT_TARGET","detail":{"processKey":"cast"},"runtimeInputBindings":[],"resultModifiers":[]}]},
              {"ruleKey":"ensure_on_attack","eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},"conditionGroups":[],"actions":[
                {"actionKey":"ensure","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"maintain"},"runtimeInputBindings":[],"resultModifiers":[]}%s]},
              {"ruleKey":"ensure_on_sibling","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"another_spell","castPhase":"INITIAL"}},"conditionGroups":[],"actions":[
                {"actionKey":"ensure","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"maintain"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """.formatted(heal("hit_heal", "{\"kind\":\"FIXED\",\"value\":1}"), mixed ? """
                ,{"actionKey":"other","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"hit_heal"},"runtimeInputBindings":[],"resultModifiers":[]}
                """ : ""));
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
