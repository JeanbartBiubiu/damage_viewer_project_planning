package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import static xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.mapper.equipment.EquipmentMapper;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.character.CharacterAttributesResponse;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.damagetype.*;
import xyz.game.datamanage.model.equipment.EquipmentAttributesResponse;
import xyz.game.datamanage.model.equipment.EquipmentResponse;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.model.gamevamp.GameVampRule;
import xyz.game.datamanage.model.modifierzone.*;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryStatus;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillinternalstate.*;
import xyz.game.datamanage.model.skilleffect.*;
import xyz.game.datamanage.model.skillformula.*;
import xyz.game.datamanage.model.skillparameter.*;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.status.*;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;
import xyz.game.datamanage.service.attribute.AttributeService;
import xyz.game.datamanage.service.build.BuildSystemService;
import xyz.game.datamanage.service.character.CharacterService;
import xyz.game.datamanage.service.damagetype.DamageTypeService;
import xyz.game.datamanage.service.equipment.EquipmentService;
import xyz.game.datamanage.service.gamevamp.GameVampRuleService;
import xyz.game.datamanage.service.calculation.GameCalculationRuleService;
import xyz.game.datamanage.model.calculation.GameCalculationRulesResponse;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.service.modifierzone.ModifierZoneService;
import xyz.game.datamanage.service.skillcategory.SkillCategoryService;
import xyz.game.datamanage.service.skillconfiguration.SkillConfigurationService;
import xyz.game.datamanage.service.skillrelation.SkillRelationService;
import xyz.game.datamanage.service.status.StatusService;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotServiceTest {
    private static final Selection CHOICE = new Selection("hero_a", 1, "hero_b", 1,
        "shared_basic_attack", 1, List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());

    private final CharacterService characters = mock(CharacterService.class);
    private final CharacterMapper characterMapper = mock(CharacterMapper.class);
    private final EquipmentService equipment = mock(EquipmentService.class);
    private final EquipmentMapper equipmentMapper = mock(EquipmentMapper.class);
    private final SkillRelationService relations = mock(SkillRelationService.class);
    private final SkillConfigurationService configurations = mock(SkillConfigurationService.class);
    private final AttributeService attributes = mock(AttributeService.class);
    private final SkillCategoryService categories = mock(SkillCategoryService.class);
    private final DamageTypeService damageTypes = mock(DamageTypeService.class);
    private final ModifierZoneService zones = mock(ModifierZoneService.class);
    private final StatusService statuses = mock(StatusService.class);
    private final GameVampRuleService vampRules = mock(GameVampRuleService.class);
    private final GameCalculationRuleService calculationRules = mock(GameCalculationRuleService.class);
    private final BuildSystemService builds = mock(BuildSystemService.class);
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private SimulationSnapshotService service;
    private SkillConfigurationResponse skill;

    @BeforeEach
    void setup() throws Exception {
        service = new SimulationSnapshotService(characters, characterMapper, equipment, equipmentMapper, relations,
            configurations, attributes, categories, damageTypes, zones, statuses, vampRules, calculationRules, builds, json);
        when(calculationRules.get("lol")).thenReturn(new GameCalculationRulesResponse("lol", "a".repeat(64), AggregateJson.tree("""
            {"criticalChanceAttributeKey":null,"criticalMultiplierMin":null,"attackSpeedAttributeKey":null,"attributeDerivations":[],
             "basicAttackCategoryKey":"basic_attack","equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
            """)));
        when(characters.getLevelConfig("lol")).thenReturn(new LevelConfigResponse("lol", 1, 18));
        for (String key : List.of("hero_a", "hero_b")) {
            String raw = key.equals("hero_a")
                ? "{\"1\":{\"attack_damage\":100,\"health\":500}}"
                : "{\"1\":{\"armor\":0,\"health\":250}}";
            when(characters.get("lol", key)).thenReturn(new CharacterResponse("lol", key, key, null, null, null));
            when(characters.getAttributes("lol", key)).thenReturn(
                new CharacterAttributesResponse(key, 1, 18, json.readTree(raw)));
            when(characterMapper.findLevelValuesJson("lol", key)).thenReturn(raw);
            when(relations.listCharacterRelations("lol", key, null)).thenReturn(
                new CharacterSkillRelationListResponse(key.equals("hero_a")
                    ? List.of(new CharacterSkillRelationResponse("lol", key, key,
                        "shared_basic_attack", "普通攻击·共享", SkillStatus.ENABLED, 0))
                    : List.of(), key.equals("hero_a") ? 1 : 0));
        }
        skill = new SkillConfigurationResponse(new SkillResponse("lol", "shared_basic_attack", "普通攻击·共享",
            null, 1, SkillStatus.ENABLED, 0, List.of("basic_attack"), null, null),
            List.of(), List.of(formula("amount", "attack_damage")),
            List.of(effect(new SkillEffectCriticalPolicy(SkillEffectCriticalMode.DISALLOWED, null), "amount")),
            List.of(), List.of(), List.of(trigger("attack_hit")), "skill-digest");
        when(configurations.get("lol", "shared_basic_attack")).thenReturn(skill);
        when(vampRules.get("lol")).thenReturn(new GameVampRules(List.of()));
        when(categories.get("lol", "basic_attack")).thenReturn(new SkillCategoryResponse(
            "lol", "basic_attack", "普攻", null, SkillCategoryStatus.ENABLED, 0, null, null));
        for (String key : List.of("attack_damage", "armor", "health")) {
            when(attributes.get("lol", key)).thenReturn(new AttributeResponse("lol", key, key,
                AttributeValueType.DECIMAL, null, null, null, AttributeStatus.ENABLED, 0, null, null));
        }
        when(damageTypes.get("lol", "physical")).thenReturn(new DamageTypeResponse("lol", "physical",
            "物理", null, DamageTypeStatus.ENABLED, 0, null, null, true));
        JsonNode formula = definition("1", "armor");
        when(damageTypes.getFormula("lol", "physical")).thenReturn(
            new DamageTypeFormulaResponse("lol", "physical", formula, null));
    }

    @Test
    void returnsSelectedAuthoringDataAndDigestFromOneReadOnlySnapshot() throws Exception {
        var result = service.get("lol", CHOICE);
        assertEquals(skill, result.skillConfigurations().getFirst());
        assertEquals(0, result.target().selectedLevelValues().get("armor").intValue());
        assertEquals("physical", result.catalogs().damageTypes().getFirst().type().damageTypeKey());
        assertEquals(64, result.snapshotDigest().length());
        assertNotNull(result.readAt());
        assertEquals(result.snapshotDigest(), service.get("lol", CHOICE).snapshotDigest());
        assertTrue(result.selection().sourceEquipmentKeys().isEmpty());
        assertTrue(result.selection().targetEquipmentKeys().isEmpty());
        assertTrue(result.source().selectedEquipment().isEmpty());
        assertTrue(result.target().selectedEquipment().isEmpty());
        verifyNoInteractions(equipment, equipmentMapper);
        Transactional transaction = SimulationSnapshotService.class.getMethod("get", String.class, Selection.class)
            .getAnnotation(Transactional.class);
        assertTrue(transaction.readOnly());
        assertEquals(Isolation.REPEATABLE_READ, transaction.isolation());
    }

    @Test
    void failsAtOriginalReferenceWhenDependencyIsMissing() {
        when(damageTypes.get("lol", "physical")).thenThrow(new ApiException(HttpStatus.NOT_FOUND,
            "404.DAMAGE_TYPE_NOT_FOUND", "伤害类型不存在"));
        ApiException error = assertThrows(ApiException.class, () -> service.get("lol", CHOICE));
        assertEquals("409.SIMULATION_SNAPSHOT_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("results[0].detail.damageTypeKey"));
        verify(damageTypes, never()).getFormula(any(), any());
    }

    @Test
    void doesNotSubstituteAFormulaWhenSelectedDamageTypeHasNone() {
        when(damageTypes.get("lol", "physical")).thenReturn(new DamageTypeResponse("lol", "physical",
            "物理", null, DamageTypeStatus.ENABLED, 0, null, null, false));
        ApiException error = assertThrows(ApiException.class, () -> service.get("lol", CHOICE));
        assertTrue(error.getDetails().toString().contains("catalogs.damageTypes.physical.formula"));
        verify(damageTypes, never()).getFormula("lol", "physical");
    }

    @Test
    void excludedActiveSiblingKeepsItsOutsideReferenceWithoutExecutingOrLoadingIt() throws Exception {
        var crossSkill = json.readValue("""
            {"ruleKey":"active","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"other_skill","castPhase":"INITIAL"}},
             "conditionGroups":[],"actions":[{"actionKey":"deal","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET",
             "detail":{"effectKey":"attack_hit"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """, SkillTriggerRuleDetailResponse.class);
        configure(new SkillConfigurationResponse(skill.skill(), skill.parameters(), skill.formulas(), skill.effects(),
            List.of(), List.of(), List.of(crossSkill), "skill-digest"));
        var result = service.get("lol", CHOICE);
        assertEquals(xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.InactiveReason.ACTIVE_DEFERRED,
            result.source().skillSources().getFirst().inactiveReason());
        assertTrue(result.references().isEmpty());
        assertEquals(crossSkill, result.skillConfigurations().getFirst().triggerRules().getFirst());
        verify(configurations, never()).get("lol", "other_skill");
    }

    @Test
    void missingSelectedLevelNumberIsNotTreatedAsZero() {
        when(characterMapper.findLevelValuesJson("lol", "hero_b"))
            .thenReturn("{\"1\":{\"health\":250,\"armor\":null}}");
        ApiException error = assertThrows(ApiException.class, () -> service.get("lol", CHOICE));
        assertTrue(error.getDetails().toString().contains("target.attributes.levelValues.1.armor"));
    }

    @Test
    void dependenciesComeFromOriginalConfigurationAndKeepAllParallelResults() {
        var result = service.get("lol", CHOICE);
        assertSame(skill, result.skillConfigurations().getFirst());
        assertEquals(List.of("damage", "attack_link"), result.skillConfigurations().getFirst().effects().getFirst()
            .results().stream().map(SkillEffectResultResponse::resultKey).toList());
        assertTrue(result.references().stream().anyMatch(r -> r.sourceKey().equals("attack_hit")
            && r.fieldPath().equals("results[0].detail.damageTypeKey") && r.targetKey().equals("physical")));
        assertTrue(result.references().stream().anyMatch(r -> r.sourceType().equals("TRIGGER")
            && r.fieldPath().equals("actions[0].detail.effectKey") && r.targetKey().equals("attack_hit")));
        verify(damageTypes).get("lol", "physical");
        verify(damageTypes).getFormula("lol", "physical");
        verify(configurations).get("lol", "shared_basic_attack");
        verifyNoMoreInteractions(configurations);
        verifyNoInteractions(zones, statuses);
        verify(attributes, never()).list(any(), any());
    }

    @Test
    void rejectsMissingLocalFormulaInsteadOfTrustingItsReferenceAsARealTarget() {
        configure(new SkillConfigurationResponse(skill.skill(), List.of(), skill.formulas(),
            List.of(effect(new SkillEffectCriticalPolicy(SkillEffectCriticalMode.DISALLOWED, null), "missing")),
            List.of(), List.of(), skill.triggerRules(), "skill-digest"));
        assertIssue("REFERENCE_MISSING", "effects.attack_hit.results[0].valueRule.value.formulaKey");
        verifyNoInteractions(damageTypes);
    }

    @Test
    void rejectsMissingEffectAtActionFieldInsteadOfReturningRemainingDamage() throws Exception {
        configure(new SkillConfigurationResponse(skill.skill(), skill.parameters(), skill.formulas(), skill.effects(),
            List.of(), List.of(), List.of(trigger("missing_effect")), "skill-digest"));
        assertIssue("REFERENCE_MISSING", "triggerRules.on_hit.actions[0].detail.effectKey");
    }

    @Test
    void rejectsDisabledDependencyAtItsOriginalField() {
        when(damageTypes.get("lol", "physical")).thenReturn(new DamageTypeResponse("lol", "physical",
            "物理", null, DamageTypeStatus.DISABLED, 0, null, null, true));
        assertIssue("REFERENCE_DISABLED", "effects.attack_hit.results[0].detail.damageTypeKey");
        verify(damageTypes, never()).getFormula(any(), any());
    }

    @Test
    void invalidCommonFormulaCannotProducePartialSuccessfulSnapshot() {
        damageFormula(json.createObjectNode());
        assertIssue("FORMULA_INVALID_STRUCTURE", "catalogs.damageTypes.physical.formula/inputs");
    }

    @Test
    void missingSceneSupplementalValuesStayAbsentWhileTheirDefinitionsReturn() {
        when(calculationRules.get("lol")).thenReturn(new GameCalculationRulesResponse("lol", "a".repeat(64), AggregateJson.tree("""
            {"criticalChanceAttributeKey":"critical_strike_chance","criticalMultiplierMin":1,"attackSpeedAttributeKey":null,"attributeDerivations":[],
             "basicAttackCategoryKey":"basic_attack","equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
            """)));
        for (String key : List.of("critical_strike_chance", "critical_strike_damage_bonus_percent",
            "armor_pen_percent", "life_steal_percent")) attribute(key);
        configure(new SkillConfigurationResponse(skill.skill(), skill.parameters(),
            List.of(formula("amount", "attack_damage"), formula("crit_multiplier", "critical_strike_damage_bonus_percent")),
            List.of(effect(new SkillEffectCriticalPolicy(SkillEffectCriticalMode.SOURCE_CRIT_CHANCE,
                SkillNumericValue.formula("crit_multiplier")), "amount")),
            List.of(), List.of(), skill.triggerRules(), "skill-digest"));
        damageFormula(definition("1", "armor", "armor_pen_percent"));
        when(vampRules.get("lol")).thenReturn(new GameVampRules(List.of(new GameVampRule(
            SkillEffectVampType.LIFE_STEAL, "life_steal_percent", SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE,
            BigDecimal.ONE, List.of(SkillEffectDamageDeliveryKind.BASIC_ATTACK),
            List.of(SkillEffectDamageOriginKind.DIRECT), List.of("basic_attack")))));
        var result = service.get("lol", CHOICE);
        for (String key : List.of("critical_strike_chance", "critical_strike_damage_bonus_percent",
            "armor_pen_percent", "life_steal_percent")) {
            assertFalse(result.source().selectedLevelValues().has(key));
            assertFalse(result.source().attributes().levelValues().path("1").has(key));
            assertTrue(result.catalogs().attributes().stream().anyMatch(a -> a.attributeKey().equals(key)), key);
        }
        assertEquals(100, result.source().selectedLevelValues().get("attack_damage").intValue());
    }

    @Test
    void forcedCriticalDoesNotRequireSourceCriticalChanceDefinition() {
        configure(new SkillConfigurationResponse(skill.skill(), skill.parameters(), skill.formulas(),
            List.of(effect(new SkillEffectCriticalPolicy(SkillEffectCriticalMode.FORCED,
                SkillNumericValue.fixed(BigDecimal.valueOf(2))), "amount")),
            List.of(), List.of(), skill.triggerRules(), "skill-digest"));
        service.get("lol", CHOICE);
        verify(attributes, never()).get("lol", "critical_strike_chance");
    }

    @Test
    void intrinsicAttributePresentAtOtherLevelCannotBecomeSceneSupplement() {
        when(characterMapper.findLevelValuesJson("lol", "hero_b"))
            .thenReturn("{\"1\":{\"health\":250},\"2\":{\"health\":300,\"armor\":30}}");
        assertIssue("NUMBER_MISSING", "target.attributes.levelValues.1.armor");
    }

    @Test
    void refusesIntrinsicGraphThatManagementReadDropped() throws Exception {
        when(characters.getAttributes("lol", "hero_b")).thenReturn(new CharacterAttributesResponse("hero_b", 1, 18,
            json.readTree("{\"1\":{\"health\":250}}")));
        assertIssue("LEVEL_VALUES_INCOMPLETE", "target.attributes.levelValues.1.armor");
    }

    @Test
    void missingWholeSelectedLevelIsRejected() {
        when(characterMapper.findLevelValuesJson("lol", "hero_b")).thenReturn("{\"2\":{\"health\":300,\"armor\":30}}");
        assertIssue("LEVEL_VALUES_MISSING", "target.attributes.levelValues.1");
    }

    @Test
    void rejectsUnattachedOrUnsupportedSkillAndOutOfRangeLevels() {
        when(relations.listCharacterRelations("lol", "hero_a", null))
            .thenReturn(new CharacterSkillRelationListResponse(List.of(), 0));
        assertIssue("SKILL_NOT_ATTACHED", "source.attachedSkills");
        assertThrows(ApiException.class, () -> service.get("lol", new Selection("hero_a", 0, "hero_b", 1,
            "shared_basic_attack", 1, List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of())));
        assertThrows(ApiException.class, () -> service.get("lol", new Selection("hero_a", 1, "hero_b", 1,
            "other_skill", 1, List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of())));
        verifyNoInteractions(configurations);
    }

    @Test
    void selectedParameterNumberIsRequiredWhileRuntimeInputKeepsNoDefault() {
        var formula = new SkillFormulaDetailResponse("lol", "shared_basic_attack", "amount", "参数取值", null, 0,
            xyz.game.datamanage.support.formula.SkillFormulaFixtures.parameter("shared_basic_attack", "p"), null, null);
        configure(new SkillConfigurationResponse(skill.skill(), List.of(parameter(SkillParameterValueMode.FIXED, null, null)),
            List.of(formula), skill.effects(), List.of(), List.of(), skill.triggerRules(), "skill-digest"));
        assertIssue("NUMBER_MISSING", "parameters.p.fixedValue");
        configure(new SkillConfigurationResponse(skill.skill(), List.of(parameter(SkillParameterValueMode.SKILL_LEVEL, null, Map.of("2", BigDecimal.ONE))),
            List.of(formula), skill.effects(), List.of(), List.of(), skill.triggerRules(), "skill-digest"));
        assertIssue("NUMBER_MISSING", "parameters.p.levelValues.1");
        configure(new SkillConfigurationResponse(skill.skill(), List.of(parameter(SkillParameterValueMode.RUNTIME_INPUT, null, null)),
            List.of(formula), skill.effects(), List.of(), List.of(), skill.triggerRules(), "skill-digest"));
        var value = service.get("lol", CHOICE).skillConfigurations().getFirst().parameters().getFirst();
        assertNull(value.fixedValue());
        assertNull(value.levelValues());
    }

    @Test
    void digestIncludesBothActorsAndDamageFormulaBeyondSingleSkillDigest() throws Exception {
        String original = service.get("lol", CHOICE).snapshotDigest();
        characterValues("hero_b", "{\"1\":{\"armor\":40,\"health\":250}}");
        String changedActor = service.get("lol", CHOICE).snapshotDigest();
        assertNotEquals(original, changedActor);
        damageFormula(definition("2"));
        assertNotEquals(changedActor, service.get("lol", CHOICE).snapshotDigest());
        assertEquals("skill-digest", skill.baseDigest());
    }

    @Test
    void snapshotTransportsCompleteCommonDefinitionReferencesAndUnusedResultDigest() {
        var formula = (com.fasterxml.jackson.databind.node.ObjectNode) definition("1.000", "armor");
        formula.withArray("stages").addObject().put("key", "unused").put("name", "未用结果")
            .putObject("expression").put("op", "const").put("value", "0.2500");
        damageFormula(formula);
        var first = service.get("lol", CHOICE);
        assertEquals(formula, first.catalogs().damageTypes().getFirst().formula().formula());
        assertEquals("0.2500", first.catalogs().damageTypes().getFirst().formula().formula().at("/stages/1/expression/value").textValue());
        assertTrue(first.references().stream().anyMatch(reference -> reference.sourceType().equals("DAMAGE_TYPE")
            && reference.sourceSkillKey().isEmpty() && reference.sourceKey().equals("physical")
            && reference.fieldPath().equals("inputs/0/binding/attributeKey") && reference.targetKey().equals("armor")));
        var renamed = formula.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) renamed.at("/stages/1")).put("name", "改名后的未用结果");
        damageFormula(renamed);
        assertNotEquals(first.snapshotDigest(), service.get("lol", CHOICE).snapshotDigest());
    }

    @Test
    void unusedCommonInputStillRequiresEnabledSameGameAttributeCatalog() {
        damageFormula(definition("1", "external"));
        when(attributes.get("lol", "external")).thenReturn(new AttributeResponse("other", "external", "外部",
            AttributeValueType.DECIMAL, null, null, null, AttributeStatus.ENABLED, 0, null, null));
        assertIssue("REFERENCE_OUT_OF_SCOPE", "catalogs.damageTypes.physical.formula/inputs/0/binding/attributeKey");
        when(attributes.get("lol", "external")).thenReturn(new AttributeResponse("lol", "external", "停用",
            AttributeValueType.DECIMAL, null, null, null, AttributeStatus.DISABLED, 0, null, null));
        assertIssue("REFERENCE_DISABLED", "catalogs.damageTypes.physical.formula/inputs/0/binding/attributeKey");
    }

    @Test
    void missingEquipmentArraysAreRejectedRatherThanDefaulted() {
        assertSelectionIssue(equipmentChoice(null, null), "REQUIRED", "selection.sourceEquipmentKeys");
        var result = service.get("lol", equipmentChoice(List.of(), List.of()));
        assertEquals(CHOICE, result.selection());
        verifyNoInteractions(equipment, equipmentMapper);
    }

    @Test
    void acceptsSixUniqueEquipmentPerSideAndPreservesSeparateOwners() throws Exception {
        List<String> keys = IntStream.range(0, 6).mapToObj(index -> "item_" + index).toList();
        for (String key : keys) selectedEquipment(key, "{\"health\":100}");
        var result = service.get("lol", equipmentChoice(keys, keys.reversed()));
        assertEquals(keys, result.selection().sourceEquipmentKeys());
        assertEquals(keys, result.selection().targetEquipmentKeys());
        assertEquals(keys, result.source().selectedEquipment().stream().map(item -> item.equipment().equipmentKey()).toList());
        assertEquals(keys, result.target().selectedEquipment().stream().map(item -> item.equipment().equipmentKey()).toList());
        assertEquals(500, result.source().selectedLevelValues().path("health").intValue());
        assertEquals(250, result.target().selectedLevelValues().path("health").intValue());
        assertEquals(1, result.skillConfigurations().size());
    }

    @Test
    void rejectsInvalidDuplicateOrExcessEquipmentBeforeReadingAnySceneData() {
        for (String invalidKey : new String[] {null, "", " ", "Item_a", "item-a", "item_a,item_b"}) {
            assertSelectionIssue(equipmentChoice(Collections.singletonList(invalidKey), List.of()),
                "KEY_INVALID", "selection.sourceEquipmentKeys[0]");
            assertSelectionIssue(equipmentChoice(List.of(), Collections.singletonList(invalidKey)),
                "KEY_INVALID", "selection.targetEquipmentKeys[0]");
        }
        assertSelectionIssue(equipmentChoice(List.of("item_a", "item_a"), List.of()),
            "DUPLICATE_KEY", "selection.sourceEquipmentKeys[1]");
        assertSelectionIssue(equipmentChoice(List.of(), List.of("item_a", "item_a")),
            "DUPLICATE_KEY", "selection.targetEquipmentKeys[1]");
        List<String> excessive = IntStream.range(0, 7).mapToObj(index -> "item_" + index).toList();
        assertSelectionIssue(equipmentChoice(excessive, List.of()), "SELECTION_LIMIT_EXCEEDED", "selection.sourceEquipmentKeys[6]");
        assertSelectionIssue(equipmentChoice(List.of(), excessive), "SELECTION_LIMIT_EXCEEDED", "selection.targetEquipmentKeys[6]");
        verifyNoInteractions(characters, characterMapper, equipment, equipmentMapper, relations, configurations);
    }

    @Test
    void selectedMissingEquipmentKeepsIts404AndStableKey() {
        when(equipment.get("lol", "item_missing")).thenThrow(new ApiException(HttpStatus.NOT_FOUND,
            "404.EQUIPMENT_NOT_FOUND", "装备不存在", Map.of("equipmentKey", "item_missing")));
        ApiException error = assertThrows(ApiException.class,
            () -> service.get("lol", equipmentChoice(List.of(), List.of("item_missing"))));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
        assertEquals("404.EQUIPMENT_NOT_FOUND", error.getCode());
        assertEquals("item_missing", error.getDetails().get("equipmentKey"));
        verifyNoInteractions(configurations);
    }

    @Test
    void rejectsMalformedMissingAndNonNumericRawEquipmentAttributes() throws Exception {
        selectedEquipment("item_a", "{}");
        Selection choice = equipmentChoice(List.of("item_a"), List.of());
        for (String raw : new String[] {null, "null", "[]", "not-json"}) {
            when(equipmentMapper.findAttributeValuesJson("lol", "item_a")).thenReturn(raw);
            assertIssue(choice, "INVALID_STORED_DATA", "source.selectedEquipment[0].attributes.attributeValues");
        }
        for (String raw : List.of("{\"health\":null}", "{\"health\":\"100\"}", "{\"health\":true}", "{\"health\":1e999}")) {
            when(equipmentMapper.findAttributeValuesJson("lol", "item_a")).thenReturn(raw);
            assertIssue(choice, "NUMBER_INVALID", "source.selectedEquipment[0].attributes.attributeValues.health");
        }
        verifyNoInteractions(configurations);
    }

    @Test
    void refusesUnknownEquipmentAttributeDroppedByManagementRead() throws Exception {
        selectedEquipment("item_a", "{\"unknown_attribute\":10}");
        when(equipment.getAttributes("lol", "item_a")).thenReturn(new EquipmentAttributesResponse("item_a", json.readTree("{}")));
        assertIssue(equipmentChoice(List.of("item_a"), List.of()), "ATTRIBUTE_VALUES_INCOMPLETE",
            "source.selectedEquipment[0].attributes.attributeValues.unknown_attribute");
    }

    @Test
    void rejectsEquipmentAttributesOutsideTheirTypeAndRange() throws Exception {
        when(attributes.get("lol", "health")).thenReturn(new AttributeResponse("lol", "health", "生命值",
            AttributeValueType.INTEGER, BigDecimal.ZERO, BigDecimal.valueOf(100), null, AttributeStatus.ENABLED, 0, null, null));
        Selection choice = equipmentChoice(List.of(), List.of("item_a"));
        selectedEquipment("item_a", "{\"health\":2.5}");
        assertIssue(choice, "INTEGER_REQUIRED", "target.selectedEquipment[0].attributes.attributeValues.health");
        for (String raw : List.of("{\"health\":-1}", "{\"health\":101}")) {
            selectedEquipment("item_a", raw);
            assertIssue(choice, "RANGE_INVALID", "target.selectedEquipment[0].attributes.attributeValues.health");
        }
    }

    @Test
    void disabledEquipmentAttributeDefinitionFailsAtItsDependencyPath() throws Exception {
        selectedEquipment("item_a", "{\"attack_speed_bonus_percent\":0.15}");
        when(attributes.get("lol", "attack_speed_bonus_percent")).thenReturn(new AttributeResponse("lol",
            "attack_speed_bonus_percent", "额外攻速", AttributeValueType.DECIMAL, null, null, null,
            AttributeStatus.DISABLED, 0, null, null));
        assertIssue(equipmentChoice(List.of("item_a"), List.of()), "REFERENCE_DISABLED",
            "source.selectedEquipment[0].attributes.attributeValues.attack_speed_bonus_percent");
    }

    @Test
    void globallyDisabledEquipmentRelationRemainsVisibleWithItsFixedAttributes() throws Exception {
        selectedEquipment("item_a", "{\"health\":100}", "item_passive");
        selectedPassive("item_passive", 1);
        when(relations.listEquipmentRelations("lol", "item_a", null)).thenReturn(new EquipmentSkillRelationListResponse(
            List.of(new EquipmentSkillRelationResponse("lol", "item_a", "装备", "item_passive", "被动", SkillStatus.DISABLED, 0)), 1));
        var result = service.get("lol", equipmentChoice(List.of(), List.of("item_a")));
        assertEquals(1, result.target().selectedEquipment().getFirst().attachedSkills().size());
        assertEquals(100, result.target().selectedEquipment().getFirst().attributes().attributeValues().path("health").intValue());
        assertEquals(xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.InactiveReason.GLOBAL_DISABLED,
            result.target().skillSources().getFirst().inactiveReason());
    }

    @Test
    void inactiveCompleteFormulaDeclarationsHaveCatalogDefinitionsWithoutBecomingExecutionReads() throws Exception {
        selectedEquipment("item_a", "{}", "item_passive");
        attribute("ability_power");
        var passive = selectedPassive("item_passive", 1);
        var formula = new SkillFormulaDetailResponse("lol", "item_passive", "unused_amount", "未执行公式", null, 0,
            xyz.game.datamanage.support.formula.SkillFormulaFixtures.attribute("source", "ability_power", "TOTAL"), null, null);
        when(configurations.get("lol", "item_passive")).thenReturn(new SkillConfigurationResponse(passive.skill(),
            List.of(), List.of(formula), List.of(), List.of(), List.of(), List.of(), "inactive-formula-digest"));
        var result = service.get("lol", equipmentChoice(List.of(), List.of("item_a")));
        assertTrue(result.catalogs().attributes().stream().anyMatch(row -> row.attributeKey().equals("ability_power")));
        assertEquals(xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.InactiveReason.CONFIGURATION_INCOMPLETE,
            result.target().skillSources().getFirst().inactiveReason());
        assertTrue(result.skillConfigurations().stream().anyMatch(row -> row.formulas().contains(formula)));
        assertTrue(result.references().stream().noneMatch(row -> row.targetKey().equals("ability_power")));
        assertTrue(!result.target().selectedLevelValues().has("ability_power"));
    }

    @Test
    void equipmentWithoutRelationsKeepsRawAttributesWithoutClaimingRuntimeSupport() throws Exception {
        attribute("mana");
        selectedEquipment("item_a", "{\"mana\":250,\"health\":100}");
        var result = service.get("lol", equipmentChoice(List.of("item_a"), List.of()));
        var item = result.source().selectedEquipment().getFirst();
        assertTrue(item.attachedSkills().isEmpty());
        assertEquals(250, item.attributes().attributeValues().path("mana").intValue());
        assertTrue(result.catalogs().attributes().stream().anyMatch(definition -> definition.attributeKey().equals("mana")));
        assertFalse(result.source().selectedLevelValues().has("mana"));
        assertEquals(500, result.source().selectedLevelValues().path("health").intValue());
    }

    @Test
    void configurationsAreDeduplicatedAcrossBothSidesAndSortedBySkillKey() throws Exception {
        selectedEquipment("item_a", "{}", "passive_z", "passive_a");
        selectedEquipment("item_b", "{}", "passive_a");
        selectedPassive("passive_z", 1);
        selectedPassive("passive_a", 1);
        var result = service.get("lol", equipmentChoice(List.of("item_b", "item_a"), List.of("item_a")));
        assertEquals(List.of("passive_a", "passive_z", "shared_basic_attack"),
            result.skillConfigurations().stream().map(configuration -> configuration.skill().skillKey()).toList());
        assertEquals(2, result.source().selectedEquipment().size());
        assertEquals(1, result.target().selectedEquipment().size());
        assertEquals(2, result.target().selectedEquipment().getFirst().attachedSkills().size());
        verify(configurations).get("lol", "passive_a");
        verify(configurations).get("lol", "passive_z");
        verify(configurations).get("lol", "shared_basic_attack");
        verifyNoMoreInteractions(configurations);
    }

    @Test
    void acceptsExactly32SelectedConfigurationsButRejects33BeforeLoadingAnyOfThem() throws Exception {
        List<String> keys = IntStream.range(0, 31).mapToObj(index -> "passive_" + index).toList();
        selectedEquipment("item_a", "{}", keys.toArray(String[]::new));
        for (String key : keys) selectedPassive(key, 1);
        Selection choice = equipmentChoice(List.of("item_a"), List.of("item_a"));
        assertEquals(32, service.get("lol", choice).skillConfigurations().size());
        clearInvocations(configurations);
        selectedEquipment("item_a", "{}", IntStream.range(0, 32).mapToObj(index -> "passive_" + index).toArray(String[]::new));
        assertIssue(choice, "CONFIGURATION_LIMIT_EXCEEDED", "skillConfigurations");
        verifyNoInteractions(configurations);
    }

    @Test
    void equipmentPassiveMustHaveAnActualMaximumLevelOfOne() throws Exception {
        selectedEquipment("item_a", "{}", "item_passive");
        selectedPassive("item_passive", 2);
        assertIssue(equipmentChoice(List.of("item_a"), List.of()), "PASSIVE_LEVEL_UNSUPPORTED",
            "source.selectedEquipment[0].attachedSkills[0].skillKey");
    }

    @Test
    void missingConfigurationFailsButGloballyDisabledFullTreeStaysVisible() throws Exception {
        selectedEquipment("item_a", "{}", "item_passive");
        Selection choice = equipmentChoice(List.of("item_a"), List.of());
        when(configurations.get("lol", "item_passive")).thenThrow(new ApiException(HttpStatus.NOT_FOUND,
            "404.SKILL_NOT_FOUND", "技能不存在"));
        assertIssue(choice, "REFERENCE_MISSING", "source.selectedEquipment[0].attachedSkills[0].skillKey");
        SkillConfigurationResponse disabled = passive("item_passive", 1, SkillStatus.DISABLED);
        doReturn(disabled).when(configurations).get("lol", "item_passive");
        var result = service.get("lol", choice);
        assertEquals(disabled, result.skillConfigurations().getFirst());
        assertEquals(xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.InactiveReason.GLOBAL_DISABLED,
            result.source().skillSources().stream().filter(row -> row.skillKey().equals("item_passive")).findFirst().orElseThrow().inactiveReason());
    }

    @Test
    void enabledConditionUsesActualSameSideSourceAndStillRejectsMissingState() throws Exception {
        selectedEquipment("item_a", "{}", "item_passive");
        SkillConfigurationResponse passive = selectedPassive("item_passive", 1);
        var state = new SkillInternalStateDetailResponse("lol", "item_passive", "guard", "守卫", SkillInternalStateType.FLAG,
            SkillInternalStateScope.SKILL, null, 0, new SkillInternalStateFlagDetail(false), null, null);
        when(configurations.get("lol", "item_passive")).thenReturn(new SkillConfigurationResponse(passive.skill(),
            List.of(), List.of(), List.of(), List.of(), List.of(state), List.of(), "passive-digest"));
        var reference = json.readValue("""
            {"ruleKey":"cross_state","eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"shared_basic_attack"}},
             "conditionGroups":[{"groupKey":"guarded","conditions":[{"conditionKey":"guard","conditionType":"INTERNAL_STATE_CHECK",
             "detail":{"stateSkillKey":"item_passive","stateKey":"guard","checkKind":"FLAG_ENABLED","subject":"SOURCE"}}]}],
             "actions":[{"actionKey":"deal","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"attack_hit"},
             "runtimeInputBindings":[],"resultModifiers":[]}]}
            """, SkillTriggerRuleDetailResponse.class);
        configure(new SkillConfigurationResponse(skill.skill(), skill.parameters(), skill.formulas(), skill.effects(),
            List.of(), List.of(), List.of(reference), "skill-digest"));
        Selection choice = equipmentChoice(List.of("item_a"), List.of());
        var result = service.get("lol", choice);
        assertTrue(result.references().stream().anyMatch(row -> row.targetType().equals("SKILL") && row.targetKey().equals("shared_basic_attack")));
        assertTrue(result.references().stream().anyMatch(row -> row.targetType().equals("STATE") && row.targetKey().equals("guard")));
        when(configurations.get("lol", "item_passive")).thenReturn(passive);
        assertIssue(choice, "REFERENCE_MISSING", "triggerRules.cross_state.conditionGroups[0].conditions[0].detail.stateKey");
        verify(configurations, never()).get("lol", "unselected_skill");
    }

    @Test
    void equipmentActiveSiblingDoesNotRequireAnUnselectedSkill() throws Exception {
        selectedEquipment("item_a", "{}", "item_passive");
        SkillConfigurationResponse passive = selectedPassive("item_passive", 1);
        var reference = json.readValue("""
            {"ruleKey":"outside","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"unselected_skill","castPhase":"INITIAL"}},
             "conditionGroups":[],"actions":[{"actionKey":"heal","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE",
             "detail":{"effectKey":"unselected_effect"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """, SkillTriggerRuleDetailResponse.class);
        when(configurations.get("lol", "item_passive")).thenReturn(new SkillConfigurationResponse(passive.skill(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(reference), "passive-digest"));
        var result = service.get("lol", equipmentChoice(List.of("item_a"), List.of()));
        assertEquals(xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.InactiveReason.ACTIVE_DEFERRED,
            result.source().skillSources().stream().filter(row -> row.skillKey().equals("item_passive")).findFirst().orElseThrow().inactiveReason());
        verify(configurations, never()).get("lol", "unselected_skill");
    }

    @Test
    void sharedPassiveParametersValidateEachActualOwnersCharacterLevel() throws Exception {
        selectedEquipment("item_a", "{}", "item_passive");
        SkillConfigurationResponse passive = selectedPassive("item_passive", 1);
        var parameter = new SkillParameterResponse("lol", "item_passive", "scaled", "等级参数", SkillParameterValueType.DECIMAL,
            SkillParameterValueMode.CHARACTER_LEVEL, null, Map.of("1", BigDecimal.ONE), null, 0, null, null);
        when(configurations.get("lol", "item_passive")).thenReturn(new SkillConfigurationResponse(passive.skill(),
            List.of(parameter), List.of(), List.of(healing("item_passive", SkillNumericValue.parameter("scaled"))),
            List.of(), List.of(), List.of(initializationRule("heal")), "passive-digest"));
        characterValues("hero_b", "{\"1\":{\"armor\":0,\"health\":250},\"2\":{\"armor\":10,\"health\":300}}");
        Selection choice = new Selection("hero_a", 1, "hero_b", 2, "shared_basic_attack", 1,
            List.of("item_a"), List.of("item_a"), List.of(), List.of(), List.of(), List.of(), List.of());
        assertIssue(choice, "NUMBER_MISSING", "skillConfigurations[0].parameters.scaled.levelValues.2");
    }

    @Test
    void catalogsAndReferencesIncludeEverySelectedEquipmentEffectAndDamagePipelineDependency() throws Exception {
        selectedEquipment("item_a", "{\"mana\":250}", "item_passive");
        for (String key : List.of("mana", "bonus_armor", "attack_speed_bonus_percent", "magic_resistance", "magic_pen_percent")) {
            attribute(key);
        }
        SkillConfigurationResponse passive = selectedPassive("item_passive", 1);
        var formula = new SkillFormulaDetailResponse("lol", "item_passive", "item_amount", "附伤公式", null, 0,
            xyz.game.datamanage.support.formula.SkillFormulaFixtures.attribute("source", "bonus_armor", "BONUS"), null, null);
        var effect = new SkillEffectDetailResponse("lol", "item_passive", "item_effect", "被动效果", null, 0,
            List.of(new SkillEffectResultResponse("damage", "附伤", SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET, null, 0,
                    new SkillEffectValueRuleResponse(SkillNumericValue.formula("item_amount"), BigDecimal.ONE, null, null),
                    new SkillEffectDamageDetail("magic", SkillEffectDamageDeliveryKind.BASIC_ATTACK,
                        SkillEffectDamageOriginKind.DIRECT, new SkillEffectCriticalPolicy(SkillEffectCriticalMode.DISALLOWED, null),
                        SkillEffectVampQualification.RESOLVED, List.of())),
                new SkillEffectResultResponse("speed", "攻速", SkillEffectResultType.ATTRIBUTE_CHANGE, SkillEffectTarget.SOURCE, null, 1,
                    new SkillEffectValueRuleResponse(SkillNumericValue.fixed(BigDecimal.valueOf(0.15)), BigDecimal.ONE, null, null),
                    new SkillEffectAttributeChangeDetail("attack_speed_bonus_percent", SkillEffectAttributeChangeOperation.INCREASE, "bonus_zone")),
                new SkillEffectResultResponse("stun", "眩晕", SkillEffectResultType.STATUS_OPERATION, SkillEffectTarget.TARGET, null, 2,
                    null, new SkillEffectStatusOperationDetail("stun", SkillEffectStatusOperation.APPLY))), null, null);
        when(configurations.get("lol", "item_passive")).thenReturn(new SkillConfigurationResponse(passive.skill(),
            List.of(), List.of(formula), List.of(effect), List.of(), List.of(), List.of(initializationRule("item_effect")), "passive-digest"));
        when(damageTypes.get("lol", "magic")).thenReturn(new DamageTypeResponse("lol", "magic", "魔法", null,
            DamageTypeStatus.ENABLED, 0, null, null, true));
        when(damageTypes.getFormula("lol", "magic")).thenReturn(new DamageTypeFormulaResponse("lol", "magic",
            definition("1", "magic_resistance", "magic_pen_percent"), null));
        ModifierZoneResponse zone = new ModifierZoneResponse("lol", "bonus_zone", "额外属性加算", ModifierZoneDomain.ATTRIBUTE,
            ModifierZoneCalculationMode.FLAT_ADD, ModifierZoneApplicationStage.ATTRIBUTE_FLAT, null, ModifierZoneStatus.ENABLED, 0, null, null);
        when(zones.get("lol", "bonus_zone")).thenReturn(zone);
        when(statuses.get("lol", "stun")).thenReturn(new StatusResponse("lol", "stun", "眩晕", null,
            StatusKind.STUN, StatusRecordStatus.ENABLED, 0, null, null));
        Selection choice = equipmentChoice(List.of(), List.of("item_a"));
        var result = service.get("lol", choice);
        assertEquals(List.of("magic", "physical"), result.catalogs().damageTypes().stream().map(entry -> entry.type().damageTypeKey()).toList());
        for (String key : List.of("mana", "bonus_armor", "attack_speed_bonus_percent", "magic_resistance", "magic_pen_percent")) {
            assertTrue(result.catalogs().attributes().stream().anyMatch(definition -> definition.attributeKey().equals(key)), key);
        }
        assertEquals("bonus_zone", result.catalogs().modifierZones().getFirst().modifierZoneKey());
        assertEquals("stun", result.catalogs().statuses().getFirst().statusKey());
        assertEquals(3, result.skillConfigurations().getFirst().effects().getFirst().results().size());
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals("item_passive")
            && reference.sourceKey().equals("item_effect") && reference.fieldPath().equals("results[2].detail.statusKey")));
        when(zones.get("lol", "bonus_zone")).thenReturn(new ModifierZoneResponse("lol", "bonus_zone", "额外属性加算",
            zone.domain(), zone.calculationMode(), zone.applicationStage(), null, ModifierZoneStatus.DISABLED, 0, null, null));
        assertIssue(choice, "REFERENCE_DISABLED", "skillConfigurations[0].effects.item_effect.results[1].detail.modifierZoneKey");
    }

    @Test
    void duplicateEquipmentRelationsAndSelectedConfigurationKeysAreRejected() throws Exception {
        selectedEquipment("item_a", "{}", "item_passive", "item_passive");
        Selection choice = equipmentChoice(List.of("item_a"), List.of());
        assertIssue(choice, "DUPLICATE_KEY", "source.selectedEquipment[0].attachedSkills[1].skillKey");
        selectedEquipment("item_a", "{}", "item_passive");
        SkillConfigurationResponse passive = selectedPassive("item_passive", 1);
        var formula = new SkillFormulaDetailResponse("lol", "item_passive", "amount", "公式", null, 0,
            xyz.game.datamanage.support.formula.SkillFormulaFixtures.attribute("source", "health", "TOTAL"), null, null);
        when(configurations.get("lol", "item_passive")).thenReturn(new SkillConfigurationResponse(passive.skill(),
            List.of(), List.of(formula, formula), List.of(), List.of(), List.of(), List.of(), "passive-digest"));
        assertIssue(choice, "DUPLICATE_KEY", "skillConfigurations[0].formulas.amount.formulaKey");
    }

    @Test
    void digestIsIndependentOfSelectionAndRelationReadOrderButIncludesEveryAuthoringPart() throws Exception {
        selectedEquipment("item_a", "{\"health\":100}", "passive_z", "passive_a");
        selectedEquipment("item_b", "{\"health\":50}");
        selectedPassive("passive_z", 1);
        SkillConfigurationResponse passive = selectedPassive("passive_a", 1);
        var first = service.get("lol", equipmentChoice(List.of("item_b", "item_a"), List.of("item_a")));
        var originalRelations = relations.listEquipmentRelations("lol", "item_a", null);
        when(relations.listEquipmentRelations("lol", "item_a", null)).thenReturn(
            new EquipmentSkillRelationListResponse(originalRelations.items().reversed(), originalRelations.total()));
        var repeated = service.get("lol", equipmentChoice(List.of("item_a", "item_b"), List.of("item_a")));
        assertEquals(first.snapshotDigest(), repeated.snapshotDigest());
        assertEquals(first.selection(), repeated.selection());
        selectedEquipment("item_b", "{\"health\":51}");
        String changedAttributes = service.get("lol", repeated.selection()).snapshotDigest();
        assertNotEquals(first.snapshotDigest(), changedAttributes);
        when(relations.listEquipmentRelations("lol", "item_a", null)).thenReturn(new EquipmentSkillRelationListResponse(
            List.of(new EquipmentSkillRelationResponse("lol", "item_a", "装备", "passive_z", "被动", SkillStatus.ENABLED, 5),
                originalRelations.items().get(1)), 2));
        String changedRelation = service.get("lol", repeated.selection()).snapshotDigest();
        assertNotEquals(changedAttributes, changedRelation);
        var parameter = new SkillParameterResponse("lol", "passive_a", "amount", "参数", SkillParameterValueType.DECIMAL,
            SkillParameterValueMode.FIXED, BigDecimal.TEN, null, null, 0, null, null);
        when(configurations.get("lol", "passive_a")).thenReturn(new SkillConfigurationResponse(passive.skill(),
            List.of(parameter), List.of(), List.of(), List.of(), List.of(), List.of(), passive.baseDigest()));
        assertNotEquals(changedRelation, service.get("lol", repeated.selection()).snapshotDigest());
    }

    private static Selection equipmentChoice(List<String> source, List<String> target) {
        return new Selection("hero_a", 1, "hero_b", 1, "shared_basic_attack", 1, source, target, List.of(), List.of(), List.of(), List.of(), List.of());
    }

    @Test
    void equipmentSnapshotCollectsOnlyExplicitAttributesWithoutInventingRatioBindings() throws Exception {
        selectedEquipment("item_1042", "{\"bonus_attack_speed_percent\":0.10}");
        attribute("bonus_attack_speed_percent");
        attribute("attack_speed");
        attribute("attack_speed_ratio");
        var result = service.get("lol", equipmentChoice(List.of("item_1042"), List.of()));
        assertFalse(result.catalogs().attributes().stream().anyMatch(definition -> definition.attributeKey().equals("attack_speed_ratio")));
        assertFalse(result.source().selectedLevelValues().has("attack_speed_ratio"));
        verify(attributes, never()).get("lol", "attack_speed_ratio");
        verify(attributes, never()).get("lol", "attack_speed");
    }

    private void selectedEquipment(String key, String raw, String... skillKeys) throws Exception {
        when(equipment.get("lol", key)).thenReturn(new EquipmentResponse("lol", key, key, null, null, null));
        when(equipmentMapper.findAttributeValuesJson("lol", key)).thenReturn(raw);
        when(equipment.getAttributes("lol", key)).thenReturn(new EquipmentAttributesResponse(key, json.readTree(raw)));
        List<EquipmentSkillRelationResponse> attached = IntStream.range(0, skillKeys.length)
            .mapToObj(index -> new EquipmentSkillRelationResponse("lol", key, key, skillKeys[index], skillKeys[index], SkillStatus.ENABLED, index))
            .toList();
        when(relations.listEquipmentRelations("lol", key, null)).thenReturn(new EquipmentSkillRelationListResponse(attached, attached.size()));
    }

    private SkillConfigurationResponse selectedPassive(String key, int maxLevel) {
        SkillConfigurationResponse passive = passive(key, maxLevel, SkillStatus.ENABLED);
        when(configurations.get("lol", key)).thenReturn(passive);
        return passive;
    }

    private static SkillConfigurationResponse passive(String key, int maxLevel, SkillStatus status) {
        return new SkillConfigurationResponse(new SkillResponse("lol", key, key, null, maxLevel, status, 0, List.of(), null, null),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), key + "-digest");
    }

    private void assertSelectionIssue(Selection choice, String code, String field) {
        ApiException error = assertThrows(ApiException.class, () -> service.get("lol", choice));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertTrue(error.getDetails().toString().contains(code), error.getDetails().toString());
        assertTrue(error.getDetails().toString().contains(field), error.getDetails().toString());
    }


    private void configure(SkillConfigurationResponse value) {
        when(configurations.get("lol", "shared_basic_attack")).thenReturn(value);
    }

    private void characterValues(String key, String raw) throws Exception {
        when(characters.getAttributes("lol", key)).thenReturn(new CharacterAttributesResponse(key, 1, 18, json.readTree(raw)));
        when(characterMapper.findLevelValuesJson("lol", key)).thenReturn(raw);
    }

    private void attribute(String key) {
        when(attributes.get("lol", key)).thenReturn(new AttributeResponse("lol", key, key, AttributeValueType.DECIMAL,
            null, null, null, AttributeStatus.ENABLED, 0, null, null));
    }

    private void damageFormula(JsonNode formula) {
        when(damageTypes.getFormula("lol", "physical")).thenReturn(new DamageTypeFormulaResponse("lol", "physical", formula, null));
    }

    private SkillFormulaDetailResponse formula(String key, String attribute) {
        return new SkillFormulaDetailResponse("lol", "shared_basic_attack", key, key, null, 0,
            xyz.game.datamanage.support.formula.SkillFormulaFixtures.attribute("source", attribute, "TOTAL"), null, null);
    }

    private SkillEffectDetailResponse effect(SkillEffectCriticalPolicy critical, String amountFormula) {
        return new SkillEffectDetailResponse("lol", "shared_basic_attack", "attack_hit", "命中", null, 0,
            List.of(new SkillEffectResultResponse("damage", "伤害", SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET, null, 0,
                    new SkillEffectValueRuleResponse(SkillNumericValue.formula(amountFormula), BigDecimal.ONE, null, null),
                    new SkillEffectDamageDetail("physical", SkillEffectDamageDeliveryKind.BASIC_ATTACK,
                        SkillEffectDamageOriginKind.DIRECT, critical, SkillEffectVampQualification.RESOLVED, List.of())),
                new SkillEffectResultResponse("attack_link", "普攻联动", SkillEffectResultType.ATTACK_LINK_APPLICATION,
                    SkillEffectTarget.TARGET, null, 1, null, new SkillEffectAttackLinkApplicationDetail())), null, null);
    }

    private SkillTriggerRuleDetailResponse trigger(String effectKey) throws Exception {
        return json.readValue("""
            {"ruleKey":"on_hit","name":"命中","eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},
             "conditionGroups":[],"actions":[{"actionKey":"deal","name":"伤害","actionType":"EXECUTE_EFFECT",
               "sortOrder":0,"targetContext":"CURRENT_TARGET","detail":{"effectKey":"%s"},
               "runtimeInputBindings":[],"resultModifiers":[]}]}
            """.formatted(effectKey), SkillTriggerRuleDetailResponse.class);
    }

    private SkillTriggerRuleDetailResponse initializationRule(String effectKey) throws Exception {
        var data = json.valueToTree(trigger(effectKey));
        ((com.fasterxml.jackson.databind.node.ObjectNode) data.path("eventSource")).put("eventType", "SOURCE_INITIALIZED");
        return json.treeToValue(data, SkillTriggerRuleDetailResponse.class);
    }

    private static SkillEffectDetailResponse healing(String skillKey, SkillNumericValue value) {
        return new SkillEffectDetailResponse("lol", skillKey, "heal", "恢复", null, 0,
            List.of(new SkillEffectResultResponse("amount", "恢复量", SkillEffectResultType.DIRECT_HEAL,
                SkillEffectTarget.SOURCE, null, 0, new SkillEffectValueRuleResponse(value, BigDecimal.ONE, null, null),
                new SkillEffectDirectHealDetail())), null, null);
    }

    private SkillParameterResponse parameter(SkillParameterValueMode mode, BigDecimal fixed, Map<String, BigDecimal> levels) {
        return new SkillParameterResponse("lol", "shared_basic_attack", "p", "参数", SkillParameterValueType.DECIMAL,
            mode, fixed, levels, null, 0, null, null);
    }

    private void assertIssue(String code, String field) {
        assertIssue(CHOICE, code, field);
    }

    private void assertIssue(Selection choice, String code, String field) {
        ApiException error = assertThrows(ApiException.class, () -> service.get("lol", choice));
        assertEquals(HttpStatus.CONFLICT, error.getStatus());
        assertEquals("409.SIMULATION_SNAPSHOT_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains(code), error.getDetails().toString());
        assertTrue(error.getDetails().toString().contains(field), error.getDetails().toString());
    }
}
