package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.attribute.*;
import xyz.game.datamanage.model.damagetype.*;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;

class SimulationSnapshotTargetMarkRootsTest {
    private static final String MARK = "lab_mark", SIBLING = "lab_strike";
    private SimulationSnapshotFixture fixture;
    private ObjectNode mark;

    @BeforeEach void setUp() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, MARK, SIBLING); fixture.attach("hero_b", ATTACK, MARK, SIBLING);
        mark = TargetMarkSnapshotRulesTest.configuration(); mark.remove(List.of("skill", "baseDigest")); sanitize(mark);
        configure();
        fixture.configuration(SIBLING, 1, """
            {"processes":[{"processKey":"cast","activationType":"ACTIVE","cooldown":null,
             "steps":[{"stepKey":"execute","stepType":"IMMEDIATE","occupiesAction":false,"detail":{}}],"effectBindings":[],"stateOperations":[]}],
             "triggerRules":[{"ruleKey":"on_used","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"lab_strike","useKind":"ACTIVE","castPhase":"INITIAL"}},
             "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"cast"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        when(fixture.damageTypes.get(GAME, "magic")).thenReturn(new DamageTypeResponse(GAME, "magic", "魔法", null,
            DamageTypeStatus.ENABLED, 0, null, null, true));
        when(fixture.damageTypes.getFormula(GAME, "magic")).thenReturn(new DamageTypeFormulaResponse(GAME, "magic",
            xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition("1"), null));
        for (String key : List.of("ability_power", "mana")) when(fixture.attributes.get(GAME, key)).thenReturn(
            new AttributeResponse(GAME, key, key, AttributeValueType.DECIMAL, BigDecimal.ZERO, null, null, AttributeStatus.ENABLED, 0, null, null));
    }
    private static void sanitize(JsonNode node) {
        if (node.isObject()) {
            ((ObjectNode) node).remove(List.of("createdAt", "updatedAt"));
            if (node.has("gameId")) ((ObjectNode) node).put("gameId", GAME);
        }
        node.forEach(SimulationSnapshotTargetMarkRootsTest::sanitize);
    }
    private void configure() throws Exception { fixture.configuration(MARK, 5, mark.toString()); }
    private Selection selection(List<PlannedSkill> planned) {
        return new Selection("hero_a", 1, "hero_b", 2, ATTACK, 1, List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_a"), MARK, true, 1), new SkillSetting(Origin.character("hero_a"), SIBLING, true, 1)),
            List.of(new SkillSetting(Origin.character("hero_b"), MARK, true, 1), new SkillSetting(Origin.character("hero_b"), SIBLING, true, 1)), planned);
    }
    private PlannedSkill plan(String key) { return new PlannedSkill(Origin.character("hero_a"), key, 1, List.of("INITIAL")); }
    private SkillSource source(SimulationSnapshotResponse response, String side) {
        return (side.equals("source") ? response.source() : response.target()).skillSources().stream()
            .filter(row -> row.skillKey().equals(MARK)).findFirst().orElseThrow();
    }
    @Test void unplannedCompleteMarkIsDormantWithoutChangingItsFullDefinitionOrEnabledSetting() {
        var response = fixture.service.get(GAME, selection(List.of()));
        assertTrue(source(response, "source").enabled());
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(response, "source").inactiveReason());
        assertTrue(source(response, "source").enabledRuleKeys().isEmpty());
        assertEquals(InactiveReason.NO_AUTONOMOUS_ATTACK, source(response, "target").inactiveReason());
        assertTrue(source(response, "target").enabledRuleKeys().isEmpty());
        assertEquals(5, response.skillConfigurations().stream().filter(c -> c.skill().skillKey().equals(MARK)).findFirst().orElseThrow().triggerRules().size());
        assertFalse(response.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(MARK)));
    }
    @Test void anotherPlannedSkillDoesNotEnableUnplannedMarkConsumers() {
        var response = fixture.service.get(GAME, selection(List.of(plan(SIBLING))));
        assertEquals(InactiveReason.ACTIVE_DEFERRED, source(response, "source").inactiveReason());
        assertTrue(source(response, "source").enabledRuleKeys().isEmpty());
    }
    @Test void ownPlanPreservesOwnRealRootsAndNativeAttackConsumer() {
        var response = fixture.service.get(GAME, selection(List.of(plan(MARK))));
        assertNull(source(response, "source").inactiveReason());
        assertTrue(source(response, "source").enabledRuleKeys().containsAll(List.of("on_used", "root_hit", "apply_mark", "consume_attack")));
        assertFalse(source(response, "source").enabledRuleKeys().contains("consume_skill_a"));
    }
    @Test void bothPlansPreserveActualSiblingConsumer() {
        var response = fixture.service.get(GAME, selection(List.of(plan(MARK), plan(SIBLING))));
        assertNull(source(response, "source").inactiveReason());
        assertTrue(source(response, "source").enabledRuleKeys().containsAll(List.of("on_used", "root_hit", "apply_mark", "consume_attack", "consume_skill_a")));
    }
    @Test void anAdditionalIndependentNaturalRootIsNotSilentlyFiltered() throws Exception {
        ObjectNode extra = TargetMarkSnapshotRulesTest.find(mark, "triggerRules", "ruleKey", "root_hit").deepCopy();
        extra.put("ruleKey", "independent"); ((ObjectNode) extra.path("eventSource")).put("eventType", "SOURCE_INITIALIZED").putObject("detail");
        mark.withArray("triggerRules").add(extra); configure();
        var response = fixture.service.get(GAME, selection(List.of()));
        assertNull(source(response, "source").inactiveReason());
        assertTrue(source(response, "source").enabledRuleKeys().contains("independent"));
    }
    @Test void illegalGraphKeepsOriginalNaturalClosureInsteadOfBecomingDormant() throws Exception {
        ObjectNode attack = TargetMarkSnapshotRulesTest.find(mark, "processes", "processKey", "attack");
        ((ObjectNode) attack.path("stateOperations").get(0).path("value")).put("value", 1); configure();
        var response = fixture.service.get(GAME, selection(List.of()));
        assertNull(source(response, "source").inactiveReason());
        assertTrue(source(response, "source").enabledRuleKeys().contains("consume_attack"));
    }
}
