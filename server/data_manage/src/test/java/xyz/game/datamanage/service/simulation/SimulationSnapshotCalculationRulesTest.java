package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.calculation.GameCalculationRulesResponse;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryStatus;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.InactiveReason;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotCalculationRulesTest {
    private SimulationSnapshotFixture fixture;
    private static final String GAME = SimulationSnapshotFixture.GAME;

    @BeforeEach void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        for (String key : new String[] {"renamed_probability", "renamed_velocity", "renamed_growth", "unused_factor", "custom_cost"}) {
            when(fixture.attributes.get(GAME, key)).thenReturn(attribute(key, AttributeStatus.ENABLED));
        }
        for (String key : new String[] {"renamed_attack", "renamed_passive"}) {
            when(fixture.categories.get(GAME, key)).thenReturn(category(GAME, key, SkillCategoryStatus.ENABLED));
        }
        category(SimulationSnapshotFixture.ATTACK, "renamed_attack");
        configuration(configuration());
    }

    @Test void transportsCompleteResponseAndAllDeclarationsWithoutFixedAliasesOrInventedValues() {
        var snapshot = fixture.service.get(GAME, fixture.choice());
        assertEquals(configuration(), snapshot.catalogs().calculationRules().configuration());
        for (String key : new String[] {"renamed_probability", "renamed_velocity", "renamed_growth", "unused_factor", "custom_cost"}) {
            assertTrue(snapshot.catalogs().attributes().stream().anyMatch(attribute -> attribute.attributeKey().equals(key)), key);
            assertFalse(snapshot.source().selectedLevelValues().has(key));
            assertFalse(snapshot.target().selectedLevelValues().has(key));
        }
        verify(fixture.attributes, never()).get(GAME, "critical_strike_chance");
        verify(fixture.attributes, never()).get(GAME, "attack_speed");
        verify(fixture.attributes, never()).get(GAME, "attack_speed_ratio");
        assertEquals(List.of("renamed_attack", "renamed_passive"), snapshot.catalogs().skillCategories().stream()
            .map(SkillCategoryResponse::skillCategoryKey).toList());
        verify(fixture.categories, never()).get(GAME, "basic_attack");
        verify(fixture.categories, never()).get(GAME, "passive");
        assertTrue(snapshot.references().stream().noneMatch(reference -> reference.targetKey().equals("custom_cost")));
    }

    @Test void completeFormulaAndExplicitMinimumParticipateInSnapshotDigest() {
        String first = fixture.service.get(GAME, fixture.choice()).snapshotDigest();
        ObjectNode changed = configuration();
        ((ObjectNode) changed.at("/attributeDerivations/0/formula/stages/0/expression")).put("value", "2.000");
        configuration(changed);
        String formulaDigest = fixture.service.get(GAME, fixture.choice()).snapshotDigest();
        assertNotEquals(first, formulaDigest);
        changed.put("criticalMultiplierMin", 0);
        configuration(changed);
        assertNotEquals(formulaDigest, fixture.service.get(GAME, fixture.choice()).snapshotDigest());
    }

    @Test void declaredUnusedInputAndActivationMustStillHaveEnabledDirectoryIdentity() {
        when(fixture.attributes.get(GAME, "unused_factor")).thenReturn(attribute("unused_factor", AttributeStatus.DISABLED));
        assertIssue("REFERENCE_DISABLED", "catalogs.calculationRules.configuration.attributeDerivations[0].formula/inputs/1/binding/attributeKey");
        when(fixture.attributes.get(GAME, "unused_factor")).thenReturn(attribute("unused_factor", AttributeStatus.ENABLED));
        when(fixture.attributes.get(GAME, "renamed_growth")).thenReturn(attribute("renamed_growth", AttributeStatus.DISABLED));
        assertIssue("REFERENCE_DISABLED", "catalogs.calculationRules.configuration.attributeDerivations[0].activationAttributeKeys[0]");
    }

    @Test void absentConfigurationCannotYieldASnapshotWithLegacyDefaults() {
        when(fixture.calculationRules.get(GAME)).thenReturn(new GameCalculationRulesResponse(GAME, "a".repeat(64), null));
        assertIssue("CONFIGURATION_MISSING", "catalogs.calculationRules.configuration");
    }

    @Test void missingAttackBindingAndTheOldClassificationCannotAdmitASelectedAttack() throws Exception {
        ObjectNode changed = configuration();
        changed.putNull("basicAttackCategoryKey");
        configuration(changed);
        assertIssue("CATEGORY_BINDING_MISSING", "catalogs.calculationRules.configuration.basicAttackCategoryKey");
        configuration(configuration());
        category(SimulationSnapshotFixture.ATTACK, "basic_attack");
        assertIssue("BASIC_ATTACK_CATEGORY_REQUIRED", "basicAttackSkillKey");
    }

    @Test void sourceClosureUsesTheActualClassificationBindingAndTreatsTheOldKeyAsOrdinary() throws Exception {
        fixture.attach("hero_b", SimulationSnapshotFixture.ATTACK, "old_category_skill");
        fixture.configuration("old_category_skill", 1, "{}");
        category("old_category_skill", "basic_attack");
        var snapshot = fixture.service.get(GAME, fixture.choice());
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, snapshot.target().skillSources().stream()
            .filter(source -> source.skillKey().equals(SimulationSnapshotFixture.ATTACK)).findFirst().orElseThrow().inactiveReason());
        assertEquals(InactiveReason.CONFIGURATION_INCOMPLETE, snapshot.target().skillSources().stream()
            .filter(source -> source.skillKey().equals("old_category_skill")).findFirst().orElseThrow().inactiveReason());
    }

    @Test void unusedClassificationAndCostDeclarationsStillRequireRealEnabledScopedDirectories() {
        when(fixture.categories.get(GAME, "renamed_passive")).thenReturn(category(GAME, "renamed_passive", SkillCategoryStatus.DISABLED));
        assertIssue("REFERENCE_DISABLED", "catalogs.calculationRules.configuration.equipmentPassiveCategoryKey");
        when(fixture.categories.get(GAME, "renamed_passive")).thenReturn(category("foreign_game", "renamed_passive", SkillCategoryStatus.ENABLED));
        assertIssue("REFERENCE_OUT_OF_SCOPE", "catalogs.calculationRules.configuration.equipmentPassiveCategoryKey");
        when(fixture.categories.get(GAME, "renamed_passive")).thenReturn(category(GAME, "wrong_identity", SkillCategoryStatus.ENABLED));
        assertIssue("REFERENCE_OUT_OF_SCOPE", "catalogs.calculationRules.configuration.equipmentPassiveCategoryKey");
        when(fixture.categories.get(GAME, "renamed_passive")).thenReturn(category(GAME, "renamed_passive", SkillCategoryStatus.ENABLED));
        when(fixture.attributes.get(GAME, "custom_cost")).thenReturn(attribute("custom_cost", AttributeStatus.DISABLED));
        assertIssue("REFERENCE_DISABLED", "catalogs.calculationRules.configuration.ignorableCastCostAttributeKeys[0]");
    }

    @Test void pureAttributeSceneAllowsBothUnconsumedClassificationsToRemainUnbound() throws Exception {
        ObjectNode changed = configuration();
        changed.putNull("basicAttackCategoryKey").putNull("equipmentPassiveCategoryKey");
        configuration(changed);
        fixture.attach("hero_a");
        fixture.attach("hero_b");
        fixture.equipment("attributes_only");
        Selection choice = new Selection("hero_a", 1, "hero_b", 2, null, null, List.of("attributes_only"), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of());
        var snapshot = fixture.service.get(GAME, choice);
        assertTrue(snapshot.skillConfigurations().isEmpty());
        assertTrue(snapshot.catalogs().skillCategories().isEmpty());
        assertFalse(snapshot.source().selectedLevelValues().has("custom_cost"));
    }

    @Test void everyNewBindingAndItsTransportedDirectoryParticipateInTheSnapshotDigest() {
        String first = fixture.service.get(GAME, fixture.choice()).snapshotDigest();
        ObjectNode changed = configuration();
        changed.putNull("equipmentPassiveCategoryKey");
        configuration(changed);
        String unbound = fixture.service.get(GAME, fixture.choice()).snapshotDigest();
        assertNotEquals(first, unbound);
        changed.putArray("ignorableCastCostAttributeKeys");
        configuration(changed);
        String costsRemoved = fixture.service.get(GAME, fixture.choice()).snapshotDigest();
        assertNotEquals(unbound, costsRemoved);
        when(fixture.categories.get(GAME, "renamed_attack")).thenReturn(new SkillCategoryResponse(GAME,
            "renamed_attack", "新分类名称", null, SkillCategoryStatus.ENABLED, 0, null, null));
        assertNotEquals(costsRemoved, fixture.service.get(GAME, fixture.choice()).snapshotDigest());
    }

    @Test void unreadableConfigurationStopsBeforeLegacyClassificationOrSourceClosure() {
        clearInvocations(fixture.configurations, fixture.calculationRules);
        when(fixture.calculationRules.get(GAME)).thenThrow(new IllegalStateException("isolated read failure"));
        assertIssue("INVALID_STORED_DATA", "catalogs.calculationRules");
        verifyNoInteractions(fixture.configurations);
    }

    @Test void malformedAndUnauthorizedDefinitionsKeepTheSharedErrorAndConfigurationLocation() {
        ObjectNode changed = configuration();
        ((ObjectNode) changed.at("/attributeDerivations/0/formula/inputs/0/binding")).put("object", "target");
        configuration(changed);
        assertIssue("FORMULA_UNKNOWN_BINDING", "catalogs.calculationRules/configuration/attributeDerivations/0/formula/inputs/0/binding");
        changed = configuration();
        changed.put("unknown", 1);
        configuration(changed);
        assertIssue("UNKNOWN_FIELD", "catalogs.calculationRules/configuration/unknown");
    }

    private void assertIssue(String code, String field) {
        ApiException error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, fixture.choice()));
        assertEquals("409.SIMULATION_SNAPSHOT_INVALID", error.getCode());
        var issue = (Map<?, ?>) ((java.util.List<?>) error.getDetails().get("fieldIssues")).getFirst();
        assertEquals(code, issue.get("code"));
        assertEquals(field, issue.get("field"));
    }

    private void configuration(ObjectNode configuration) {
        when(fixture.calculationRules.get(GAME)).thenReturn(new GameCalculationRulesResponse(GAME, "a".repeat(64), configuration));
    }

    private static ObjectNode configuration() {
        return (ObjectNode) AggregateJson.tree("""
            {"criticalChanceAttributeKey":"renamed_probability","criticalMultiplierMin":1,"attackSpeedAttributeKey":"renamed_velocity",
             "basicAttackCategoryKey":"renamed_attack","equipmentPassiveCategoryKey":"renamed_passive","ignorableCastCostAttributeKeys":["custom_cost"],
             "attributeDerivations":[{"ruleKey":"custom_rule","attributeKey":"renamed_velocity","valuePolicy":"set",
               "activationAttributeKeys":["renamed_growth"],"formula":{
                 "inputs":[{"key":"growth","binding":{"kind":"attribute","object":"source","attributeKey":"renamed_growth","valueKind":"TOTAL","view":"current_frame"}},
                   {"key":"factor","binding":{"kind":"attribute","object":"source","attributeKey":"unused_factor","valueKind":"BASE","view":"current_frame"}}],
                 "stages":[{"key":"result","name":"新结果","expression":{"op":"const","value":"1.000"}}],"outputStageKey":"result"}}]}
            """);
    }

    private static AttributeResponse attribute(String key, AttributeStatus status) {
        return new AttributeResponse(GAME, key, key, AttributeValueType.DECIMAL, BigDecimal.valueOf(-100), null, null, status, 0, null, null);
    }

    private static SkillCategoryResponse category(String game, String key, SkillCategoryStatus status) {
        return new SkillCategoryResponse(game, key, key, null, status, 0, null, null);
    }

    private void category(String skillKey, String key) {
        var original = fixture.configurations.get(GAME, skillKey);
        var skill = original.skill();
        var response = new SkillConfigurationResponse(new SkillResponse(skill.gameId(), skill.skillKey(), skill.name(), skill.description(),
            skill.maxLevel(), skill.status(), skill.sortOrder(), List.of(key), skill.createdAt(), skill.updatedAt()),
            original.parameters(), original.formulas(), original.effects(), original.processes(), original.internalStates(), original.triggerRules(), original.baseDigest());
        when(fixture.configurations.get(GAME, skillKey)).thenReturn(response);
    }
}
