package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.character.CharacterAttributesResponse;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.damagetype.*;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.model.gamevamp.GameVampRule;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryStatus;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skilleffect.*;
import xyz.game.datamanage.model.skillformula.*;
import xyz.game.datamanage.model.skillparameter.*;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.service.attribute.AttributeService;
import xyz.game.datamanage.service.character.CharacterService;
import xyz.game.datamanage.service.damagetype.DamageTypeService;
import xyz.game.datamanage.service.gamevamp.GameVampRuleService;
import xyz.game.datamanage.service.modifierzone.ModifierZoneService;
import xyz.game.datamanage.service.skillcategory.SkillCategoryService;
import xyz.game.datamanage.service.skillconfiguration.SkillConfigurationService;
import xyz.game.datamanage.service.skillrelation.SkillRelationService;
import xyz.game.datamanage.service.status.StatusService;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotServiceTest {
    private static final Selection CHOICE = new Selection("hero_a", 1, "hero_b", 1,
        "shared_basic_attack", 1);

    private final CharacterService characters = mock(CharacterService.class);
    private final CharacterMapper characterMapper = mock(CharacterMapper.class);
    private final SkillRelationService relations = mock(SkillRelationService.class);
    private final SkillConfigurationService configurations = mock(SkillConfigurationService.class);
    private final AttributeService attributes = mock(AttributeService.class);
    private final SkillCategoryService categories = mock(SkillCategoryService.class);
    private final DamageTypeService damageTypes = mock(DamageTypeService.class);
    private final ModifierZoneService zones = mock(ModifierZoneService.class);
    private final StatusService statuses = mock(StatusService.class);
    private final GameVampRuleService vampRules = mock(GameVampRuleService.class);
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private SimulationSnapshotService service;
    private SkillConfigurationResponse skill;

    @BeforeEach
    void setup() throws Exception {
        service = new SimulationSnapshotService(characters, characterMapper, relations,
            configurations, attributes, categories, damageTypes, zones, statuses, vampRules, json);
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
        DamageTypeCalculationFormula formula = new DamageTypeCalculationFormula(
            new DamageTypeFormulaAttributeNode(
                xyz.game.datamanage.model.skillformula.AttributeOwner.TARGET,
                "armor", xyz.game.datamanage.model.skillformula.AttributeValueKind.TOTAL),
            fixed(0), fixed(0), fixed(0), fixed(1));
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
    void rejectsCrossSkillReferenceAtItsSavedField() throws Exception {
        var crossSkill = json.readValue("""
            {"ruleKey":"on_hit","eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"other_skill"}},
             "conditionGroups":[],"actions":[]}
            """, SkillTriggerRuleDetailResponse.class);
        configure(new SkillConfigurationResponse(skill.skill(), skill.parameters(), skill.formulas(), skill.effects(),
            List.of(), List.of(), List.of(crossSkill), "skill-digest"));
        ApiException error = assertThrows(ApiException.class, () -> service.get("lol", CHOICE));
        assertTrue(error.getDetails().toString().contains("CROSS_SKILL_NOT_SUPPORTED"));
        assertTrue(error.getDetails().toString().contains("eventSource.detail.sourceSkillKey"));
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
    void incompleteFiveStageFormulaCannotProducePartialSuccessfulSnapshot() {
        damageFormula(new DamageTypeCalculationFormula(fixed(0), fixed(0), fixed(0), fixed(0), null));
        assertIssue("FORMULA_MISSING", "catalogs.damageTypes.physical.formula");
    }

    @Test
    void missingSceneSupplementalValuesStayAbsentWhileTheirDefinitionsReturn() {
        for (String key : List.of("critical_strike_chance", "critical_strike_damage_bonus_percent",
            "armor_pen_percent", "life_steal_percent")) attribute(key);
        configure(new SkillConfigurationResponse(skill.skill(), skill.parameters(),
            List.of(formula("amount", "attack_damage"), formula("crit_multiplier", "critical_strike_damage_bonus_percent")),
            List.of(effect(new SkillEffectCriticalPolicy(SkillEffectCriticalMode.SOURCE_CRIT_CHANCE,
                SkillNumericValue.formula("crit_multiplier")), "amount")),
            List.of(), List.of(), skill.triggerRules(), "skill-digest"));
        damageFormula(new DamageTypeCalculationFormula(
            new DamageTypeFormulaAttributeNode(AttributeOwner.TARGET, "armor", AttributeValueKind.TOTAL),
            new DamageTypeFormulaAttributeNode(AttributeOwner.SOURCE, "armor_pen_percent", AttributeValueKind.TOTAL),
            fixed(0), fixed(0), fixed(1)));
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
        assertThrows(ApiException.class, () -> service.get("lol", new Selection("hero_a", 0, "hero_b", 1, "shared_basic_attack", 1)));
        assertThrows(ApiException.class, () -> service.get("lol", new Selection("hero_a", 1, "hero_b", 1, "other_skill", 1)));
        verifyNoInteractions(configurations);
    }

    @Test
    void selectedParameterNumberIsRequiredWhileRuntimeInputKeepsNoDefault() {
        configure(new SkillConfigurationResponse(skill.skill(), List.of(parameter(SkillParameterValueMode.FIXED, null, null)),
            skill.formulas(), skill.effects(), List.of(), List.of(), skill.triggerRules(), "skill-digest"));
        assertIssue("NUMBER_MISSING", "parameters.p.fixedValue");
        configure(new SkillConfigurationResponse(skill.skill(), List.of(parameter(SkillParameterValueMode.SKILL_LEVEL, null, Map.of("2", BigDecimal.ONE))),
            skill.formulas(), skill.effects(), List.of(), List.of(), skill.triggerRules(), "skill-digest"));
        assertIssue("NUMBER_MISSING", "parameters.p.levelValues.1");
        configure(new SkillConfigurationResponse(skill.skill(), List.of(parameter(SkillParameterValueMode.RUNTIME_INPUT, null, null)),
            skill.formulas(), skill.effects(), List.of(), List.of(), skill.triggerRules(), "skill-digest"));
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
        damageFormula(new DamageTypeCalculationFormula(fixed(0), fixed(0), fixed(0), fixed(0), fixed(2)));
        assertNotEquals(changedActor, service.get("lol", CHOICE).snapshotDigest());
        assertEquals("skill-digest", skill.baseDigest());
    }

    private static DamageTypeFormulaFixedNode fixed(int value) {
        return new DamageTypeFormulaFixedNode(BigDecimal.valueOf(value));
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

    private void damageFormula(DamageTypeCalculationFormula formula) {
        when(damageTypes.getFormula("lol", "physical")).thenReturn(new DamageTypeFormulaResponse("lol", "physical", formula, null));
    }

    private SkillFormulaDetailResponse formula(String key, String attribute) {
        return new SkillFormulaDetailResponse("lol", "shared_basic_attack", key, key, null, 0,
            new SkillFormulaAttributeNode(AttributeOwner.SOURCE, attribute, AttributeValueKind.TOTAL), null, null);
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

    private SkillParameterResponse parameter(SkillParameterValueMode mode, BigDecimal fixed, Map<String, BigDecimal> levels) {
        return new SkillParameterResponse("lol", "shared_basic_attack", "p", "参数", SkillParameterValueType.DECIMAL,
            mode, fixed, levels, null, 0, null, null);
    }

    private void assertIssue(String code, String field) {
        ApiException error = assertThrows(ApiException.class, () -> service.get("lol", CHOICE));
        assertEquals("409.SIMULATION_SNAPSHOT_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains(code), error.getDetails().toString());
        assertTrue(error.getDetails().toString().contains(field), error.getDetails().toString());
    }
}
