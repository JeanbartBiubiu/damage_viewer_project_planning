package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillAttackStartValueSemanticsTest {
    @ParameterizedTest @ValueSource(strings = {"BASIC_ATTACK_START", "BASIC_ATTACK_HIT", "SKILL_HIT"})
    void acceptsNaturalOwnedCounterAndRetainsOriginalAmmoReading(String event) {
        var state = state(event.equals("SKILL_HIT") ? "AMMO" : "COUNTER");
        assertDoesNotThrow(() -> SkillAttackStartValueSemantics.validate(List.of(rule(event)), List.of(state)));
    }

    @ParameterizedTest @ValueSource(strings = {"TARGET", "AMMO", "FLAG", "FOREIGN_STATE", "FOREIGN_HIT", "BASIC_ATTACK_RECEIVED", "SOURCE_INITIALIZED"})
    void finalStateOrRuleMutationsCannotOpenOtherSnapshotReads(String scenario) {
        var state = state("COUNTER");
        var rule = rule("BASIC_ATTACK_HIT");
        switch (scenario) {
            case "TARGET" -> ((ObjectNode) state.data()).put("scope", "TARGET");
            case "AMMO", "FLAG" -> ((ObjectNode) state.data()).put("stateType", scenario);
            case "FOREIGN_STATE" -> ((ObjectNode) rule.data().path("conditionGroups").get(0).path("conditions").get(0).path("detail")).put("stateSkillKey", "other");
            case "FOREIGN_HIT" -> ((ObjectNode) rule.data().path("eventSource").path("detail")).put("sourceSkillKey", "other");
            default -> ((ObjectNode) rule.data().path("eventSource")).put("eventType", scenario);
        }
        assertEquals("409.SKILL_ATTACK_START_VALUE_INVALID", assertThrows(ApiException.class,
            () -> SkillAttackStartValueSemantics.validate(List.of(rule), List.of(state))).getCode());
    }

    @Test void ordinaryCurrentValueReadsAreUnchanged() {
        var rule = rule("SOURCE_INITIALIZED");
        ((ObjectNode) rule.data().path("conditionGroups").get(0).path("conditions").get(0).path("detail")).put("valueKind", "VALUE");
        assertDoesNotThrow(() -> SkillAttackStartValueSemantics.validate(List.of(rule), List.of()));
    }

    private static Aggregate state(String type) {
        return new Aggregate(SourceType.STATE, "spell", "counter", AggregateJson.tree("{\"scope\":\"SKILL\",\"stateType\":\"" + type + "\",\"detail\":{}}"));
    }
    private static Aggregate rule(String event) {
        return new Aggregate(SourceType.TRIGGER, "spell", "consume", AggregateJson.tree("""
            {"eventSource":{"eventType":"%s","detail":{}},"conditionGroups":[{"conditions":[{"conditionType":"INTERNAL_STATE_CHECK",
              "detail":{"stateSkillKey":"spell","stateKey":"counter","valueKind":"ATTACK_START_VALUE"}}]}]}
            """.formatted(event)));
    }
}
