package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;

class SimulationSnapshotReceivedCooldownDormancyTest {
    private SimulationSnapshotFixture fixture;

    @BeforeEach void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, "defense_spell");
        fixture.attach("hero_b", ATTACK, "defense_spell");
        ObjectNode graph = (ObjectNode) fixture.json.readTree(ReceivedCooldownMaintenanceSnapshotRulesTest.MAINTENANCE);
        ((ArrayNode) graph.path("effects")).add(fixture.json.readTree("""
            {"effectKey":"passive","name":"永久自身属性","lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},
              "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE","reapplicationStackMode":"KEEP",
              "reapplicationDurationMode":null,"expiryMode":"EXPLICIT_ONLY","periodicIntervalValue":null,"firstPeriodicExecution":null},
             "results":[{"resultKey":"bonus","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE","spellShieldBlockScope":null,
               "valueRule":{"value":{"kind":"FIXED","value":1},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
               "detail":{"attributeKey":"health","operation":"INCREASE","modifierZoneKey":"bonus_zone"},
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"MOMENT_EVALUATION","stackValueMode":"SHARED","reapplicationValueMode":null,"periodicExecutionMode":null}}]}
            """));
        ((ArrayNode) graph.path("triggerRules")).add(fixture.json.readTree("""
            {"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],"actions":[
              {"actionKey":"passive","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE","detail":{"effectKey":"passive"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """));
        ((ArrayNode) graph.path("triggerRules")).add(fixture.json.readTree("""
            {"ruleKey":"on_used","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"defense_spell","castPhase":"INITIAL","useKind":"ACTIVE"}},
             "conditionGroups":[],"actions":[{"actionKey":"cast","actionType":"START_PROCESS","targetContext":"CURRENT_TARGET",
               "detail":{"processKey":"cast"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """));
        graph.set("processes", fixture.json.readTree("""
            [{"processKey":"cast","activationType":"ACTIVE","cooldown":{"durationValue":{"kind":"FIXED","value":3000},"startMoment":{"momentType":"PROCESS_START"}},
              "steps":[{"stepKey":"instant","stepType":"IMMEDIATE","detail":{},"occupiesAction":false}],"effectBindings":[],"stateOperations":[]}]
            """));
        fixture.configuration("defense_spell", 5, graph.toString());
    }

    private SimulationSnapshotResponse snapshot(String attack, boolean planned) {
        var settings = List.of(new SkillSetting(Origin.character("hero_a"), "defense_spell", true, 5));
        return fixture.service.get(GAME, new Selection("hero_a", 1, "hero_b", 2, attack, attack == null ? null : 1,
            List.of(), List.of(), List.of(), List.of(), settings,
            List.of(new SkillSetting(Origin.character("hero_b"), "defense_spell", true, 5)),
            planned ? List.of(new PlannedSkill(Origin.character("hero_a"), "defense_spell", 5, List.of("INITIAL"))) : List.of()));
    }

    @Test void bothOwnersKeepDefenseInitializationButNeitherGetsAReceivedCooldownOperation() {
        var snapshot = snapshot(ATTACK, true);
        var source = snapshot.source().skillSources().stream().filter(row -> row.skillKey().equals("defense_spell")).findFirst().orElseThrow();
        var target = snapshot.target().skillSources().stream().filter(row -> row.skillKey().equals("defense_spell")).findFirst().orElseThrow();
        assertEquals(List.of("initialize", "on_used"), source.enabledRuleKeys());
        assertEquals(List.of("initialize"), target.enabledRuleKeys());
        assertNull(source.inactiveReason()); assertNull(target.inactiveReason());
        assertTrue(snapshot.references().stream().noneMatch(row -> row.sourceSkillKey().equals("defense_spell")
            && (row.sourceKey().equals("received") || row.sourceKey().equals("reduce"))));
        var complete = snapshot.skillConfigurations().stream().filter(row -> row.skill().skillKey().equals("defense_spell")).findFirst().orElseThrow();
        assertEquals(3, complete.triggerRules().size());
        assertTrue(complete.effects().stream().anyMatch(effect -> effect.effectKey().equals("reduce")));
        assertEquals(750, complete.parameters().getFirst().fixedValue().intValueExact());
    }

    @Test void noAttackAndUnplannedStillKeepTheActualInitializationOnly() {
        for (String attack : new String[] {null, ATTACK}) {
            var result = snapshot(attack, false);
            assertEquals(List.of("initialize"), result.source().skillSources().stream().filter(row -> row.skillKey().equals("defense_spell")).findFirst().orElseThrow().enabledRuleKeys());
            assertEquals(List.of("initialize"), result.target().skillSources().stream().filter(row -> row.skillKey().equals("defense_spell")).findFirst().orElseThrow().enabledRuleKeys());
        }
    }
}
