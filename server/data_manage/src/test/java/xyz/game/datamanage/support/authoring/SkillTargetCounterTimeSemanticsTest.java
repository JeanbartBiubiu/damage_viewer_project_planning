package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillTargetCounterTimeSemanticsTest {
    private static final String OWNER = "mark_owner";

    @Test void naturalOwnerMayProtectItsOwnTargetStateWhenAnExplicitSiblingStarts() {
        var rule = rule();
        assertEquals("actual_active", rule.data().path("eventSource").path("detail").path("sourceSkillKey").asText());
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(state(), rule), List.of()));
        assertDoesNotThrow(() -> AggregateJson.read(AggregateJson.write(rule.data().path("actions").get(0)),
            xyz.game.datamanage.model.skilltrigger.SkillTriggerAction.class));
    }

    @ParameterizedTest @ValueSource(longs = {0, 1, 999, 1000, 1249, 1250, 9007199254740991L})
    void remainingComparisonUsesExactNonNegativeIntegerMilliseconds(long milliseconds) {
        var rule = rule();
        conditionDetail(rule).set("comparisonValue", fixed(BigDecimal.valueOf(milliseconds)));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(state(), rule), List.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"SKILL_SCOPE", "AMMO", "NO_DURATION", "ZERO_DURATION", "NEGATIVE_DURATION", "FRACTIONAL_DURATION", "UNSAFE_DURATION",
        "FOREIGN_OWNER", "WRONG_EVENT", "NO_SOURCE", "PASSIVE_USE", "NO_PHASE", "RECAST", "WRONG_TARGET", "BINDING", "MODIFIER",
        "ZERO_VALUE", "NEGATIVE_VALUE", "FRACTIONAL_VALUE", "UNSAFE_VALUE", "NEGATIVE_COMPARISON", "FRACTIONAL_COMPARISON", "UNSAFE_COMPARISON"})
    void finalStateAndActionMutationsCannotBroadenTheNarrowAuthorization(String change) {
        var state = state(); var rule = rule();
        ObjectNode data = (ObjectNode) state.data(), detail = (ObjectNode) data.path("detail");
        ObjectNode action = action(rule), actionDetail = (ObjectNode) action.path("detail");
        ObjectNode event = (ObjectNode) rule.data().path("eventSource"), source = (ObjectNode) event.path("detail");
        switch (change) {
            case "SKILL_SCOPE" -> data.put("scope", "SKILL");
            case "AMMO" -> data.put("stateType", "AMMO");
            case "NO_DURATION" -> detail.remove("durationValue");
            case "ZERO_DURATION" -> detail.set("durationValue", fixed(BigDecimal.ZERO));
            case "NEGATIVE_DURATION" -> detail.set("durationValue", fixed(BigDecimal.ONE.negate()));
            case "FRACTIONAL_DURATION" -> detail.set("durationValue", fixed(new BigDecimal("1.5")));
            case "UNSAFE_DURATION" -> detail.set("durationValue", fixed(new BigDecimal("9007199254740992")));
            case "FOREIGN_OWNER" -> actionDetail.put("stateSkillKey", "another_owner");
            case "WRONG_EVENT" -> event.put("eventType", "SKILL_HIT");
            case "NO_SOURCE" -> source.remove("sourceSkillKey");
            case "PASSIVE_USE" -> source.put("useKind", "PASSIVE");
            case "NO_PHASE" -> source.remove("castPhase");
            case "RECAST" -> source.put("castPhase", "RECAST");
            case "WRONG_TARGET" -> action.put("targetContext", "EVENT_SOURCE");
            case "BINDING" -> action.withArray("runtimeInputBindings").addObject().put("parameterKey", "forbidden");
            case "MODIFIER" -> action.withArray("resultModifiers").addObject().put("resultKey", "forbidden");
            case "ZERO_VALUE" -> actionDetail.set("value", fixed(BigDecimal.ZERO));
            case "NEGATIVE_VALUE" -> actionDetail.set("value", fixed(BigDecimal.ONE.negate()));
            case "FRACTIONAL_VALUE" -> actionDetail.set("value", fixed(new BigDecimal("0.5")));
            case "UNSAFE_VALUE" -> actionDetail.set("value", fixed(new BigDecimal("9007199254740992")));
            case "NEGATIVE_COMPARISON" -> conditionDetail(rule).set("comparisonValue", fixed(BigDecimal.ONE.negate()));
            case "FRACTIONAL_COMPARISON" -> conditionDetail(rule).set("comparisonValue", fixed(new BigDecimal("0.5")));
            case "UNSAFE_COMPARISON" -> conditionDetail(rule).set("comparisonValue", fixed(new BigDecimal("9007199254740992")));
            default -> throw new IllegalArgumentException(change);
        }
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(state, rule), List.of()));
    }

    @Test void conditionOnlyReferencesStillProtectDurationAndOwnerOnLaterChanges() {
        var state = state(); var rule = rule();
        ((ObjectNode) rule.data()).putArray("actions");
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(state, rule), List.of()));
        conditionDetail(rule).put("stateSkillKey", "another_owner");
        var foreign = new Aggregate(SourceType.STATE, "another_owner", "mark", state.data());
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(state, foreign, rule), List.of()));
        conditionDetail(rule).put("stateSkillKey", OWNER);
        ((ObjectNode) state.data().path("detail")).remove("durationValue");
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(state, rule), List.of()));
    }

    @Test void allDeclaredParameterLevelsMustKeepPositiveSafeIntegerDurationsAndValues() {
        var state = state(); var rule = rule();
        ((ObjectNode) state.data().path("detail")).set("durationValue", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"duration\"}"));
        List<Parameter> parameters = new ArrayList<>(List.of(new Parameter(OWNER, "duration", "INTEGER", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":6000,\"2\":7000}"))));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(state, rule), parameters));
        parameters.set(0, new Parameter(OWNER, "duration", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":6000,\"2\":0}")));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(state, rule), parameters));
        parameters.set(0, new Parameter(OWNER, "duration", "INTEGER", "RUNTIME_INPUT", null, null));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(state, rule), parameters));
    }

    static Aggregate state() {
        return new Aggregate(SourceType.STATE, OWNER, "mark", AggregateJson.tree("""
            {"stateType":"COUNTER","scope":"TARGET","detail":{"initialValue":{"kind":"FIXED","value":0},
             "maxValue":{"kind":"FIXED","value":1},"durationValue":{"kind":"FIXED","value":6000}}}
            """));
    }

    static Aggregate rule() {
        return new Aggregate(SourceType.TRIGGER, OWNER, "protect", AggregateJson.tree("""
            {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"actual_active","useKind":"ACTIVE","castPhase":"INITIAL"}},
             "conditionGroups":[{"conditions":[{"conditionType":"INTERNAL_STATE_CHECK","detail":{"stateSkillKey":"mark_owner","stateKey":"mark",
              "valueKind":"REMAINING_MS","comparator":"LT","comparisonValue":{"kind":"FIXED","value":1000}}}]}],
             "actions":[{"actionKey":"protect","name":"保护标记余时","actionType":"MODIFY_INTERNAL_STATE","sortOrder":0,"targetContext":"CURRENT_TARGET",
              "detail":{"stateSkillKey":"mark_owner","stateKey":"mark","operation":"ENSURE_REMAINING","value":{"kind":"FIXED","value":1250}},
              "runtimeInputBindings":[],"resultModifiers":[]}]}
            """));
    }

    private static ObjectNode action(Aggregate rule) { return (ObjectNode) rule.data().path("actions").get(0); }
    private static ObjectNode conditionDetail(Aggregate rule) { return (ObjectNode) rule.data().path("conditionGroups").get(0).path("conditions").get(0).path("detail"); }
    private static ObjectNode fixed(BigDecimal value) { return ((ObjectNode) AggregateJson.tree("{\"kind\":\"FIXED\"}")).put("value", value); }
}
