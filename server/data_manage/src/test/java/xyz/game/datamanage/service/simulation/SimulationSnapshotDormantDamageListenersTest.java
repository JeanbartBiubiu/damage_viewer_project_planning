package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotDormantDamageListenersTest {
    private SimulationSnapshotFixture fixture;

    @BeforeEach
    void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_b", ATTACK, "subscriber");
        subscriber("\"effects\":[" + heal("restore", "{\"kind\":\"FIXED\",\"value\":1}") + "],\"triggerRules\":[" + listener("restore") + "]");
    }

    @Test
    void completeTargetDamageListenerWithNoOwnProducerRetainsItsBindingWithoutExecutableRoots() {
        var result = fixture.service.get(GAME, choice(true, 1));
        var source = target(result);
        assertTrue(source.enabled());
        assertEquals(1, source.skillLevel());
        assertEquals(InactiveReason.NO_REACHABLE_EVENT, source.inactiveReason());
        assertTrue(source.enabledRuleKeys().isEmpty());
        assertTrue(result.references().stream().noneMatch(row -> row.sourceSkillKey().equals("subscriber")));
        assertEquals(1, result.skillConfigurations().stream().filter(row -> row.skill().skillKey().equals("subscriber")).count());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "\"parameters\":[{\"parameterKey\":\"amount\",\"valueType\":\"DECIMAL\",\"valueMode\":\"FIXED\",\"fixedValue\":1}]",
        "\"triggerRules\":[{\"ruleKey\":\"empty\",\"eventSource\":{\"eventType\":\"DAMAGE_DEALT\",\"detail\":{}},\"conditionGroups\":[],\"actions\":[]}]"})
    void emptyProgramsAndParameterShellsRemainIncomplete(String additions) throws Exception {
        subscriber(additions);
        assertEquals(InactiveReason.CONFIGURATION_INCOMPLETE, target(fixture.service.get(GAME, choice(true, 1))).inactiveReason());
    }

    @ParameterizedTest
    @ValueSource(strings = {"effect", "formula", "parameter"})
    void missingNecessaryLocalReferencesCannotBeClassifiedAsDormant(String missing) throws Exception {
        String value = missing.equals("formula") ? "{\"kind\":\"FORMULA\",\"formulaKey\":\"missing\"}"
            : "{\"kind\":\"PARAMETER\",\"parameterKey\":\"missing\"}";
        subscriber("\"effects\":[" + heal("restore", value) + "],\"triggerRules\":[" + listener(missing.equals("effect") ? "missing" : "restore") + "]");
        ApiException error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(true, 1)));
        assertTrue(error.getDetails().toString().contains("REFERENCE_MISSING"), error.getDetails().toString());
    }

    @Test
    void missingFixedParameterValueStillFailsWithoutRequestingRuntimeInputs() throws Exception {
        subscriber("\"parameters\":[{\"parameterKey\":\"amount\",\"valueType\":\"DECIMAL\",\"valueMode\":\"FIXED\"}],\"effects\":["
            + heal("restore", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"amount\"}") + "],\"triggerRules\":[" + listener("restore") + "]");
        ApiException error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(true, 1)));
        assertTrue(error.getDetails().toString().contains("NUMBER_MISSING"));
    }

    @Test
    void runtimeParameterDeclarationRemainsDormantWithoutInventingAnInput() throws Exception {
        subscriber("\"parameters\":[{\"parameterKey\":\"amount\",\"valueType\":\"DECIMAL\",\"valueMode\":\"RUNTIME_INPUT\"}],\"effects\":["
            + heal("restore", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"amount\"}") + "],\"triggerRules\":[" + listener("restore") + "]");
        assertEquals(InactiveReason.NO_REACHABLE_EVENT, target(fixture.service.get(GAME, choice(true, 1))).inactiveReason());
    }

    @Test
    void missingExternalDefinitionIsNotLoadedOrGrantedByDormancyProof() throws Exception {
        subscriber("\"effects\":[" + heal("restore", "{\"kind\":\"FIXED\",\"value\":1}") + "],\"triggerRules\":["
            + listener("restore").replace("subscriber", "unbound") + "]");
        assertEquals(InactiveReason.CONFIGURATION_INCOMPLETE, target(fixture.service.get(GAME, choice(true, 1))).inactiveReason());
        verify(fixture.configurations, never()).get(GAME, "unbound");
    }

    @Test
    void realInitializationRootCannotBeHiddenAsNoReachableEvent() throws Exception {
        subscriber("\"effects\":[" + heal("restore", "{\"kind\":\"FIXED\",\"value\":1}") + "],\"triggerRules\":["
            + listener("restore") + "," + initialization("initialize", "restore") + "]");
        var source = target(fixture.service.get(GAME, choice(true, 1)));
        assertNull(source.inactiveReason());
        assertEquals(List.of("initialize"), source.enabledRuleKeys());
    }

    @Test
    void knownSiblingSkillDefinitionsDoNotCreateTargetDamageProducers() throws Exception {
        fixture.attach("hero_b", ATTACK, "subscriber", "q", "w", "r");
        for (String skill : List.of("q", "w", "r")) fixture.configuration(skill, 1, "{}");
        subscriber("\"effects\":[" + heal("restore", "{\"kind\":\"FIXED\",\"value\":1}") + "],\"triggerRules\":["
            + listener("restore").replace("on_damage", "q_damage").replace("sourceSkillKey\":\"subscriber", "sourceSkillKey\":\"q") + ","
            + listener("restore").replace("on_damage", "w_damage").replace("sourceSkillKey\":\"subscriber", "sourceSkillKey\":\"w") + ","
            + listener("restore").replace("on_damage", "r_damage").replace("sourceSkillKey\":\"subscriber", "sourceSkillKey\":\"r") + "]");
        var result = fixture.service.get(GAME, choice(true, 1));
        assertEquals(InactiveReason.NO_REACHABLE_EVENT, target(result).inactiveReason());
        assertTrue(result.references().stream().noneMatch(row -> row.sourceSkillKey().equals("subscriber")));
    }

    @Test
    void realAttackReceivedRootRemainsEnabledAlongsideDormantDamageSubscriptions() throws Exception {
        String receive = listener("restore").replace("on_damage", "received")
            .replace("DAMAGE_DEALT", "BASIC_ATTACK_RECEIVED").replace("{\"sourceSkillKey\":\"subscriber\"}", "{}");
        subscriber("\"effects\":[" + heal("restore", "{\"kind\":\"FIXED\",\"value\":1}") + "],\"triggerRules\":["
            + listener("restore") + "," + receive + "]");
        var source = target(fixture.service.get(GAME, choice(true, 1)));
        assertNull(source.inactiveReason());
        assertEquals(List.of("received"), source.enabledRuleKeys());
    }

    @Test
    void unlearnedAndDisabledSourcesKeepTheirOriginalReasons() {
        assertEquals(InactiveReason.UNLEARNED, target(fixture.service.get(GAME, choice(true, 0))).inactiveReason());
        assertEquals(InactiveReason.SCENE_DISABLED, target(fixture.service.get(GAME, choice(false, 1))).inactiveReason());
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(true, 2)));
    }

    private void subscriber(String fields) throws Exception {
        fixture.configuration("subscriber", 1, "{" + fields + "}");
    }

    private Selection choice(boolean enabled, int level) {
        var original = fixture.choice();
        return new Selection(original.sourceCharacterKey(), original.sourceLevel(), original.targetCharacterKey(), original.targetLevel(),
            original.basicAttackSkillKey(), original.basicAttackLevel(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_b"), "subscriber", enabled, level)), List.of());
    }

    private static SkillSource target(SimulationSnapshotResponse result) {
        return result.target().skillSources().stream().filter(row -> row.skillKey().equals("subscriber")).findFirst().orElseThrow();
    }

    private static String listener(String effect) {
        return """
            {"ruleKey":"on_damage","eventSource":{"eventType":"DAMAGE_DEALT","detail":{"sourceSkillKey":"subscriber"}},
             "conditionGroups":[],"actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET",
             "detail":{"effectKey":"%s"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """.formatted(effect);
    }
}
