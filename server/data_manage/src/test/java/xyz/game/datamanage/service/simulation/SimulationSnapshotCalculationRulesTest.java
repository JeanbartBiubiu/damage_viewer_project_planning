package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.calculation.GameCalculationRulesResponse;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotCalculationRulesTest {
    private SimulationSnapshotFixture fixture;
    private static final String GAME = SimulationSnapshotFixture.GAME;

    @BeforeEach void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        for (String key : new String[] {"renamed_probability", "renamed_velocity", "renamed_growth", "unused_factor"}) {
            when(fixture.attributes.get(GAME, key)).thenReturn(attribute(key, AttributeStatus.ENABLED));
        }
        configuration(configuration());
    }

    @Test void transportsCompleteResponseAndAllDeclarationsWithoutFixedAliasesOrInventedValues() {
        var snapshot = fixture.service.get(GAME, fixture.choice());
        assertEquals(configuration(), snapshot.catalogs().calculationRules().configuration());
        for (String key : new String[] {"renamed_probability", "renamed_velocity", "renamed_growth", "unused_factor"}) {
            assertTrue(snapshot.catalogs().attributes().stream().anyMatch(attribute -> attribute.attributeKey().equals(key)), key);
            assertFalse(snapshot.source().selectedLevelValues().has(key));
            assertFalse(snapshot.target().selectedLevelValues().has(key));
        }
        verify(fixture.attributes, never()).get(GAME, "critical_strike_chance");
        verify(fixture.attributes, never()).get(GAME, "attack_speed");
        verify(fixture.attributes, never()).get(GAME, "attack_speed_ratio");
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
}
