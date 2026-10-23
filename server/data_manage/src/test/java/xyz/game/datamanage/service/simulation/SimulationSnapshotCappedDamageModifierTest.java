package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.attribute.*;
import xyz.game.datamanage.model.damagetype.*;
import xyz.game.datamanage.model.modifierzone.*;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotCappedDamageModifierTest {
    private SimulationSnapshotFixture fixture;

    @BeforeEach void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, "defense_spell");
        when(fixture.zones.get(GAME, "flat_pre")).thenReturn(new ModifierZoneResponse(GAME, "flat_pre", "防御前平减", ModifierZoneDomain.DAMAGE,
            ModifierZoneCalculationMode.FLAT_ADD, ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE, null, ModifierZoneStatus.ENABLED, 0, null, null));
        for (String key : List.of("defense_a", "defense_b")) when(fixture.attributes.get(GAME, key)).thenReturn(new AttributeResponse(GAME, key, key,
            AttributeValueType.DECIMAL, BigDecimal.ZERO, null, null, AttributeStatus.ENABLED, 0, null, null));
        DamageTypeResponse first = type("hit_type", DamageTypeStatus.ENABLED), second = type("other_type", DamageTypeStatus.ENABLED), real = type("unmitigated_type", DamageTypeStatus.ENABLED);
        when(fixture.damageTypes.list(eq(GAME), any(DamageTypeListQuery.class))).thenReturn(new DamageTypeListResponse(List.of(first, second, real), 3));
        for (var type : List.of(first, second, real)) when(fixture.damageTypes.get(GAME, type.damageTypeKey())).thenReturn(type);
        when(fixture.damageTypes.getFormula(GAME, "hit_type")).thenReturn(formula("hit_type", "defense_a"));
        when(fixture.damageTypes.getFormula(GAME, "other_type")).thenReturn(formula("other_type", "defense_b"));
        when(fixture.damageTypes.getFormula(GAME, "unmitigated_type")).thenReturn(formula("unmitigated_type", null));
        fixture.configuration("defense_spell", 5, """
            {"parameters":[],"formulas":[{"formulaKey":"points","expression":{"inputs":[
              {"key":"a","binding":{"kind":"attribute","object":"source","view":"current_frame","valueKind":"BONUS","attributeKey":"defense_a"}},
              {"key":"b","binding":{"kind":"attribute","object":"source","view":"current_frame","valueKind":"BONUS","attributeKey":"defense_b"}}],
              "stages":[{"key":"out","name":"点数","expression":{"op":"add","args":[{"op":"read","inputKey":"a"},{"op":"read","inputKey":"b"}]}}],"outputStageKey":"out"}}],
             "effects":[{"effectKey":"defense","lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},"applicationStacksValue":{"kind":"FIXED","value":1},
               "instanceScope":"SOURCE","reapplicationStackMode":"KEEP","reapplicationDurationMode":null,"expiryMode":"EXPLICIT_ONLY","periodicIntervalValue":null,"firstPeriodicExecution":null},
              "results":[{"resultKey":"flat","resultType":"DAMAGE_MODIFIER","target":"SOURCE","spellShieldBlockScope":null,
               "valueRule":{"value":{"kind":"FORMULA","formulaKey":"points"},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},
               "detail":{"modifierZoneKey":"flat_pre","direction":"TAKEN","operation":"DECREASE","damageTypeKey":"hit_type","deliveryKind":"ANY","originKind":"ANY","criticalFilter":"ANY",
                 "condition":null,"maximumReductionRatioValue":{"kind":"FIXED","value":0.5}},
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"MOMENT_EVALUATION","stackValueMode":"SHARED","reapplicationValueMode":null,"periodicExecutionMode":null}}]}],
             "triggerRules":[{"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],"actions":[
              {"actionKey":"defense","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE","detail":{"effectKey":"defense"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
    }

    private DamageTypeResponse type(String key, DamageTypeStatus status) {
        return new DamageTypeResponse(GAME, key, key, null, status, 0, null, null, true);
    }
    private DamageTypeFormulaResponse formula(String key, String defense) {
        JsonNode expression = AggregateJson.tree(defense == null ? "{\"op\":\"const\",\"value\":\"1\"}" : "{\"op\":\"read\",\"inputKey\":\"resistance\"}");
        var data = fixture.json.createObjectNode();
        var inputs = data.putArray("inputs");
        if (defense != null) inputs.addObject().put("key", "resistance").putObject("binding").put("kind", "attribute").put("object", "target")
            .put("attributeKey", defense).put("valueKind", "TOTAL").put("view", "current_frame");
        data.putArray("stages").addObject().put("key", "out").put("name", "真实结算").set("expression", expression);
        data.put("outputStageKey", "out");
        return new DamageTypeFormulaResponse(GAME, key, data, null);
    }
    private Selection choice() {
        var old = fixture.choice();
        return new Selection(old.sourceCharacterKey(), old.sourceLevel(), old.targetCharacterKey(), old.targetLevel(), old.basicAttackSkillKey(), old.basicAttackLevel(),
            List.of(), List.of(), List.of(), List.of(), List.of(new SkillSetting(Origin.character("hero_a"), "defense_spell", true, 1)), List.of(), List.of());
    }

    @Test void aPhysicalOnlyExecutionStillReceivesBothRealDefenseDefinitionsWithoutNewExecutionReferences() {
        var result = fixture.service.get(GAME, choice());
        assertEquals(List.of("hit_type", "other_type", "unmitigated_type"), result.catalogs().damageTypes().stream().map(row -> row.type().damageTypeKey()).toList());
        assertTrue(result.references().stream().noneMatch(row -> row.sourceType().equals("DAMAGE_TYPE") && !row.sourceKey().equals("hit_type")));
        assertTrue(result.references().stream().filter(row -> row.targetType().equals("DAMAGE_TYPE")).allMatch(row -> row.targetKey().equals("hit_type")));
        assertEquals(List.of("initialize"), result.source().skillSources().stream().filter(row -> row.skillKey().equals("defense_spell")).findFirst().orElseThrow().enabledRuleKeys());
        assertEquals(2, result.skillConfigurations().size());
    }

    @ParameterizedTest @ValueSource(strings = {"disabled", "bad_formula", "unused_declaration", "foreign"})
    void nonExecutableDefinitionsDoNotGrantUnprovenBonusAttributes(String failure) {
        switch (failure) {
            case "disabled" -> when(fixture.damageTypes.get(GAME, "other_type")).thenReturn(type("other_type", DamageTypeStatus.DISABLED));
            case "bad_formula" -> when(fixture.damageTypes.getFormula(GAME, "other_type")).thenReturn(new DamageTypeFormulaResponse(GAME, "other_type", AggregateJson.tree("{}"), null));
            case "foreign" -> when(fixture.damageTypes.getFormula(GAME, "other_type")).thenReturn(new DamageTypeFormulaResponse("other_game", "other_type", formula("other_type", "defense_b").formula(), null));
            case "unused_declaration" -> {
                var definition = (com.fasterxml.jackson.databind.node.ObjectNode) formula("other_type", "defense_b").formula();
                ((com.fasterxml.jackson.databind.node.ObjectNode) definition.path("stages").get(0)).set("expression", AggregateJson.tree("{\"op\":\"const\",\"value\":\"1\"}"));
                when(fixture.damageTypes.getFormula(GAME, "other_type")).thenReturn(new DamageTypeFormulaResponse(GAME, "other_type", definition, null));
            }
            default -> fail(failure);
        }
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice()), failure);
    }

    @Test void hiddenPointParameterDeclarationsStillNeedTheActualSelectedCharacterLevel() throws Exception {
        var original = fixture.configurations.get(GAME, "defense_spell");
        var data = (com.fasterxml.jackson.databind.node.ObjectNode) fixture.json.valueToTree(original);
        data.withArray("parameters").add(fixture.json.readTree("""
            {"gameId":"scenario","skillKey":"defense_spell","parameterKey":"unused_static","valueType":"DECIMAL","valueMode":"CHARACTER_LEVEL",
             "fixedValue":null,"levelValues":{"2":1},"name":"静态声明","sortOrder":0}
            """));
        ((com.fasterxml.jackson.databind.node.ArrayNode) data.path("formulas").get(0).path("expression").path("inputs")).add(fixture.json.readTree("""
            {"key":"unused","binding":{"kind":"parameter","skillKey":"defense_spell","parameterKey":"unused_static"}}
            """));
        fixture.configuration("defense_spell", 5, data.toString());
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice()));
    }
}
