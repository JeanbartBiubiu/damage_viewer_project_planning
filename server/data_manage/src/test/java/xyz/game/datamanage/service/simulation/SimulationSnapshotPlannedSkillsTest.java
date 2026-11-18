package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.damagetype.*;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotPlannedSkillsTest {
    private static final String SPELL = "selected_spell";
    private SimulationSnapshotFixture fixture;

    @BeforeEach
    void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, SPELL);
        active(SPELL);
        when(fixture.damageTypes.get(GAME, "magic")).thenReturn(new DamageTypeResponse(GAME, "magic", "魔法", null,
            DamageTypeStatus.ENABLED, 0, null, null, true));
        when(fixture.damageTypes.getFormula(GAME, "magic")).thenReturn(new DamageTypeFormulaResponse(GAME, "magic",
            xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition("1"), null));
    }

    @Test
    void noAttackBindingIsRequiredAndAPlannedSourceIsMountedOnlyOnceWithItsFullClosure() throws Exception {
        fixture.attach("hero_a", SPELL);
        fixture.attach("hero_b");
        when(fixture.calculationRules.get(GAME)).thenReturn(new xyz.game.datamanage.model.calculation.GameCalculationRulesResponse(
            GAME, "a".repeat(64), xyz.game.datamanage.support.authoring.AggregateJson.tree("""
                {"criticalChanceAttributeKey":null,"criticalMultiplierMin":null,"attackSpeedAttributeKey":null,"attributeDerivations":[],
                 "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
                """)));
        var result = fixture.service.get(GAME, choice(settings(1), plans(1)));
        assertNull(result.selection().basicAttackSkillKey());
        assertNull(result.selection().basicAttackLevel());
        assertEquals(1, result.source().skillSources().size());
        assertEquals(Origin.character("hero_a"), source(result, "source", SPELL).origin());
        assertEquals(List.of("on_hit", "on_used"), source(result, "source", SPELL).enabledRuleKeys());
        assertNull(source(result, "source", SPELL).inactiveReason());
        assertEquals(1, result.skillConfigurations().size());
        assertEquals(1, result.skillConfigurations().getFirst().processes().size());
        assertTrue(result.references().stream().anyMatch(reference -> reference.targetType().equals("PROCESS") && reference.targetKey().equals("cast")));
        assertTrue(result.references().stream().anyMatch(reference -> reference.targetType().equals("FORMULA") && reference.targetKey().equals("damage")));
        assertTrue(result.references().stream().anyMatch(reference -> reference.targetType().equals("PARAMETER") && reference.targetKey().equals("amount")));
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceKey().equals("after_process")));
        assertEquals("magic", result.catalogs().damageTypes().getFirst().type().damageTypeKey());
        assertTrue(result.target().skillSources().isEmpty());
        verify(fixture.configurations).get(GAME, SPELL);
    }

    @Test
    void backgroundAttackRootsDoNotSeedButBothInitializationSidesAndPlannedNaturalRootsRemain() throws Exception {
        fixture.configuration(ATTACK, 2, """
            {"effects":[%s],"triggerRules":[%s,%s,%s,%s]}
            """.formatted(heal("initialize", "{\"kind\":\"FIXED\",\"value\":1}"), initialization("initialize", "initialize"),
                effectRule("attack_start", "BASIC_ATTACK_START", "{}", "missing_start"),
                effectRule("attack_hit", "BASIC_ATTACK_HIT", "{}", "missing_hit"),
                effectRule("attack_received", "BASIC_ATTACK_RECEIVED", "{}", "missing_received")));
        var configured = fixture.configurations.get(GAME, SPELL);
        var data = (com.fasterxml.jackson.databind.node.ObjectNode) fixture.json.valueToTree(configured);
        data.withArray("effects").add(fixture.json.readTree(heal("initialize", "{\"kind\":\"FIXED\",\"value\":1}")));
        data.withArray("triggerRules").add(fixture.json.readTree(initialization("initialize", "initialize")));
        fixture.configuration(SPELL, 2, data.toString());
        var result = fixture.service.get(GAME, choice(settings(1), plans(1)));
        for (String side : List.of("source", "target")) {
            assertEquals(List.of("initialize"), source(result, side, ATTACK).enabledRuleKeys());
            assertNull(source(result, side, ATTACK).inactiveReason());
        }
        assertEquals(List.of("initialize", "on_hit", "on_used"), source(result, "source", SPELL).enabledRuleKeys());
        assertEquals(1, result.source().skillSources().stream().filter(source -> source.skillKey().equals(SPELL)).count());
        assertFalse(result.references().stream().anyMatch(reference -> reference.targetKey().startsWith("missing_")));
        assertEquals(4, result.skillConfigurations().stream().filter(skill -> skill.skill().skillKey().equals(ATTACK)).findFirst().orElseThrow().triggerRules().size());
    }

    @Test
    void noPlanDoesNotPretendAnActiveAuthorTreeIsAnEmptySuccessfulProgram() {
        var result = fixture.service.get(GAME, choice(settings(1), List.of()));
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(result, "source", SPELL).inactiveReason());
        assertTrue(source(result, "source", SPELL).enabledRuleKeys().isEmpty());
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, source(result, "source", ATTACK).inactiveReason());
        assertEquals(2, result.skillConfigurations().size());
        assertTrue(result.references().isEmpty());
        verifyNoInteractions(fixture.damageTypes);
    }

    @Test
    void wrongSideForgedBindingAndOtherOriginNeverGrantAPlannedSkill() {
        assertIssue(choice(settings(1), List.of(new PlannedSkill(Origin.character("hero_b"), SPELL, 1, List.of("INITIAL")))),
            "SOURCE_NOT_SELECTED", "selection.plannedSkills[0].origin");
        assertIssue(choice(settings(1), List.of(new PlannedSkill(Origin.character("hero_a"), "not_attached", 1, List.of("INITIAL")))),
            "SOURCE_NOT_SELECTED", "selection.plannedSkills[0].origin");
        assertIssue(choice(settings(1), List.of(new PlannedSkill(Origin.equipment("item"), SPELL, 1, List.of("INITIAL")))),
            "ENUM_INVALID", "selection.plannedSkills[0].origin.kind");
        verify(fixture.configurations, never()).get(GAME, "not_attached");
    }

    @Test
    void planCannotSupplyOverrideOrIgnoreAFinalSourceGrade() {
        assertIssue(choice(List.of(), plans(1)), "LEVEL_REQUIRED", "selection.plannedSkills[0].skillLevel");
        assertIssue(choice(settings(0), plans(1)), "UNLEARNED", "selection.plannedSkills[0].skillLevel");
        assertIssue(choice(settings(1), plans(0)), "UNLEARNED", "selection.plannedSkills[0].skillLevel");
        assertIssue(choice(settings(1), plans(2)), "LEVEL_MISMATCH", "selection.plannedSkills[0].skillLevel");
        assertIssue(choice(settings(3), plans(3)), "LEVEL_OUT_OF_RANGE", "selection.sourceSkillSettings[0].skillLevel");
    }

    @Test
    void closedAndGloballyDisabledSkillsCannotBeReopenedByThePlan() throws Exception {
        assertIssue(choice(List.of(new SkillSetting(Origin.character("hero_a"), SPELL, false, 1)), plans(1)),
            "SOURCE_DEPENDENCY_INACTIVE", "selection.plannedSkills[0].skillKey");
        fixture.configuration(SPELL, 2, SkillStatus.DISABLED, "{}");
        assertIssue(choice(List.of(), plans(1)), "SKILL_DISABLED", "selection.plannedSkills[0].skillKey");
        var result = fixture.service.get(GAME, choice(List.of(), List.of()));
        assertEquals(InactiveReason.GLOBAL_DISABLED, source(result, "source", SPELL).inactiveReason());
        assertEquals(SkillStatus.DISABLED, result.skillConfigurations().stream().filter(skill -> skill.skill().skillKey().equals(SPELL)).findFirst().orElseThrow().skill().status());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"castPhase\":null}"})
    void missingStoredCastPhaseNeverDefaultsToInitial(String detail) throws Exception {
        fixture.configuration(SPELL, 2, """
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("heal", "{\"kind\":\"FIXED\",\"value\":1}"), effectRule("on_used", "SKILL_USED", detail, "heal")));
        assertIssue(choice(settings(1), plans(1)), "CAST_PHASE_REQUIRED",
            "triggerRules.on_used.eventSource.detail.castPhase");
        var deferred = fixture.service.get(GAME, choice(settings(1), List.of()));
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(deferred, "source", SPELL).inactiveReason());
    }

    @Test
    void aStoredPhaseReadFailureCannotBecomeADefaultInitialRoot() {
        when(fixture.configurations.get(GAME, SPELL)).thenThrow(new IllegalStateException("施放阶段无法解析"));
        assertIssue(choice(settings(1), plans(1)), "INVALID_STORED_DATA", "source.attachedSkills[1].skillKey");
    }

    @Test
    void aMissingInitialRootCannotBeReplacedByARecastHitOrParameters() throws Exception {
        for (String additions : List.of("{}", """
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("heal", "{\"kind\":\"FIXED\",\"value\":1}"),
                effectRule("on_hit", "SKILL_HIT", "{\"sourceSkillKey\":\"selected_spell\"}", "heal")), """
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("heal", "{\"kind\":\"FIXED\",\"value\":1}"),
                effectRule("recast", "SKILL_USED", "{\"sourceSkillKey\":\"selected_spell\",\"castPhase\":\"RECAST\"}", "heal")))) {
            fixture.configuration(SPELL, 2, additions);
            assertIssue(choice(settings(1), plans(1)), "PHASE_ROOT_MISSING", "selection.plannedSkills[0].phaseKinds");
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"sourceSkillKey\":null}", "{\"sourceSkillKey\":\"selected_spell\"}"})
    void everyLegalOwnHitRootIsKeptEvenThoughHitPresetIsNotASnapshotInput(String hitDetail) throws Exception {
        fixture.configuration(SPELL, 2, """
            {"effects":[%s,%s],"triggerRules":[%s,%s]}
            """.formatted(heal("use", "{\"kind\":\"FIXED\",\"value\":1}"),
                heal("hit", "{\"kind\":\"FIXED\",\"value\":2}"),
                effectRule("on_used", "SKILL_USED", "{\"sourceSkillKey\":\"selected_spell\",\"castPhase\":\"INITIAL\"}", "use"),
                effectRule("on_hit", "SKILL_HIT", hitDetail, "hit")));
        var result = fixture.service.get(GAME, choice(settings(1), plans(1)));
        assertEquals(List.of("on_hit", "on_used"), source(result, "source", SPELL).enabledRuleKeys());
        assertTrue(result.references().stream().anyMatch(reference -> reference.targetKey().equals("hit")));
        assertEquals(2, result.skillConfigurations().stream().filter(skill -> skill.skill().skillKey().equals(SPELL)).findFirst().orElseThrow().effects().size());
    }

    @Test
    void plannedDamageReachesOnlyActualDamageOwnersAndRecipientsWithFullDependencies() throws Exception {
        fixture.attach("hero_a", ATTACK, SPELL, "subscriber");
        fixture.attach("hero_b", ATTACK, "subscriber");
        fixture.configuration("subscriber", 1, """
            {"effects":[%s],"triggerRules":[%s,%s,%s,%s,%s]}
            """.formatted(heal("tail", "{\"kind\":\"FIXED\",\"value\":1}"),
                effectRule("on_used", "SKILL_USED", "{\"sourceSkillKey\":\"selected_spell\",\"castPhase\":\"INITIAL\"}", "tail"),
                effectRule("pending", "DAMAGE_PENDING", "{\"sourceSkillKey\":\"selected_spell\",\"damageTypeKey\":\"magic\",\"deliveryKind\":\"ANY\",\"originKind\":\"ANY\"}", "tail"),
                effectRule("dealt", "DAMAGE_DEALT", "{\"sourceSkillKey\":\"selected_spell\",\"deliveryKind\":\"SKILL\",\"originKind\":\"DIRECT\"}", "tail"),
                effectRule("taken", "DAMAGE_TAKEN", "{\"sourceSkillKey\":\"selected_spell\",\"deliveryKind\":\"ANY\",\"originKind\":\"DIRECT\"}", "tail"),
                effectRule("not_basic_damage", "DAMAGE_TAKEN", "{\"deliveryKind\":\"BASIC_ATTACK\"}", "not_reachable")));
        var result = fixture.service.get(GAME, choice(settings(1), plans(1)));
        assertEquals(List.of("dealt", "on_used"), source(result, "source", "subscriber").enabledRuleKeys());
        assertEquals(List.of("pending", "taken"), source(result, "target", "subscriber").enabledRuleKeys());
        assertNull(source(result, "target", "subscriber").inactiveReason());
        assertFalse(result.references().stream().anyMatch(reference -> reference.targetKey().equals("not_reachable")));
        fixture.configuration("subscriber", 1, """
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted("""
                {"effectKey":"tail","results":[{"resultKey":"cooldown","resultType":"COOLDOWN_CHANGE","target":"SOURCE",
                  "valueRule":{"value":{"kind":"FIXED","value":1}},
                  "detail":{"affectedSkillScope":{"mode":"SKILLS","skillKeys":["definition_only"]},"operation":"REDUCE"}}]}
                """,
                effectRule("taken", "DAMAGE_TAKEN", "{\"sourceSkillKey\":\"selected_spell\"}", "tail")));
        fixture.configuration("definition_only", 1, """
            {"parameters":[{"parameterKey":"amount","valueType":"DECIMAL","valueMode":"FIXED","fixedValue":1}],
             "triggerRules":[%s]}
            """.formatted(initialization("not_granted", "missing")));
        var dependency = fixture.service.get(GAME, choice(settings(1), plans(1)));
        assertTrue(dependency.skillConfigurations().stream().anyMatch(skill -> skill.skill().skillKey().equals("definition_only")));
        assertFalse(dependency.source().skillSources().stream().anyMatch(source -> source.skillKey().equals("definition_only")));
        assertFalse(dependency.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals("definition_only")));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void backgroundAttacksDoNotSeedFilteredDamageSubscriptionsWithoutTheirRealProducer(boolean selfDamage) throws Exception {
        fixture.attach("hero_a", ATTACK, SPELL, "closed_spell", "deferred_spell", "subscriber");
        fixture.attach("hero_b", ATTACK, "subscriber");
        active("closed_spell");active("deferred_spell");
        active(SPELL,selfDamage);
        fixture.configuration("subscriber", 1, """
            {"effects":[%s],"triggerRules":[%s,%s,%s,%s,%s,%s]}
            """.formatted(heal("tail", "{\"kind\":\"FIXED\",\"value\":1}"),
                effectRule("real_dealt", "DAMAGE_DEALT", "{\"sourceSkillKey\":\"selected_spell\",\"deliveryKind\":\"SKILL\"}", "tail"),
                effectRule("real_pending", "DAMAGE_PENDING", "{\"sourceSkillKey\":\"selected_spell\",\"deliveryKind\":\"SKILL\"}", "tail"),
                effectRule("real_taken", "DAMAGE_TAKEN", "{\"sourceSkillKey\":\"selected_spell\",\"deliveryKind\":\"SKILL\"}", "tail"),
                effectRule("closed_dealt", "DAMAGE_DEALT", "{\"sourceSkillKey\":\"closed_spell\",\"deliveryKind\":\"SKILL\"}", "tail"),
                effectRule("deferred_dealt", "DAMAGE_DEALT", "{\"sourceSkillKey\":\"deferred_spell\",\"deliveryKind\":\"SKILL\"}", "tail"),
                effectRule("wrong_type", "DAMAGE_DEALT", "{\"sourceSkillKey\":\"selected_spell\",\"damageTypeKey\":\"physical\"}", "tail")));
        var overrides = List.of(new SkillSetting(Origin.character("hero_a"), SPELL, true, 1),
            new SkillSetting(Origin.character("hero_a"), "closed_spell", false, 1),
            new SkillSetting(Origin.character("hero_a"), "deferred_spell", true, 1));
        var base = choice(overrides, plans(1));
        var mixed = new Selection(base.sourceCharacterKey(),base.sourceLevel(),base.targetCharacterKey(),base.targetLevel(),
            ATTACK,1,List.of(),List.of(),List.of(),List.of(),base.sourceSkillSettings(),List.of(),base.plannedSkills());
        var result = fixture.service.get(GAME,mixed);
        assertEquals(selfDamage ? List.of("real_dealt","real_pending","real_taken") : List.of("real_dealt"),
            source(result,"source","subscriber").enabledRuleKeys());
        assertEquals(selfDamage ? List.of() : List.of("real_pending","real_taken"),
            source(result,"target","subscriber").enabledRuleKeys());
    }

    @ParameterizedTest
    @ValueSource(strings = {"closed", "unlearned", "unplanned", "no_damage"})
    void filteredDamageSubscriptionStaysInactiveWhenItsProducerCannotExecuteDamage(String state) throws Exception {
        fixture.attach("hero_a",ATTACK,SPELL,"subscriber");
        fixture.configuration("subscriber",1,"""
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("restore","{\"kind\":\"FIXED\",\"value\":1}"),
                effectRule("dealt","DAMAGE_DEALT","{\"sourceSkillKey\":\"selected_spell\",\"deliveryKind\":\"SKILL\"}","restore")));
        if (state.equals("no_damage")) {
            var body = fixture.json.valueToTree(fixture.configurations.get(GAME,SPELL));
            var result = (com.fasterxml.jackson.databind.node.ObjectNode) body.path("effects").get(0).path("results").get(0);
            result.put("resultType","DIRECT_HEAL").put("target","SOURCE").putObject("detail");
            fixture.configuration(SPELL,2,body.toString());
        }
        var selected = new SkillSetting(Origin.character("hero_a"),SPELL,!state.equals("closed"),state.equals("unlearned")?0:1);
        var actualPlans = state.equals("closed") || state.equals("unlearned") || state.equals("unplanned")
            ? List.<PlannedSkill>of() : plans(1);
        var base = choice(List.of(selected),actualPlans);
        var mixed = new Selection(base.sourceCharacterKey(),base.sourceLevel(),base.targetCharacterKey(),base.targetLevel(),
            ATTACK,1,List.of(),List.of(),List.of(),List.of(),base.sourceSkillSettings(),List.of(),base.plannedSkills());
        var snapshot = fixture.service.get(GAME,mixed);
        assertTrue(source(snapshot,"source","subscriber").enabledRuleKeys().isEmpty());
        assertEquals(InactiveReason.CONFIGURATION_INCOMPLETE,source(snapshot,"source","subscriber").inactiveReason());
        assertFalse(snapshot.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals("subscriber")));
    }

    @Test
    void explicitAttackAndHitLinkResultsRemainReachableWithoutInventingBackgroundAttacks() throws Exception {
        fixture.configuration(SPELL, 2, """
            {"effects":[{"effectKey":"links","results":[
              {"resultKey":"hit_link","resultType":"HIT_LINK_APPLICATION","target":"TARGET","detail":{}},
              {"resultKey":"attack_link","resultType":"ATTACK_LINK_APPLICATION","target":"TARGET","detail":{}}]},%s],
             "triggerRules":[%s,%s,%s,%s]}
            """.formatted(heal("tail", "{\"kind\":\"FIXED\",\"value\":1}"),
                effectRule("on_used", "SKILL_USED", "{\"sourceSkillKey\":\"selected_spell\",\"castPhase\":\"INITIAL\"}", "links"),
                effectRule("hit_link", "HIT_LINK_APPLIED", "{\"sourceSkillKey\":\"selected_spell\"}", "tail"),
                effectRule("attack_link", "ATTACK_LINK_APPLIED", "{\"sourceSkillKey\":\"selected_spell\"}", "tail"),
                effectRule("basic_hit", "BASIC_ATTACK_HIT", "{}", "missing_basic_hit")));
        var result = fixture.service.get(GAME, choice(settings(1), plans(1)));
        assertEquals(List.of("attack_link", "hit_link", "on_used"), source(result, "source", SPELL).enabledRuleKeys());
        assertFalse(result.references().stream().anyMatch(reference -> reference.targetKey().equals("missing_basic_hit")));
    }

    @Test
    void unfilteredEquipmentUseAndHitSubscriptionsStayOpenForAnActualPlanOnly() throws Exception {
        fixture.equipment("item", "subscriber");
        fixture.configuration("subscriber", 1, """
            {"effects":[%s],"triggerRules":[%s,%s]}
            """.formatted(heal("tail", "{\"kind\":\"FIXED\",\"value\":1}"),
                effectRule("on_used", "SKILL_USED", "{\"sourceSkillKey\":null,\"useKind\":\"ANY\",\"castPhase\":\"INITIAL\"}", "tail"),
                effectRule("on_hit", "SKILL_HIT", "{\"sourceSkillKey\":null}", "tail")));
        var base = choice(settings(1), plans(1));
        var selected = new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            null, null, List.of("item"), List.of(), List.of(), List.of(), base.sourceSkillSettings(), List.of(), base.plannedSkills());
        var result = fixture.service.get(GAME, selected);
        assertEquals(List.of("on_hit", "on_used"), source(result, "source", "subscriber").enabledRuleKeys());
        assertNull(source(result, "source", "subscriber").inactiveReason());
        var idle = new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            null, null, List.of("item"), List.of(), List.of(), List.of(), base.sourceSkillSettings(), List.of(), List.of());
        assertTrue(source(fixture.service.get(GAME, idle), "source", "subscriber").enabledRuleKeys().isEmpty());
    }

    @Test
    void aPlannedSkillHitReachesAnotherSkillsOwnPassiveProcess() throws Exception {
        String activeKey = "lab_arc_shot";
        String passiveKey = "lab_deferred_strike";
        fixture.attach("hero_a", activeKey, passiveKey);
        Path scenario = Path.of("../../web/tests/mechanisms/cases/skill_hit_passive_delay_at.json");
        var configurations = fixture.json.readTree(Files.readString(scenario)).required("snapshot").required("skillConfigurations");
        for (var configuration : configurations) {
            String key = configuration.required("skill").required("skillKey").asText();
            if (!List.of(activeKey, passiveKey).contains(key)) continue;
            ObjectNode components = configuration.deepCopy();
            components.remove("skill");
            fixture.configuration(key, 1, components.toString());
        }
        when(fixture.damageTypes.get(GAME, "physics")).thenReturn(new DamageTypeResponse(GAME, "physics", "物理", null,
            DamageTypeStatus.ENABLED, 0, null, null, true));
        when(fixture.damageTypes.getFormula(GAME, "physics")).thenReturn(new DamageTypeFormulaResponse(GAME, "physics",
            xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition("1"), null));
        Origin origin = Origin.character("hero_a");
        var settings = List.of(new SkillSetting(origin, activeKey, true, 1), new SkillSetting(origin, passiveKey, true, 1));
        var plans = List.of(new PlannedSkill(origin, activeKey, 1, List.of("INITIAL")));

        assertEquals(List.of(), fixture.service.get(GAME, choice(settings, List.of())).executionSkillKeys());
        var result = fixture.service.get(GAME, choice(settings, plans));
        assertEquals(List.of(activeKey, passiveKey), result.executionSkillKeys());
        assertNull(source(result, "source", passiveKey).inactiveReason());
        assertTrue(result.references().stream().anyMatch(ref -> ref.sourceSkillKey().equals(passiveKey)
            && ref.sourceKey().equals("schedule") && ref.targetSkillKey().equals(passiveKey)
            && ref.targetType().equals("PROCESS") && ref.targetKey().equals("delayed")));
        assertTrue(result.references().stream().anyMatch(ref -> ref.sourceSkillKey().equals(passiveKey)
            && ref.sourceKey().equals("tail") && ref.targetSkillKey().equals(passiveKey)
            && ref.targetType().equals("EFFECT") && ref.targetKey().equals("tail")));
    }

    @Test
    void aMissingPlannedHitResultRejectsTheWholeSnapshotInsteadOfSilentlyKeepingTheUse() throws Exception {
        fixture.configuration(SPELL, 2, """
            {"effects":[%s],"triggerRules":[%s,%s]}
            """.formatted(heal("use", "{\"kind\":\"FIXED\",\"value\":1}"),
                effectRule("on_used", "SKILL_USED", "{\"sourceSkillKey\":\"selected_spell\",\"castPhase\":\"INITIAL\"}", "use"),
                effectRule("on_hit", "SKILL_HIT", "{\"sourceSkillKey\":\"selected_spell\"}", "missing_hit")));
        assertIssue(choice(settings(1), plans(1)), "REFERENCE_MISSING", "triggerRules.on_hit.actions[0].detail.effectKey");
    }

    @Test
    void anUnplannedSiblingKeepsItsAuthorAndReasonWithoutBecomingARequiredInput() throws Exception {
        fixture.attach("hero_a", ATTACK, SPELL, "other_spell");
        fixture.configuration("other_spell", 5, """
            {"triggerRules":[%s]}
            """.formatted(effectRule("on_used", "SKILL_USED", "{\"sourceSkillKey\":\"other_spell\",\"castPhase\":\"INITIAL\"}", "missing_other")));
        var result = fixture.service.get(GAME, choice(settings(1), plans(1)));
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(result, "source", "other_spell").inactiveReason());
        assertTrue(result.skillConfigurations().stream().anyMatch(skill -> skill.skill().skillKey().equals("other_spell")));
        assertFalse(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals("other_spell")));
    }

    @Test
    void planAndSourceArrayOrderingDoNotChangeDigestButChoicesAndEvenDeferredAuthorsDo() throws Exception {
        fixture.attach("hero_a", ATTACK, SPELL, "another_spell");
        active("another_spell");
        var settings = List.of(new SkillSetting(Origin.character("hero_a"), SPELL, true, 1),
            new SkillSetting(Origin.character("hero_a"), "another_spell", true, 1));
        var plans = List.of(new PlannedSkill(Origin.character("hero_a"), SPELL, 1, List.of("INITIAL")),
            new PlannedSkill(Origin.character("hero_a"), "another_spell", 1, List.of("INITIAL")));
        var result = fixture.service.get(GAME, choice(settings, plans));
        assertEquals(result.snapshotDigest(), fixture.service.get(GAME, choice(settings.reversed(), plans.reversed())).snapshotDigest());
        var one = fixture.service.get(GAME, choice(settings, plans(1)));
        assertNotEquals(result.snapshotDigest(), one.snapshotDigest());
        assertNotEquals(one.snapshotDigest(), fixture.service.get(GAME, choice(settings(2), plans(2))).snapshotDigest());
        fixture.configuration("another_spell", 2, "{}");
        assertNotEquals(one.snapshotDigest(), fixture.service.get(GAME, choice(settings, plans(1))).snapshotDigest());
        var errorChoice = choice(settings, List.of(plans.getFirst(), new PlannedSkill(Origin.character("hero_a"), "another_spell", 2, List.of("INITIAL"))));
        assertIssue(errorChoice, "LEVEL_MISMATCH", "selection.plannedSkills[1].skillLevel");
    }

    @Test
    void backgroundAttackAndPlannedRootsCanCoexistWithoutDuplicatingASource() throws Exception {
        var base = choice(settings(1), plans(1));
        var mixed = new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            ATTACK, 1, List.of(), List.of(), List.of(), List.of(), base.sourceSkillSettings(), List.of(), base.plannedSkills());
        var result = fixture.service.get(GAME, mixed);
        assertEquals(2, result.source().skillSources().size());
        assertEquals(List.of("on_hit", "on_used"), source(result, "source", SPELL).enabledRuleKeys());
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void fullAuthorOccupationChangesSnapshotDigestWithoutMakingMissingDeclarationsInvalid(boolean occupiesAction) throws Exception {
        var baseline = fixture.service.get(GAME, choice(settings(1), plans(1)));
        var baselineAuthor = baseline.skillConfigurations().stream()
            .filter(configuration -> configuration.skill().skillKey().equals(SPELL)).findFirst().orElseThrow();
        assertNull(baselineAuthor.processes().getFirst().steps().getFirst().occupiesAction());
        var data = (com.fasterxml.jackson.databind.node.ObjectNode) fixture.json.valueToTree(baselineAuthor);
        ((com.fasterxml.jackson.databind.node.ObjectNode) data.path("processes").get(0).path("steps").get(0))
            .put("occupiesAction", occupiesAction);
        fixture.configuration(SPELL, 2, data.toString());

        var declared = fixture.service.get(GAME, choice(settings(1), plans(1)));
        var author = declared.skillConfigurations().stream()
            .filter(configuration -> configuration.skill().skillKey().equals(SPELL)).findFirst().orElseThrow();
        assertEquals(occupiesAction, author.processes().getFirst().steps().getFirst().occupiesAction());
        assertNotEquals(baseline.snapshotDigest(), declared.snapshotDigest());
        assertEquals(baselineAuthor.baseDigest(), author.baseDigest());
        assertNull(source(declared, "source", SPELL).inactiveReason());
    }

    @Test
    void explicitHitPhasesRemainInTheCompleteAuthorAndEnabledClosure() throws Exception {
        var baseline = fixture.service.get(GAME, choice(settings(1), plans(1)));
        var oldAuthor = baseline.skillConfigurations().stream().filter(c -> c.skill().skillKey().equals(SPELL)).findFirst().orElseThrow();
        assertFalse(fixture.json.valueToTree(oldAuthor).path("triggerRules").get(1).path("eventSource").path("detail").has("processMoment"));
        var data = stagedAuthor();
        fixture.configuration(SPELL, 2, data.toString());
        var result = fixture.service.get(GAME, choice(settings(1), plans(1)));
        var author = result.skillConfigurations().stream().filter(c -> c.skill().skillKey().equals(SPELL)).findFirst().orElseThrow();
        var phase = author.triggerRules().stream().filter(r -> r.ruleKey().equals("on_hit_later")).findFirst().orElseThrow();
        assertEquals("wait", ((xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail) phase.eventSource().detail()).processMoment().requiresPriorStepKey());
        assertTrue(source(result, "source", SPELL).enabledRuleKeys().containsAll(List.of("on_hit", "on_hit_later", "on_used")));
        assertTrue(result.references().stream().anyMatch(r -> r.sourceKey().equals("on_hit_later")
            && r.fieldPath().equals("eventSource.detail.processMoment.requiresPriorStepKey") && r.targetType().equals("STEP")
            && r.targetKey().equals("cast") && r.targetSubKey().equals("wait")));
        assertNotEquals(baseline.snapshotDigest(), result.snapshotDigest());
    }

    @Test
    void aSnapshotRejectsADependencyWhoseActualHitRuleHasBeenRemoved() throws Exception {
        var data = stagedAuthor();
        ((com.fasterxml.jackson.databind.node.ArrayNode) data.path("triggerRules")).remove(1);
        fixture.configuration(SPELL, 2, data.toString());
        var error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(settings(1), plans(1))));
        assertTrue(error.getDetails().toString().contains("requiresPriorStepKey"));
    }

    @ParameterizedTest @ValueSource(strings = {"missing_prior", "blank_prior", "unknown_phase", "unknown_moment"})
    void malformedStoredPhasesCannotBecomeDefaultsWhenBuildingTheSnapshot(String scenario) throws Exception {
        var data = stagedAuthor();
        var phase = (com.fasterxml.jackson.databind.node.ObjectNode) data.path("triggerRules").get(1).path("eventSource").path("detail").path("processMoment");
        switch (scenario) {
            case "missing_prior" -> phase.remove("requiresPriorStepKey");
            case "blank_prior" -> phase.put("requiresPriorStepKey", " ");
            case "unknown_phase" -> phase.put("unexpected", true);
            case "unknown_moment" -> ((com.fasterxml.jackson.databind.node.ObjectNode) phase.path("moment")).put("unexpected", true);
            default -> fail(scenario);
        }
        fixture.configuration(SPELL, 2, data.toString());
        var error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(settings(1), plans(1))));
        assertTrue(error.getDetails().toString().contains("processMoment"));
    }

    @ParameterizedTest @ValueSource(strings = {"SKILL", "TARGET"})
    void naturalCounterSnapshotReadsRetainTheirOwnedScopeInTheRealClosure(String scope) throws Exception {
        var data = (com.fasterxml.jackson.databind.node.ObjectNode) fixture.json.valueToTree(fixture.configurations.get(GAME, SPELL));
        data.withArray("internalStates").add(fixture.json.readTree("""
            {"stateKey":"counter","stateType":"COUNTER","scope":"%s",
              "detail":{"initialValue":{"kind":"FIXED","value":0},"maxValue":{"kind":"FIXED","value":2}}}
            """.formatted(scope)));
        var rule = (com.fasterxml.jackson.databind.node.ObjectNode) fixture.json.readTree(effectRule("counter_start", "BASIC_ATTACK_START", "{}", "tail"));
        rule.set("conditionGroups", fixture.json.readTree("""
            [{"groupKey":"counter","conditions":[{"conditionKey":"ready","conditionType":"INTERNAL_STATE_CHECK",
              "detail":{"stateSkillKey":"selected_spell","stateKey":"counter","valueKind":"ATTACK_START_VALUE",
                "comparator":"EQ","comparisonValue":{"kind":"FIXED","value":2}}}]}]
            """));
        data.withArray("triggerRules").add(rule);
        fixture.configuration(SPELL, 2, data.toString());
        Selection selection = new Selection("hero_a", 1, "hero_b", 2, ATTACK, 1,
            List.of(), List.of(), List.of(), List.of(), settings(1), List.of(), plans(1));
        if (scope.equals("TARGET")) {
            var error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection));
            assertTrue(error.getDetails().toString().contains("valueKind"));
        } else {
            var result = fixture.service.get(GAME, selection);
            assertTrue(source(result, "source", SPELL).enabledRuleKeys().contains("counter_start"));
            assertTrue(result.references().stream().anyMatch(r -> r.sourceKey().equals("counter_start")
                && r.targetType().equals("STATE") && r.targetKey().equals("counter") && r.targetSkillKey().equals(SPELL)));
            var author = result.skillConfigurations().stream().filter(c -> c.skill().skillKey().equals(SPELL)).findFirst().orElseThrow();
            assertTrue(fixture.json.valueToTree(author).path("triggerRules").toString().contains("ATTACK_START_VALUE"));
        }
    }

    private com.fasterxml.jackson.databind.node.ObjectNode stagedAuthor() throws Exception {
        var configured = fixture.configurations.get(GAME, SPELL);
        var data = (com.fasterxml.jackson.databind.node.ObjectNode) fixture.json.valueToTree(configured);
        var process = (com.fasterxml.jackson.databind.node.ObjectNode) data.path("processes").get(0);
        var first = (com.fasterxml.jackson.databind.node.ObjectNode) process.path("steps").get(0);
        first.put("sortOrder", 10).put("occupiesAction", true);
        var second = first.deepCopy(); second.put("stepKey", "follow").put("sortOrder", 20).put("occupiesAction", false);
        ((com.fasterxml.jackson.databind.node.ObjectNode) second.path("detail").path("delayValue")).put("value", 750);
        ((com.fasterxml.jackson.databind.node.ArrayNode) process.path("steps")).add(second);
        ((com.fasterxml.jackson.databind.node.ObjectNode) data.path("triggerRules").get(0).path("eventSource").path("detail")).put("useKind", "ACTIVE");
        var firstHit = (com.fasterxml.jackson.databind.node.ObjectNode) data.path("triggerRules").get(1);
        ((com.fasterxml.jackson.databind.node.ObjectNode) firstHit.path("eventSource").path("detail")).set("processMoment", fixture.json.readTree("""
            {"processKey":"cast","moment":{"momentType":"STEP_EXECUTION","stepKey":"wait"},"requiresPriorStepKey":null}
            """));
        var later = firstHit.deepCopy(); later.put("ruleKey", "on_hit_later");
        var phase = (com.fasterxml.jackson.databind.node.ObjectNode) later.path("eventSource").path("detail").path("processMoment");
        phase.put("requiresPriorStepKey", "wait");
        ((com.fasterxml.jackson.databind.node.ObjectNode) phase.path("moment")).put("stepKey", "follow");
        ((com.fasterxml.jackson.databind.node.ArrayNode) data.path("triggerRules")).add(later);
        return data;
    }

    private void active(String key) throws Exception {
        active(key,false);
    }

    private void active(String key, boolean selfDamage) throws Exception {
        fixture.configuration(key, 2, """
            {"parameters":[{"parameterKey":"amount","valueType":"DECIMAL","valueMode":"SKILL_LEVEL","levelValues":{"1":10,"2":20}}],
             "formulas":[{"formulaKey":"damage","expression":{"inputs":[{"key":"input_0","binding":{"kind":"parameter","skillKey":"%2$s","parameterKey":"amount"}}],"stages":[{"key":"output","name":"原技能公式输出","expression":{"op":"read","inputKey":"input_0"}}],"outputStageKey":"output"}}],
             "effects":[{"effectKey":"hit","results":[{"resultKey":"damage","resultType":"DAMAGE","target":"TARGET",
               "valueRule":{"value":{"kind":"FORMULA","formulaKey":"damage"},"fixedMultiplier":1},
               "detail":{"damageTypeKey":"magic","deliveryKind":"SKILL","originKind":"DIRECT",
                 "critical":{"mode":"DISALLOWED"},"vampQualification":"UNRESOLVED","vampOverrides":[]}}]},%s],
             "processes":[{"processKey":"cast","activationType":"ACTIVE",
               "cooldown":{"durationValue":{"kind":"FIXED","value":9000},"startMoment":{"momentType":"PROCESS_START"}},
               "steps":[{"stepKey":"wait","stepType":"DELAY","detail":{"delayValue":{"kind":"FIXED","value":250}}}],
               "effectBindings":[],"stateOperations":[]}],
             "triggerRules":[{"ruleKey":"on_used","eventSource":{"eventType":"SKILL_USED",
               "detail":{"sourceSkillKey":"%s","castPhase":"INITIAL"}},"conditionGroups":[],
               "actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"cast"},
                 "runtimeInputBindings":[],"resultModifiers":[]}]},%s,%s]}
            """.formatted(heal("tail", "{\"kind\":\"FIXED\",\"value\":1}"), key,
                effectRule("on_hit", "SKILL_HIT", "{\"sourceSkillKey\":\"" + key + "\"}", "hit"),
                effectRule("after_process", "PROCESS_MOMENT", "{\"processKey\":\"cast\",\"moment\":{\"momentType\":\"PROCESS_COMPLETE\"}}", "tail"))
                .replace("\"target\":\"TARGET\"", selfDamage ? "\"target\":\"SOURCE\"" : "\"target\":\"TARGET\""));
    }

    private Selection choice(List<SkillSetting> settings, List<PlannedSkill> plans) {
        return new Selection("hero_a", 1, "hero_b", 2, null, null, List.of(), List.of(), List.of(), List.of(), settings, List.of(), plans);
    }

    private static List<SkillSetting> settings(int level) {
        return List.of(new SkillSetting(Origin.character("hero_a"), SPELL, true, level));
    }

    private static List<PlannedSkill> plans(int level) {
        return List.of(new PlannedSkill(Origin.character("hero_a"), SPELL, level, List.of("INITIAL")));
    }

    private static SkillSource source(SimulationSnapshotResponse response, String side, String key) {
        return (side.equals("source") ? response.source() : response.target()).skillSources().stream()
            .filter(source -> source.skillKey().equals(key)).findFirst().orElseThrow();
    }

    private void assertIssue(Selection choice, String code, String field) {
        ApiException error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice));
        assertTrue(error.getDetails().toString().contains(code), error.getDetails().toString());
        assertTrue(error.getDetails().toString().contains(field), error.getDetails().toString());
    }

    private static String effectRule(String key, String event, String detail, String effect) {
        return """
            {"ruleKey":"%s","eventSource":{"eventType":"%s","detail":%s},"conditionGroups":[],
             "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET",
               "detail":{"effectKey":"%s"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """.formatted(key, event, detail, effect);
    }
}
