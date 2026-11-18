package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryStatus;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationListResponse;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotSourcesTest {
    private SimulationSnapshotFixture fixture;

    @BeforeEach
    void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
    }

    @Test
    void defaultCollectionKeepsEveryBindingAndNoUnselectedBuildIsRead() throws Exception {
        fixture.attach("hero_a", ATTACK, "unconfigured", "active_only");
        fixture.configuration("unconfigured", 5, "{}");
        fixture.configuration("active_only", 5, activeOnly());
        fixture.equipment("item_a", "item_skill");
        fixture.configuration("item_skill", 1, "{}");
        var result = fixture.service.get(GAME, equipment(List.of("item_a")));
        assertEquals(4, result.source().skillSources().size());
        assertEquals(3, result.source().attachedSkills().size());
        assertEquals(1, row(result, "source", ATTACK).skillLevel());
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, row(result, "target", ATTACK).inactiveReason());
        assertEquals(InactiveReason.CONFIGURATION_INCOMPLETE, row(result, "source", "unconfigured").inactiveReason());
        assertEquals(InactiveReason.ACTIVE_DEFERRED, row(result, "source", "active_only").inactiveReason());
        assertNull(row(result, "source", "active_only").skillLevel());
        assertTrue(row(result, "target", ATTACK).enabledRuleKeys().isEmpty());
        assertEquals(4, result.skillConfigurations().size());
        verify(fixture.configurations).get(GAME, ATTACK);
        verifyNoInteractions(fixture.builds);
    }

    @Test
    void missingRequiredGradeZeroAndExplicitGradeRemainDifferent() throws Exception {
        fixture.attach("hero_a", ATTACK, "scaled_passive");
        fixture.configuration("scaled_passive", 5, scaled());
        var missing = fixture.service.get(GAME, fixture.choice());
        assertNull(row(missing, "source", "scaled_passive").skillLevel());
        assertEquals(InactiveReason.LEVEL_REQUIRED, row(missing, "source", "scaled_passive").inactiveReason());
        assertTrue(row(missing, "source", "scaled_passive").enabledRuleKeys().isEmpty());
        var unlearned = fixture.service.get(GAME, settings(new SkillSetting(Origin.character("hero_a"), "scaled_passive", true, 0)));
        assertEquals(0, row(unlearned, "source", "scaled_passive").skillLevel());
        assertEquals(InactiveReason.UNLEARNED, row(unlearned, "source", "scaled_passive").inactiveReason());
        var learned = fixture.service.get(GAME, settings(new SkillSetting(Origin.character("hero_a"), "scaled_passive", true, 3)));
        assertEquals(3, row(learned, "source", "scaled_passive").skillLevel());
        assertNull(row(learned, "source", "scaled_passive").inactiveReason());
        assertEquals(List.of("initialize"), row(learned, "source", "scaled_passive").enabledRuleKeys());
        assertNotEquals(missing.snapshotDigest(), unlearned.snapshotDigest());
        assertNotEquals(unlearned.snapshotDigest(), learned.snapshotDigest());
    }

    @Test
    void targetAttackOnlyNaturalSourceIsNotMisreportedAsIncompleteAndCannotHideInitialization() throws Exception {
        fixture.attach("hero_a", ATTACK, "attack_only");
        fixture.attach("hero_b", ATTACK, "attack_only");
        String attackRule = """
            {"ruleKey":"on_start","eventSource":{"eventType":"BASIC_ATTACK_START","detail":{}},"conditionGroups":[],
             "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET",
               "detail":{"effectKey":"heal"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """;
        String effects = "\"effects\":[" + heal("heal", "{\"kind\":\"FIXED\",\"value\":1}") + "]";
        fixture.configuration("attack_only", 1, "{" + effects + ",\"triggerRules\":[" + attackRule + "]}");
        var result = fixture.service.get(GAME, fixture.choice());
        assertNull(row(result, "source", "attack_only").inactiveReason());
        assertEquals(List.of("on_start"), row(result, "source", "attack_only").enabledRuleKeys());
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, row(result, "target", "attack_only").inactiveReason());
        assertTrue(row(result, "target", "attack_only").enabled());
        assertTrue(row(result, "target", "attack_only").enabledRuleKeys().isEmpty());
        fixture.configuration("attack_only", 1, "{" + effects + ",\"triggerRules\":[" + attackRule + ","
            + initialization("initialize", "heal") + "]}");
        var initialized = fixture.service.get(GAME, fixture.choice());
        assertNull(row(initialized, "target", "attack_only").inactiveReason());
        assertEquals(List.of("initialize"), row(initialized, "target", "attack_only").enabledRuleKeys());
    }

    @Test
    void unfilteredSkillHitRootsAreKeptForTheActualAttackingSide() throws Exception {
        String hit = """
            {"ruleKey":"own_hit","eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":null}},
             "conditionGroups":[],"actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT",
             "targetContext":"CURRENT_TARGET","detail":{"effectKey":"heal"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """;
        fixture.configuration(ATTACK, 2, "{\"effects\":[" + heal("heal", "{\"kind\":\"FIXED\",\"value\":1}")
            + "],\"triggerRules\":[" + hit + "]}");
        var snapshot = fixture.service.get(GAME, fixture.choice());
        assertEquals(List.of("own_hit"), row(snapshot, "source", ATTACK).enabledRuleKeys());
        assertTrue(row(snapshot, "target", ATTACK).enabledRuleKeys().isEmpty());
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, row(snapshot, "target", ATTACK).inactiveReason());
    }

    @Test
    void bothSidesKeepIndependentGradesWhileSharingOneAuthorTree() throws Exception {
        fixture.attach("hero_a", ATTACK, "scaled_passive");
        fixture.attach("hero_b", ATTACK, "scaled_passive");
        fixture.configuration("scaled_passive", 5, scaled());
        Selection base = fixture.choice();
        Selection selection = new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), base.basicAttackLevel(), List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_a"), "scaled_passive", true, 3)),
            List.of(new SkillSetting(Origin.character("hero_b"), "scaled_passive", true, 2)), List.of());
        var result = fixture.service.get(GAME, selection);
        assertEquals(3, row(result, "source", "scaled_passive").skillLevel());
        assertEquals(2, row(result, "target", "scaled_passive").skillLevel());
        assertNull(row(result, "target", "scaled_passive").inactiveReason());
        verify(fixture.configurations).get(GAME, "scaled_passive");
        assertEquals(1, result.skillConfigurations().stream().filter(configuration -> configuration.skill().skillKey().equals("scaled_passive")).count());
    }

    @Test
    void executionSkillKeysAreSortedAcrossSidesAndDeduplicatedAcrossSources() throws Exception {
        String shared = "z_shared";
        String targetOnly = "a_target";
        fixture.attach("hero_a", ATTACK, shared);
        fixture.attach("hero_b", ATTACK, shared, targetOnly);
        String configuration = """
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("heal", "{\"kind\":\"FIXED\",\"value\":1}"), initialization("initialize", "heal"));
        fixture.configuration(shared, 1, configuration);
        fixture.configuration(targetOnly, 1, configuration);

        var result = fixture.service.get(GAME, fixture.choice());
        assertEquals(List.of(targetOnly, shared), result.executionSkillKeys());
        var targetRelations = fixture.relations.listCharacterRelations(GAME, "hero_b", null);
        when(fixture.relations.listCharacterRelations(GAME, "hero_b", null)).thenReturn(
            new CharacterSkillRelationListResponse(targetRelations.items().reversed(), targetRelations.total()));
        var reordered = fixture.service.get(GAME, fixture.choice());
        assertEquals(result.executionSkillKeys(), reordered.executionSkillKeys());
        assertEquals(result.snapshotDigest(), reordered.snapshotDigest());
    }

    @Test
    void selectedAttackGradeIsNeverOverriddenOrDuplicated() {
        var error = assertThrows(ApiException.class, () -> fixture.service.get(GAME,
            settings(new SkillSetting(Origin.character("hero_a"), ATTACK, true, 2))));
        assertIssue(error, "LEVEL_OVERRIDE_FORBIDDEN");
        Selection base = fixture.choice();
        Selection unlearned = new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), 0, List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        var result = fixture.service.get(GAME, unlearned);
        assertEquals(0, row(result, "source", ATTACK).skillLevel());
        assertEquals(InactiveReason.UNLEARNED, row(result, "source", ATTACK).inactiveReason());
        assertEquals(1, result.source().skillSources().stream().filter(source -> source.skillKey().equals(ATTACK)).count());
    }

    @Test
    void globallyDisabledSourcesStayVisibleButCannotBeReenabledBySettings() throws Exception {
        fixture.attach("hero_a", ATTACK, "disabled");
        fixture.configuration("disabled", 1, SkillStatus.DISABLED, "{}");
        var result = fixture.service.get(GAME, fixture.choice());
        assertEquals(InactiveReason.GLOBAL_DISABLED, row(result, "source", "disabled").inactiveReason());
        assertTrue(row(result, "source", "disabled").enabled());
        assertEquals(2, result.source().attachedSkills().size());
        assertIssue(assertThrows(ApiException.class, () -> fixture.service.get(GAME,
            settings(new SkillSetting(Origin.character("hero_a"), "disabled", true, null)))), "SKILL_DISABLED");
        var closed = fixture.service.get(GAME, settings(new SkillSetting(Origin.character("hero_a"), "disabled", false, null)));
        assertEquals(InactiveReason.GLOBAL_DISABLED, row(closed, "source", "disabled").inactiveReason());
        assertFalse(row(closed, "source", "disabled").enabled());
    }

    @Test
    void disabledCategoryBoundToUsageIsRejectedEvenWhenItsSourceIsInactive() {
        when(fixture.categories.get(GAME, "basic_attack")).thenReturn(new SkillCategoryResponse(GAME, "basic_attack",
            "普通攻击", null, SkillCategoryStatus.DISABLED, 0, null, null));
        var error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, fixture.choice()));
        assertEquals("409.SIMULATION_SNAPSHOT_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("catalogs.calculationRules.configuration.basicAttackCategoryKey"));
        assertTrue(error.getDetails().toString().contains("REFERENCE_DISABLED"));
    }

    @Test
    void disabledUnboundCategoryRemainsVisibleOnInactiveDefinitions() {
        when(fixture.categories.get(GAME, "basic_attack")).thenReturn(new SkillCategoryResponse(GAME, "basic_attack",
            "普通分类", null, SkillCategoryStatus.DISABLED, 0, null, null));
        when(fixture.calculationRules.get(GAME)).thenReturn(new xyz.game.datamanage.model.calculation.GameCalculationRulesResponse(
            GAME, "a".repeat(64), xyz.game.datamanage.support.authoring.AggregateJson.tree("""
                {"criticalChanceAttributeKey":null,"criticalMultiplierMin":null,"attackSpeedAttributeKey":null,"attributeDerivations":[],
                 "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
                """)));
        fixture.attach("hero_a");
        var result = fixture.service.get(GAME, new Selection("hero_a", 1, "hero_b", 2, null, null, List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of()));
        assertEquals(SkillCategoryStatus.DISABLED, result.catalogs().skillCategories().getFirst().status());
        assertEquals(InactiveReason.CONFIGURATION_INCOMPLETE, row(result, "target", ATTACK).inactiveReason());
    }

    @Test
    void sameSkillAtDifferentOriginsCanBeClosedIndependentlyWithoutRemovingFixedAttributes() throws Exception {
        fixture.attach("hero_a", ATTACK, "shared_passive");
        fixture.configuration("shared_passive", 1, constant());
        fixture.equipment("item_a", "shared_passive");
        Selection base = equipment(List.of("item_a"));
        Selection selected = copySettings(base, List.of(new SkillSetting(Origin.character("hero_a"), "shared_passive", false, null)));
        var result = fixture.service.get(GAME, selected);
        var rows = result.source().skillSources().stream().filter(source -> source.skillKey().equals("shared_passive")).toList();
        assertEquals(2, rows.size());
        assertEquals(InactiveReason.SCENE_DISABLED, rows.stream().filter(source -> source.origin().kind().equals("CHARACTER")).findFirst().orElseThrow().inactiveReason());
        assertNull(rows.stream().filter(source -> source.origin().kind().equals("EQUIPMENT")).findFirst().orElseThrow().inactiveReason());
        assertEquals(25, result.source().selectedEquipment().getFirst().attributes().attributeValues().path("health").intValue());
        assertEquals(1, result.source().selectedEquipment().getFirst().attachedSkills().size());
        verify(fixture.configurations).get(GAME, "shared_passive");
        assertIssue(assertThrows(ApiException.class, () -> fixture.service.get(GAME,
            copySettings(base, List.of(new SkillSetting(Origin.equipment("item_a"), "shared_passive", false, 1))))), "LEVEL_OVERRIDE_FORBIDDEN");
    }

    @Test
    void forgedWrongSideAndUnselectedSkillSettingsNeverGrantAnything() {
        for (SkillSetting setting : List.of(new SkillSetting(Origin.character("hero_b"), ATTACK, false, null),
            new SkillSetting(Origin.equipment("item_missing"), ATTACK, false, null),
            new SkillSetting(Origin.character("hero_a"), "not_attached", false, null))) {
            assertIssue(assertThrows(ApiException.class, () -> fixture.service.get(GAME, settings(setting))), "SOURCE_NOT_SELECTED");
        }
        verify(fixture.configurations, never()).get(GAME, "not_attached");
    }

    @Test
    void closedNaturalProgramKeepsCompleteAuthorTreeWithoutReadingItsOutsideDependency() throws Exception {
        fixture.attach("hero_a", ATTACK, "conditional");
        var configuration = fixture.configuration("conditional", 1, """
            {"triggerRules":[{"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},
              "conditionGroups":[{"groupKey":"check","conditions":[{"conditionKey":"outside","conditionType":"INTERNAL_STATE_CHECK",
                "detail":{"stateSkillKey":"not_attached","stateKey":"state","checkKind":"FLAG_ENABLED"}}]}],
              "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE",
                "detail":{"effectKey":"missing"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        var result = fixture.service.get(GAME, settings(new SkillSetting(Origin.character("hero_a"), "conditional", false, null)));
        assertEquals(configuration, result.skillConfigurations().stream().filter(skill -> skill.skill().skillKey().equals("conditional")).findFirst().orElseThrow());
        assertEquals(InactiveReason.SCENE_DISABLED, row(result, "source", "conditional").inactiveReason());
        verify(fixture.configurations, never()).get(GAME, "not_attached");
        assertTrue(result.references().isEmpty());
    }

    @Test
    void pureActiveSiblingDoesNotForceGradesOrRuntimeParameters() throws Exception {
        fixture.attach("hero_a", ATTACK, "active_only");
        fixture.configuration("active_only", 5, activeOnly());
        var result = fixture.service.get(GAME, fixture.choice());
        assertEquals(InactiveReason.ACTIVE_DEFERRED, row(result, "source", "active_only").inactiveReason());
        assertNull(row(result, "source", "active_only").skillLevel());
        assertTrue(result.references().isEmpty());
        verify(fixture.configurations, never()).get(GAME, "active_only_other");
    }

    @Test
    void readOnlySkillDefinitionDependencyIsReturnedWithoutCreatingASourceOrSubscriptions() throws Exception {
        fixture.attach("hero_a", ATTACK, "reactive");
        fixture.configuration("reactive", 1, """
            {"effects":[{"effectKey":"scope","results":[{"resultKey":"definition","resultType":"COOLDOWN_CHANGE","target":"SOURCE",
              "detail":{"operation":"REDUCE","affectedSkillScope":{"mode":"SKILLS","skillKeys":["definition_only"],"skillCategoryKeys":[]}},
              "valueRule":{"value":{"kind":"FIXED","value":1}}}]}],"triggerRules":[%s]}
            """.formatted(initialization("definition_read","scope")));
        fixture.configuration("definition_only", 1, """
            {"triggerRules":[%s]}
            """.formatted(initialization("must_not_run", "missing")));
        var result = fixture.service.get(GAME, fixture.choice());
        assertEquals(3, result.skillConfigurations().size());
        assertFalse(result.source().skillSources().stream().anyMatch(source -> source.skillKey().equals("definition_only")));
        assertFalse(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals("definition_only")));
        assertTrue(result.references().stream().anyMatch(reference -> reference.targetType().equals("SKILL") && reference.targetKey().equals("definition_only")));
    }

    @Test
    void requiredClosedSiblingCannotBeReplacedByAnotherOriginWithTheSameSkill() throws Exception {
        fixture.attach("hero_a", ATTACK, "reactive", "guard");
        fixture.configuration("guard", 1, """
            {"internalStates":[{"stateKey":"state","stateType":"FLAG","scope":"SKILL","detail":{"initialEnabled":false}}]}
            """);
        fixture.equipment("item_a", "guard");
        fixture.configuration("reactive", 1, """
            {"effects":[%s],"triggerRules":[{"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},
              "conditionGroups":[{"groupKey":"check","conditions":[{"conditionKey":"guard","conditionType":"INTERNAL_STATE_CHECK",
                "detail":{"stateSkillKey":"guard","stateKey":"state","checkKind":"FLAG_ENABLED"}}]}],
              "actions":[{"actionKey":"heal","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE","detail":{"effectKey":"heal"},
                "runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """.formatted(heal("heal", "{\"kind\":\"FIXED\",\"value\":1}")));
        assertIssue(assertThrows(ApiException.class, () -> fixture.service.get(GAME, copySettings(equipment(List.of("item_a")),
            List.of(new SkillSetting(Origin.character("hero_a"), "guard", false, null))))), "SOURCE_DEPENDENCY_INACTIVE");
    }

    @Test
    void shieldDependencyReadsDisabledUnlearnedAndNonAttackingDefinitionsWithoutActivatingThem() throws Exception {
        fixture.attach("hero_a", ATTACK, "armor", "barrier");
        fixture.attach("hero_b", ATTACK, "armor", "barrier");
        fixture.configuration("barrier", 1, """
            {"effects":[{"effectKey":"shield","results":[{"resultKey":"barrier","resultType":"NORMAL_SHIELD","target":"SOURCE",
              "valueRule":{"value":{"kind":"FIXED","value":10},"fixedMultiplier":1},"detail":{"absorbedDamageTypeKey":null,"decayMode":"NONE"}}]}],
             "triggerRules":[{"ruleKey":"attack","eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},"conditionGroups":[],
              "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"shield"},"targetContext":"EVENT_SOURCE","runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        fixture.configuration("armor", 1, """
            {"effects":[{"effectKey":"armor","results":[{"resultKey":"bonus","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE",
              "valueRule":{"value":{"kind":"FIXED","value":0.2},"fixedMultiplier":1},
              "detail":{"attributeKey":"bonus_attack_speed_percent","operation":"INCREASE","modifierZoneKey":"bonus_zone",
                "requiredShield":{"skillKey":"barrier","effectKey":"shield","resultKey":"barrier"}}}]}],
             "triggerRules":[%s]}
            """.formatted(initialization("initialize", "armor")));
        for (var setting : List.of(new SkillSetting(Origin.character("hero_a"), "barrier", false, null),
            new SkillSetting(Origin.character("hero_a"), "barrier", true, 0))) {
            var result = fixture.service.get(GAME, settings(setting));
            assertEquals(setting.enabled() ? InactiveReason.UNLEARNED : InactiveReason.SCENE_DISABLED,
                row(result, "source", "barrier").inactiveReason());
            assertTrue(row(result, "source", "barrier").enabledRuleKeys().isEmpty());
            assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, row(result, "target", "barrier").inactiveReason());
            assertNull(row(result, "source", "armor").inactiveReason());
            assertNull(row(result, "target", "armor").inactiveReason());
            assertTrue(result.skillConfigurations().stream().anyMatch(configuration -> configuration.skill().skillKey().equals("barrier")));
            assertTrue(result.references().stream().anyMatch(reference -> reference.fieldPath().endsWith("requiredShield.resultKey")));
        }
    }

    @Test
    void sameSkillShieldDefinitionDoesNotRequireAnUnusedApplicationLevel() throws Exception {
        fixture.attach("hero_a", ATTACK, "fixed_armor");
        fixture.configuration("fixed_armor", 5, """
            {"parameters":[{"parameterKey":"amount","valueType":"DECIMAL","valueMode":"SKILL_LEVEL","levelValues":{"1":10,"2":20,"3":30,"4":40,"5":50}}],
             "effects":[{"effectKey":"armor","results":[{"resultKey":"bonus","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE",
              "valueRule":{"value":{"kind":"FIXED","value":0.2},"fixedMultiplier":1},
              "detail":{"attributeKey":"bonus_attack_speed_percent","operation":"INCREASE","modifierZoneKey":"bonus_zone",
                "requiredShield":{"skillKey":"fixed_armor","effectKey":"unused_shield","resultKey":"barrier"}}}]},
              {"effectKey":"unused_shield","results":[{"resultKey":"barrier","resultType":"NORMAL_SHIELD","target":"SOURCE",
               "valueRule":{"value":{"kind":"PARAMETER","parameterKey":"amount"},"fixedMultiplier":1},"detail":{"absorbedDamageTypeKey":null,"decayMode":"NONE"}}]}],
             "triggerRules":[%s]}
            """.formatted(initialization("initialize", "armor")));
        var result = fixture.service.get(GAME, fixture.choice());
        assertNull(row(result, "source", "fixed_armor").skillLevel());
        assertNull(row(result, "source", "fixed_armor").inactiveReason());
        assertEquals(List.of("initialize"), row(result, "source", "fixed_armor").enabledRuleKeys());
    }

    @Test
    void constantHeroContributionDoesNotImplicitlyAddFixedRatioBindings() throws Exception {
        fixture.attach("hero_a", ATTACK, "speed");
        fixture.configuration("speed", 1, """
            {"effects":[{"effectKey":"speed","results":[{"resultKey":"gain","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE",
              "valueRule":{"value":{"kind":"FIXED","value":0.15},"fixedMultiplier":1},
              "detail":{"attributeKey":"bonus_attack_speed_percent","operation":"INCREASE","modifierZoneKey":"bonus_zone"}}]}],
             "triggerRules":[%s]}
            """.formatted(initialization("initialize", "speed")));
        var result = fixture.service.get(GAME, fixture.choice());
        assertFalse(result.catalogs().attributes().stream().anyMatch(attribute -> attribute.attributeKey().equals("attack_speed_ratio")));
        verify(fixture.attributes, never()).get(GAME, "attack_speed_ratio");
        verify(fixture.attributes, never()).get(GAME, "attack_speed");
        assertFalse(result.source().selectedLevelValues().has("attack_speed_ratio"));
        assertTrue(result.source().selectedEquipment().isEmpty());
        assertNull(row(result, "source", "speed").skillLevel());
        assertNull(row(result, "source", "speed").inactiveReason());
    }

    private Selection settings(SkillSetting setting) {
        return copySettings(fixture.choice(), List.of(setting));
    }

    @Test
    void gradeIssuesUseTheOriginalSettingIndexBeforeCanonicalOrdering() throws Exception {
        fixture.attach("hero_a", ATTACK, "scaled_passive", "earlier");
        fixture.configuration("scaled_passive", 5, scaled());
        fixture.configuration("earlier", 1, "{}");
        var selection = copySettings(fixture.choice(), List.of(
            new SkillSetting(Origin.character("hero_a"), "scaled_passive", true, 6),
            new SkillSetting(Origin.character("hero_a"), "earlier", false, null)));
        ApiException error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection));
        assertIssue(error, "LEVEL_OUT_OF_RANGE");
        assertTrue(error.getDetails().toString().contains("selection.sourceSkillSettings[0].skillLevel"));
    }

    @Test
    void configurationLimitIncludesReadOnlyDefinitionsWithoutDroppingABinding() throws Exception {
        var keys = new java.util.ArrayList<String>();
        keys.add(ATTACK);
        keys.add("reactive");
        for (int index = 0; index < 30; index++) {
            String key = "passive_" + index;
            keys.add(key);
            fixture.configuration(key, 1, "{}");
        }
        fixture.attach("hero_a", keys.toArray(String[]::new));
        fixture.configuration("reactive", 1, """
            {"effects":[{"effectKey":"scope","results":[{"resultKey":"definition","resultType":"COOLDOWN_CHANGE","target":"SOURCE",
              "detail":{"operation":"REDUCE","affectedSkillScope":{"mode":"SKILLS","skillKeys":["definition_only"],"skillCategoryKeys":[]}},
              "valueRule":{"value":{"kind":"FIXED","value":1}}}]}],"triggerRules":[%s]}
            """.formatted(initialization("definition_read","scope")));
        assertIssue(assertThrows(ApiException.class, () -> fixture.service.get(GAME, fixture.choice())), "CONFIGURATION_LIMIT_EXCEEDED");
        verify(fixture.configurations, never()).get(GAME, "definition_only");
        var closed = fixture.service.get(GAME, settings(new SkillSetting(Origin.character("hero_a"), "reactive", false, null)));
        assertEquals(32, closed.skillConfigurations().size());
        assertEquals(32, closed.source().attachedSkills().size());
    }

    @Test
    void nullableResponseFieldsAndTheThreeOriginShapesMatchTheFrozenContract() throws Exception {
        fixture.attach("hero_a", ATTACK, "constant");
        fixture.configuration("constant", 1, constant());
        var result = fixture.service.get(GAME, fixture.choice());
        var data = fixture.json.valueToTree(row(result, "source", "constant"));
        assertTrue(data.has("skillLevel"));
        assertTrue(data.path("skillLevel").isNull());
        assertTrue(data.has("inactiveReason"));
        assertTrue(data.path("inactiveReason").isNull());
        assertEquals(2, fixture.json.valueToTree(Origin.character("hero_a")).size());
        assertEquals(2, fixture.json.valueToTree(Origin.equipment("item_a")).size());
        assertEquals(6, fixture.json.valueToTree(Origin.build("build",
            new xyz.game.datamanage.model.build.BuildConfiguration.OptionSelection("main", "tree", "one", "power", 1))).size());
        assertEquals(8, InactiveReason.values().length);
    }

    private Selection equipment(List<String> keys) {
        Selection base = fixture.choice();
        return new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), base.basicAttackLevel(), keys, List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    }

    private static Selection copySettings(Selection base, List<SkillSetting> settings) {
        return new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), base.basicAttackLevel(), base.sourceEquipmentKeys(), base.targetEquipmentKeys(),
            base.sourceBuildConfigurations(), base.targetBuildConfigurations(), settings, base.targetSkillSettings(), base.plannedSkills());
    }

    private static SkillSource row(SimulationSnapshotResponse result, String side, String key) {
        return (side.equals("source") ? result.source() : result.target()).skillSources().stream()
            .filter(source -> source.skillKey().equals(key)).findFirst().orElseThrow();
    }

    private static void assertIssue(ApiException error, String code) {
        assertEquals("409.SIMULATION_SNAPSHOT_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains(code), error.getDetails().toString());
    }

    private static String scaled() {
        return """
            {"parameters":[{"parameterKey":"amount","valueType":"DECIMAL","valueMode":"SKILL_LEVEL","levelValues":{"1":1,"2":2,"3":3,"4":4,"5":5}}],
             "effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("heal", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"amount\"}"), initialization("initialize", "heal"));
    }

    private static String constant() {
        return """
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("heal", "{\"kind\":\"FIXED\",\"value\":1}"), initialization("initialize", "heal"));
    }

    private static String activeOnly() {
        return """
            {"parameters":[{"parameterKey":"amount","valueType":"DECIMAL","valueMode":"SKILL_LEVEL","levelValues":{}}],
             "effects":[%s],"triggerRules":[{"ruleKey":"active","eventSource":{"eventType":"SKILL_USED",
              "detail":{"sourceSkillKey":"active_only","castPhase":"INITIAL"}},"conditionGroups":[],
              "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"heal"},
                "runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """.formatted(heal("heal", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"amount\"}"));
    }
}
