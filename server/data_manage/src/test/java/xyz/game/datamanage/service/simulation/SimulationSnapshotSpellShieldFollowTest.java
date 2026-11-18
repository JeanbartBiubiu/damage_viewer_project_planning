package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.damagetype.*;
import xyz.game.datamanage.model.simulation.SimulationPreviewUpdate;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationChange;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationSaveRequest;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotSpellShieldFollowTest {
    private SimulationSnapshotFixture fixture;
    private static final String FOLLOWER = "follower_skill", PRODUCER = "producer_skill";

    @BeforeEach void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, FOLLOWER, PRODUCER);
        String payload = """
            {"effectKey":"payload","name":"伤害效果","lifecycle":null,"sortOrder":0,"results":[{"resultKey":"damage","name":"伤害","resultType":"DAMAGE","target":"TARGET","sortOrder":0,
             "valueRule":{"value":{"kind":"FIXED","value":50},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},
             "detail":{"damageTypeKey":"magic","deliveryKind":"SKILL","originKind":"DIRECT",
              "critical":{"mode":"DISALLOWED","multiplierValue":null},"vampQualification":"RESOLVED","vampOverrides":[]},
             "lifecycleBehavior":null,"spellShieldBlockScope":"SKILL"}]}
            """;
        ObjectNode follow = (ObjectNode) AggregateJson.tree(payload);
        ((ObjectNode) follow.path("results").get(0)).putNull("spellShieldBlockScope");
        ((ObjectNode) follow.path("results").get(0).path("detail")).set("spellShieldFollowResult",
            AggregateJson.tree("{\"skillKey\":\"producer_skill\",\"effectKey\":\"payload\",\"resultKey\":\"damage\"}"));
        fixture.configuration(FOLLOWER, 1, """
            {"effects":[%s],"triggerRules":[{"ruleKey":"actual_attack","eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},"conditionGroups":[],
             "actions":[{"actionKey":"damage","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"payload"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """.formatted(follow));
        fixture.configuration(PRODUCER, 1, """
            {"effects":[%s,%s],"processes":[{"processKey":"cast","activationType":"ACTIVE","cooldown":null,"steps":[{"stepKey":"now","stepType":"IMMEDIATE","occupiesAction":false,"detail":{}}],
             "effectBindings":[{"bindingKey":"damage","effectKey":"payload","moment":{"momentType":"STEP_EXECUTION","stepKey":"now","failureReason":null},"sortOrder":0}],"stateOperations":[]}],
             "triggerRules":[{"ruleKey":"used","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"producer_skill","useKind":"ACTIVE","castPhase":"INITIAL"}},"conditionGroups":[],
              "actions":[{"actionKey":"start","actionType":"START_PROCESS","targetContext":"CURRENT_TARGET","detail":{"processKey":"cast"},"runtimeInputBindings":[],"resultModifiers":[]}]},
              {"ruleKey":"after_damage","eventSource":{"eventType":"DAMAGE_DEALT","detail":{"sourceSkillKey":"producer_skill"}},"conditionGroups":[],
               "actions":[{"actionKey":"recover","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE","detail":{"effectKey":"heal"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """.formatted(payload, heal("heal", "{\"kind\":\"FIXED\",\"value\":1}")));
        when(fixture.damageTypes.get(GAME, "magic")).thenReturn(new DamageTypeResponse(GAME, "magic", "魔法", null, DamageTypeStatus.ENABLED, 0, null, null, true));
        when(fixture.damageTypes.getFormula(GAME, "magic")).thenReturn(new DamageTypeFormulaResponse(GAME, "magic", xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition("1"), null));
    }

    @ParameterizedTest @ValueSource(strings = {"disabled", "unlearned", "unplanned"})
    void closedOrUnplannedProducerKeepsOnlyItsReadOnlyDefinition(String mode) {
        var snapshot = fixture.service.get(GAME, choice(mode));
        var producer = snapshot.source().skillSources().stream().filter(source -> source.skillKey().equals(PRODUCER)).findFirst().orElseThrow();
        assertEquals(mode.equals("disabled") ? InactiveReason.SCENE_DISABLED : mode.equals("unlearned") ? InactiveReason.UNLEARNED : InactiveReason.ACTIVE_DEFERRED, producer.inactiveReason());
        assertEquals(List.of(FOLLOWER), snapshot.executionSkillKeys());
        assertTrue(producer.enabledRuleKeys().isEmpty());
        assertTrue(snapshot.references().stream().anyMatch(ref -> ref.sourceSkillKey().equals(FOLLOWER) && ref.targetSkillKey().equals(PRODUCER) && ref.targetType().equals("RESULT")));
        assertFalse(snapshot.references().stream().anyMatch(ref -> ref.sourceSkillKey().equals(PRODUCER) && (ref.sourceType().equals("PROCESS") || ref.sourceType().equals("TRIGGER"))));
    }

    @ParameterizedTest @ValueSource(strings = {"disabled", "unlearned", "unplanned", "planned"})
    void jointPreviewUsesTheNewDefinitionAndCountsTheProducerOnlyThroughItsOwnEntry(String mode) throws Exception {
        SkillConfigurationResponse oldProducer = fixture.configurations.get(GAME, PRODUCER);
        SkillConfigurationResponse oldFollower = fixture.configurations.get(GAME, FOLLOWER);
        ObjectNode producer = fixture.json.valueToTree(oldProducer);
        ObjectNode follower = fixture.json.valueToTree(oldFollower);
        ((ObjectNode) producer.at("/effects/0/results/0")).put("resultKey", "new_damage");
        ((ObjectNode) follower.at("/effects/0/results/0/detail/spellShieldFollowResult")).put("resultKey", "new_damage");
        var updates = List.of(projectPayload(oldProducer, producer), projectPayload(oldFollower, follower));

        Selection selection = choice(mode);
        var snapshot = fixture.service.preview(GAME, selection, updates);
        var producerSource = snapshot.source().skillSources().stream().filter(source -> source.skillKey().equals(PRODUCER)).findFirst().orElseThrow();
        assertEquals(mode.equals("planned") ? List.of(FOLLOWER, PRODUCER) : List.of(FOLLOWER), snapshot.executionSkillKeys());
        assertTrue(snapshot.references().stream().anyMatch(ref -> ref.sourceSkillKey().equals(FOLLOWER)
            && ref.targetSkillKey().equals(PRODUCER) && ref.targetType().equals("RESULT") && ref.targetSubKey().equals("new_damage")));
        var projectedProducer = snapshot.skillConfigurations().stream().filter(config -> config.skill().skillKey().equals(PRODUCER))
            .findFirst().orElseThrow();
        assertEquals("new_damage", projectedProducer.effects().getFirst().results().getFirst().resultKey());
        if (mode.equals("planned")) {
            assertNull(producerSource.inactiveReason());
            assertEquals(List.of("after_damage", "used"), producerSource.enabledRuleKeys());
            assertEquals(List.of(FOLLOWER, PRODUCER), fixture.service.get(GAME, selection).executionSkillKeys());
        } else {
            assertNotNull(producerSource.inactiveReason());
            assertTrue(producerSource.enabledRuleKeys().isEmpty());
        }
    }

    private SimulationPreviewUpdate projectPayload(SkillConfigurationResponse before, ObjectNode after) throws Exception {
        String key = before.skill().skillKey();
        var projected = fixture.configuration(key, before.skill().maxLevel(), after.toString());
        when(fixture.configurations.get(GAME, key)).thenReturn(before);
        ObjectNode payload = ((ObjectNode) after.at("/effects/0")).deepCopy();
        payload.remove(List.of("gameId", "skillKey", "effectKey", "createdAt", "updatedAt"));
        var request = new SkillConfigurationSaveRequest(before.baseDigest(), null,
            List.of(new SkillConfigurationChange("EFFECT", "UPDATE", "payload", payload)));
        when(fixture.configurations.previewUpdate(GAME, key, request)).thenReturn(projected);
        return new SimulationPreviewUpdate(key, request);
    }

    private Selection choice(String mode) {
        Selection base = fixture.choice();
        Origin origin = Origin.character("hero_a");
        var settings = List.of(new SkillSetting(origin, FOLLOWER, true, 1),
            new SkillSetting(origin, PRODUCER, !mode.equals("disabled"), mode.equals("unlearned") ? 0 : 1));
        var plans = mode.equals("planned") ? List.of(new PlannedSkill(origin, PRODUCER, 1, List.of("INITIAL"))) : List.<PlannedSkill>of();
        return new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), base.basicAttackLevel(), List.of(), List.of(), List.of(), List.of(), settings, List.of(), plans);
    }

    @Test void anExistingDefinitionAttachedOnlyToAnotherOwnerCannotSupplyTheFollowedResult() {
        fixture.attach("hero_a", ATTACK, FOLLOWER);
        fixture.attach("hero_b", ATTACK, PRODUCER);
        var error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, fixture.choice()));
        assertTrue(error.getDetails().toString().contains("INVALID_STORED_DATA"), error.getDetails().toString());
        assertTrue(error.getDetails().toString().contains(".detail.spellShieldFollowResult"), error.getDetails().toString());
    }
}
