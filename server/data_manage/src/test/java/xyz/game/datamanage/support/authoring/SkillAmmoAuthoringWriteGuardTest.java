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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillAmmoAuthoringWriteGuardTest {
    static final String GAME = "game", SKILL = SkillAmmoAuthoringSemanticsTest.SKILL, WRITE = "isolated ammo authoring write";
    @Mock JdbcTemplate jdbc;
    GameConfigurationWriteGuard guard;

    @BeforeEach void setUp() {
        guard = new GameConfigurationWriteGuard(jdbc);
        when(jdbc.queryForObject("SHOW transaction_isolation", String.class)).thenReturn("read committed");
        when(jdbc.queryForList("SELECT game_id FROM public.games WHERE game_id = ? FOR UPDATE", String.class, GAME)).thenReturn(List.of(GAME));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, GAME)).thenReturn(catalog());
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, GAME)).thenReturn(parameters(false));
    }

    @AfterEach void noTransactionResourceLeaks() {
        assertNull(TransactionSynchronizationManager.getResource(guard));
        assertTrue(TransactionSynchronizationManager.getResourceMap().isEmpty());
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
    }

    @Test void aggregateCommitIndexesBothStateDeclarationsAndActualRefundDependencies() throws Exception {
        var after = objects();
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(List.of(), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(snapshot(List.of(), false), snapshot(after, false));
        Connection connection = connection();
        transaction(connection).execute(status -> { guard.begin(GAME); jdbc.update(WRITE); return null; });
        var refs = SkillObjectReferences.extract(GAME, after);
        assertTrue(refs.stream().anyMatch(ref -> ref.fieldPath().equals("detail.initialValueBinding.parameterKey")));
        assertTrue(refs.stream().anyMatch(ref -> ref.fieldPath().equals("detail.initialRemainingMsBinding.parameterKey")));
        assertTrue(refs.stream().anyMatch(ref -> ref.fieldPath().equals("actions[0].detail.stateKey") && ref.target().key().equals("ammo")));
        verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), argThat((List<Object[]> entries) -> entries.size() == refs.size()));
        verify(connection).commit();
        verify(connection, never()).rollback();
    }

    @ParameterizedTest @ValueSource(strings = {"PARAMETER_TYPE", "STATE_KIND", "STATE_SCOPE", "WRONG_INITIAL_KEY", "REFUND_TARGET"})
    void finalDependencyMutationRollsBackBeforeAnyIndexReplacement(String change) throws Exception {
        var before = objects();
        var after = objects();
        ObjectNode state = (ObjectNode) after.getFirst().data();
        if (change.equals("STATE_KIND")) state.put("stateType", "COUNTER");
        if (change.equals("STATE_SCOPE")) state.put("scope", "TARGET");
        if (change.equals("WRONG_INITIAL_KEY")) ((ObjectNode) state.path("detail").path("initialValueBinding")).put("parameterKey", "initial_phase");
        if (change.equals("REFUND_TARGET")) ((ObjectNode) after.get(1).data().path("actions").get(0)).put("targetContext", "CURRENT_TARGET");
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(rows(before), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(snapshot(before, false), snapshot(after, change.equals("PARAMETER_TYPE")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, GAME)).thenReturn(referenceRows(SkillObjectReferences.extract(GAME, before)));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, GAME)).thenReturn(parameters(change.equals("PARAMETER_TYPE")));
        Connection connection = connection();
        assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin(GAME); jdbc.update(WRITE); return null; }));
        verify(connection).rollback();
        verify(connection, never()).commit();
        verify(jdbc, never()).update(eq(GameConfigurationWriteGuard.DELETE_SOURCE_SQL), any(), any(), any(), any());
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @ParameterizedTest @ValueSource(strings = {"PARAMETER", "STATE"})
    void indexedStateAndParameterCannotBeDeletedWhileStillUsed(String targetType) throws Exception {
        var before = objects();
        var reference = SkillObjectReferences.extract(GAME, before).stream()
            .filter(ref -> ref.target().type().name().equals(targetType)).findFirst().orElseThrow();
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(rows(before));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(snapshot(before, false));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCED_SQL, GAME, targetType, SKILL, reference.target().key()))
            .thenReturn(referenceRows(List.of(reference)));
        Connection connection = connection();
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin(GAME); guard.assertNotReferenced(GAME, targetType, SKILL, reference.target().key(), "409.IN_USE", "仍被引用"); return null;
        }));
        assertEquals("409.IN_USE", error.getCode());
        verify(connection).rollback();
        verify(jdbc, never()).update(WRITE);
    }

    private static List<Aggregate> objects() { return List.of(SkillAmmoAuthoringSemanticsTest.ammo(true), SkillAmmoAuthoringSemanticsTest.refundRule(false)); }
    private static List<Map<String, Object>> rows(List<Aggregate> objects) {
        return objects.stream().map(a -> Map.<String, Object>of("source_type", a.type().name(), "skill_key", a.skillKey(), "source_key", a.key(), "data", a.data().toString())).toList();
    }
    private static List<Map<String, Object>> snapshot(List<Aggregate> objects, boolean decimalStock) {
        var result = new ArrayList<>(objects.stream().map(a -> Map.<String, Object>of("object_type", a.type().name(), "skill_key", a.skillKey(), "object_key", a.key(), "data", a.data().toString())).toList());
        result.add(Map.of("object_type", "SKILL", "skill_key", "", "object_key", SKILL, "data", "{\"status\":\"ENABLED\"}"));
        for (var parameter : parameters(decimalStock)) result.add(Map.of("object_type", "PARAMETER", "skill_key", SKILL, "object_key", parameter.get("parameter_key"),
            "data", "{\"value_mode\":\"RUNTIME_INPUT\",\"value_type\":\"" + parameter.get("value_type") + "\"}"));
        return result;
    }
    private static List<Map<String, Object>> parameters(boolean decimalStock) {
        return SkillAmmoAuthoringSemanticsTest.inputs().stream().map(p -> Map.<String, Object>of("skill_key", SKILL, "parameter_key", p.key(),
            "value_type", decimalStock && p.key().equals("initial_stock") ? "DECIMAL" : p.valueType(), "value_mode", "RUNTIME_INPUT")).toList();
    }
    private static List<Map<String, Object>> catalog() {
        var rows = new ArrayList<Map<String, Object>>();
        rows.add(Map.of("target_type", "SKILL", "skill_key", "", "object_key", SKILL));
        for (var p : parameters(false)) rows.add(Map.of("target_type", "PARAMETER", "skill_key", SKILL, "object_key", p.get("parameter_key")));
        return rows;
    }
    private static List<Map<String, Object>> referenceRows(List<Reference> references) {
        return references.stream().map(ref -> Map.<String, Object>of("source_skill_key", ref.sourceSkillKey(), "source_type", ref.sourceType().name(),
            "source_key", ref.sourceKey(), "field_path", ref.fieldPath(), "target_type", ref.target().type().name(), "target_skill_key", ref.target().skillKey(),
            "target_key", ref.target().key(), "target_sub_key", ref.target().subKey())).toList();
    }
    private static Connection connection() throws Exception { var connection = mock(Connection.class); when(connection.getAutoCommit()).thenReturn(true); return connection; }
    private static TransactionTemplate transaction(Connection connection) throws Exception {
        DataSource source = mock(DataSource.class); when(source.getConnection()).thenReturn(connection);
        return new TransactionTemplate(new DataSourceTransactionManager(source));
    }
}
