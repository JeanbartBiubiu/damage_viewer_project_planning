package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillHitPhaseWriteGuardTest {
    @Mock JdbcTemplate jdbc;
    GameConfigurationWriteGuard guard;
    @BeforeEach void setup() {
        guard = new GameConfigurationWriteGuard(jdbc);
        when(jdbc.queryForObject("SHOW transaction_isolation", String.class)).thenReturn("read committed");
        when(jdbc.queryForList("SELECT game_id FROM public.games WHERE game_id = ? FOR UPDATE", String.class, "lol")).thenReturn(List.of("lol"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(Map.of("target_type", "SKILL", "skill_key", "", "object_key", "spell")));
    }

    @AfterEach void releaseTransactionState() {
        assertNull(TransactionSynchronizationManager.getResource(guard));
        assertTrue(TransactionSynchronizationManager.getResourceMap().isEmpty());
    }

    @ParameterizedTest @ValueSource(strings = {"delete_prior_rule", "reorder", "step_type", "delete_step", "delete_process", "delete_start_rule"})
    void aFinalMutationCannotInvalidateUnchangedPhaseRules(String scenario) throws Exception {
        var before = SkillHitPhaseSemanticsTest.valid();
        var after = SkillHitPhaseSemanticsTest.valid();
        switch (scenario) {
            case "delete_prior_rule" -> after.remove(2);
            case "reorder" -> ((ObjectNode) after.getFirst().data().path("steps").get(0)).put("sortOrder", 4);
            case "step_type" -> ((ObjectNode) after.getFirst().data().path("steps").get(0)).put("stepType", "PERIODIC");
            case "delete_step" -> ((com.fasterxml.jackson.databind.node.ArrayNode) after.getFirst().data().path("steps")).remove(0);
            case "delete_process" -> after.removeFirst();
            case "delete_start_rule" -> after.remove(1);
            default -> fail(scenario);
        }
        stub(before, after);
        Connection connection = mock(Connection.class);
        when(connection.getAutoCommit()).thenReturn(true);
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(tx -> {
            guard.begin("lol"); jdbc.update("isolated phase mutation"); return null;
        }));
        assertTrue(error.getDetails().toString().contains("processMoment"));
        verify(connection).rollback(); verify(connection, never()).commit();
        verify(jdbc, never()).update(eq(GameConfigurationWriteGuard.DELETE_SOURCE_SQL), any(), any(), any(), any());
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @Test void removingAPriorPhaseAndItsDependenciesTogetherUsesTheFinalTransactionState() throws Exception {
        var before = SkillHitPhaseSemanticsTest.valid();
        var after = SkillHitPhaseSemanticsTest.valid();
        after.remove(2);
        ((com.fasterxml.jackson.databind.node.ArrayNode) after.getFirst().data().path("steps")).remove(0);
        for (var phase : after.subList(2, after.size()))
            ((ObjectNode) phase.data().path("eventSource").path("detail").path("processMoment")).putNull("requiresPriorStepKey");
        stub(before, after);
        Connection connection = mock(Connection.class); when(connection.getAutoCommit()).thenReturn(true);
        transaction(connection).execute(tx -> { guard.begin("lol"); jdbc.update("isolated final phase replacement"); return null; });
        verify(connection).commit(); verify(connection, never()).rollback();
        verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @ParameterizedTest @ValueSource(strings = {"scope", "type"})
    void changingTheNaturalCounterAfterItsRuleWasSavedRollsBack(String scenario) throws Exception {
        var before = SkillHitPhaseSemanticsTest.valid();
        var after = SkillHitPhaseSemanticsTest.valid();
        String state = "{\"scope\":\"SKILL\",\"stateType\":\"COUNTER\",\"detail\":{\"initialValue\":{\"kind\":\"FIXED\",\"value\":0},\"maxValue\":{\"kind\":\"FIXED\",\"value\":2}}}";
        var oldState = new Aggregate(SkillObjectReferences.SourceType.STATE, "spell", "counter", AggregateJson.tree(state));
        var newState = new Aggregate(SkillObjectReferences.SourceType.STATE, "spell", "counter", AggregateJson.tree(state));
        ((ObjectNode) newState.data()).put(scenario.equals("scope") ? "scope" : "stateType", scenario.equals("scope") ? "TARGET" : "AMMO");
        var rule = new Aggregate(SkillObjectReferences.SourceType.TRIGGER, "spell", "counter_rule", AggregateJson.tree("""
            {"eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},"conditionGroups":[{"conditions":[{"conditionType":"INTERNAL_STATE_CHECK",
              "detail":{"stateSkillKey":"spell","stateKey":"counter","valueKind":"ATTACK_START_VALUE","comparator":"EQ",
                "comparisonValue":{"kind":"FIXED","value":2}}}]}],"actions":[{"actionKey":"end","actionType":"FAIL_PROCESS","detail":{"processKey":"cast"}}]}
            """));
        before.add(oldState); before.add(rule); after.add(newState); after.add(rule);
        stub(before, after);
        Connection connection = mock(Connection.class); when(connection.getAutoCommit()).thenReturn(true);
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(tx -> { guard.begin("lol"); return null; }));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("valueKind"));
        verify(connection).rollback(); verify(connection, never()).commit();
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @ParameterizedTest @ValueSource(strings = {"BASIC_ATTACK_START", "BASIC_ATTACK_HIT"})
    void aNaturalOwnedCounterSnapshotCanBeCommittedThroughEveryFinalGuard(String event) throws Exception {
        var before = SkillHitPhaseSemanticsTest.valid();
        var after = SkillHitPhaseSemanticsTest.valid();
        after.add(new Aggregate(SkillObjectReferences.SourceType.STATE, "spell", "counter", AggregateJson.tree("""
            {"scope":"SKILL","stateType":"COUNTER","detail":{"initialValue":{"kind":"FIXED","value":0},"maxValue":{"kind":"FIXED","value":2}}}
            """)));
        after.add(new Aggregate(SkillObjectReferences.SourceType.TRIGGER, "spell", "counter_rule", AggregateJson.tree("""
            {"eventSource":{"eventType":"%s","detail":{}},"conditionGroups":[{"conditions":[{"conditionType":"INTERNAL_STATE_CHECK",
              "detail":{"stateSkillKey":"spell","stateKey":"counter","valueKind":"ATTACK_START_VALUE","comparator":"EQ",
                "comparisonValue":{"kind":"FIXED","value":2}}}]}],"actions":[{"actionKey":"end","actionType":"FAIL_PROCESS","detail":{"processKey":"cast"}}]}
            """.formatted(event))));
        stub(before, after);
        Connection connection = mock(Connection.class); when(connection.getAutoCommit()).thenReturn(true);
        transaction(connection).execute(tx -> { guard.begin("lol"); return null; });
        verify(connection).commit(); verify(connection, never()).rollback();
    }

    private void stub(List<Aggregate> before, List<Aggregate> after) {
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(rows(before), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(snapshots(before), snapshots(after));
        var references = SkillObjectReferences.extractAndValidate("lol", before, before,
            Set.of(new Target(TargetType.SKILL, "", "spell", ""))).stream().map(r -> Map.<String, Object>of(
                "source_skill_key", r.sourceSkillKey(), "source_type", r.sourceType().name(), "source_key", r.sourceKey(),
                "field_path", r.fieldPath(), "target_type", r.target().type().name(), "target_skill_key", r.target().skillKey(),
                "target_key", r.target().key(), "target_sub_key", r.target().subKey())).toList();
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(references);
    }
    private static List<Map<String, Object>> rows(List<Aggregate> data) {
        return data.stream().map(a -> Map.<String, Object>of("source_type", a.type().name(), "skill_key", a.skillKey(), "source_key", a.key(), "data", a.data().toString())).toList();
    }
    private static List<Map<String, Object>> snapshots(List<Aggregate> data) {
        return data.stream().map(a -> Map.<String, Object>of("object_type", a.type().name(), "skill_key", a.skillKey(), "object_key", a.key(), "data", a.data().toString())).toList();
    }
    private static TransactionTemplate transaction(Connection connection) throws Exception {
        DataSource source = mock(DataSource.class); when(source.getConnection()).thenReturn(connection);
        return new TransactionTemplate(new DataSourceTransactionManager(source));
    }
}
