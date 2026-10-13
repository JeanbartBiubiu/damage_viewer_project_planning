package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import java.math.BigDecimal;
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
    void plannedDamageReachesBothSidesReceivingTailsAndTheirFullReadOnlyDependencies() throws Exception {
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
        assertEquals(List.of("dealt", "on_used", "pending", "taken"), source(result, "source", "subscriber").enabledRuleKeys());
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

    private void active(String key) throws Exception {
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
                effectRule("after_process", "PROCESS_MOMENT", "{\"processKey\":\"cast\",\"moment\":{\"momentType\":\"PROCESS_COMPLETE\"}}", "tail")));
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
