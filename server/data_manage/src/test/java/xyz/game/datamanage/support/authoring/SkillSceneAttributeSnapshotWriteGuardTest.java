package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillSceneAttributeSnapshotWriteGuardTest {
    @Mock private JdbcTemplate jdbc;
    private GameConfigurationWriteGuard guard;

    @BeforeEach void setUp() {
        guard = new GameConfigurationWriteGuard(jdbc);
        when(jdbc.queryForObject("SHOW transaction_isolation", String.class)).thenReturn("read committed");
        when(jdbc.queryForList("SELECT game_id FROM public.games WHERE game_id = ? FOR UPDATE", String.class, "game"))
            .thenReturn(List.of("game"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "game")).thenReturn(List.of(
            Map.of("target_type", "SKILL", "skill_key", "", "object_key", "authored_skill"),
            Map.of("target_type", "PARAMETER", "skill_key", "authored_skill", "object_key", "snapshot_input"),
            Map.of("target_type", "ATTRIBUTE", "skill_key", "", "object_key", "authored_stat")));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, "game")).thenReturn(List.of(
            Map.of("skill_key", "authored_skill", "parameter_key", "snapshot_input", "value_type", "DECIMAL", "value_mode", "RUNTIME_INPUT")));
    }

    @AfterEach void noLeakedTransaction() {
        assertNull(TransactionSynchronizationManager.getResource(guard));
        assertTrue(TransactionSynchronizationManager.getResourceMap().isEmpty());
    }

    @Test void aValidAggregateRebuildsItsActualAttributeReferenceInTheSameTransaction() throws Exception {
        var after = SkillSceneAttributeSnapshotSemanticsTest.objects(SkillSceneAttributeSnapshotSemanticsTest.DETAIL);
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "game")).thenReturn(List.of(), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "game")).thenReturn(List.of(), snapshot(after, "ENABLED", "DECIMAL", "RUNTIME_INPUT"));
        Connection connection = connection();
        transaction(connection).execute(status -> { guard.begin("game"); jdbc.update("test authoring write"); return null; });
        @SuppressWarnings("unchecked") ArgumentCaptor<List<Object[]>> entries = ArgumentCaptor.forClass(List.class);
        verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), entries.capture());
        assertTrue(entries.getValue().stream().anyMatch(row -> "ATTRIBUTE".equals(row[5]) && "authored_stat".equals(row[7])));
        verify(connection).commit();
        verify(connection, never()).rollback();
    }

    @ParameterizedTest @ValueSource(strings = {"PASSIVE", "EVENT", "PARAMETER_FIXED", "UNUSED", "ATTRIBUTE_DISABLED", "ATTRIBUTE_BOOLEAN"})
    void finalChangesToAnExistingDependencyRollBackBeforeReplacingTheIndex(String change) throws Exception {
        var before = SkillSceneAttributeSnapshotSemanticsTest.objects(SkillSceneAttributeSnapshotSemanticsTest.DETAIL);
        var after = SkillSceneAttributeSnapshotSemanticsTest.objects(SkillSceneAttributeSnapshotSemanticsTest.DETAIL);
        if ("PASSIVE".equals(change)) ((ObjectNode) after.getFirst().data()).put("activationType", "PASSIVE");
        if ("EVENT".equals(change)) ((ObjectNode) after.get(1).data().path("eventSource").path("detail")).put("useKind", "ANY");
        if ("UNUSED".equals(change)) ((ObjectNode) after.getFirst().data().path("steps").get(0).path("detail"))
            .set("delayValue", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":0}"));
        String mode = "PARAMETER_FIXED".equals(change) ? "FIXED" : "RUNTIME_INPUT";
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "game")).thenReturn(rows(before), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "game")).thenReturn(snapshot(before, "ENABLED", "DECIMAL", "RUNTIME_INPUT"),
            snapshot(after, "ATTRIBUTE_DISABLED".equals(change) ? "DISABLED" : "ENABLED", "ATTRIBUTE_BOOLEAN".equals(change) ? "BOOLEAN" : "DECIMAL", mode));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, "game")).thenReturn(List.of(
            Map.of("skill_key", "authored_skill", "parameter_key", "snapshot_input", "value_type", "DECIMAL", "value_mode", mode)));
        var references = SkillObjectReferences.extract("game", before).stream().map(ref -> Map.<String, Object>of(
            "source_skill_key", ref.sourceSkillKey(), "source_type", ref.sourceType().name(), "source_key", ref.sourceKey(),
            "field_path", ref.fieldPath(), "target_type", ref.target().type().name(), "target_skill_key", ref.target().skillKey(),
            "target_key", ref.target().key(), "target_sub_key", ref.target().subKey())).toList();
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "game")).thenReturn(references);
        Connection connection = connection();
        assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("game"); jdbc.update("test dependency write"); return null;
        }));
        verify(jdbc).update("test dependency write");
        verify(jdbc, never()).update(eq(GameConfigurationWriteGuard.DELETE_SOURCE_SQL), any(), any(), any(), any());
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    private static List<Map<String, Object>> rows(List<Aggregate> objects) {
        return objects.stream().map(a -> Map.<String, Object>of("source_type", a.type().name(), "skill_key", a.skillKey(),
            "source_key", a.key(), "data", a.data().toString())).toList();
    }

    private static List<Map<String, Object>> snapshot(List<Aggregate> objects, String status, String type, String mode) {
        List<Map<String, Object>> result = new ArrayList<>(objects.stream().map(a -> Map.<String, Object>of(
            "object_type", a.type().name(), "skill_key", a.skillKey(), "object_key", a.key(), "data", a.data().toString())).toList());
        result.add(Map.of("object_type", "ATTRIBUTE", "skill_key", "", "object_key", "authored_stat", "data",
            "{\"status\":\"" + status + "\",\"value_type\":\"" + type + "\"}"));
        result.add(Map.of("object_type", "PARAMETER", "skill_key", "authored_skill", "object_key", "snapshot_input", "data",
            "{\"value_mode\":\"" + mode + "\"}"));
        return result;
    }

    private static Connection connection() throws Exception {
        Connection connection = mock(Connection.class);
        when(connection.getAutoCommit()).thenReturn(true);
        return connection;
    }

    private static TransactionTemplate transaction(Connection connection) throws Exception {
        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenReturn(connection);
        return new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    }
}
