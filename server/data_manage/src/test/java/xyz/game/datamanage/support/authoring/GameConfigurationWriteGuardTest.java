package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class GameConfigurationWriteGuardTest {
    private static final String LOCK_SQL = "SELECT game_id FROM public.games WHERE game_id = ? FOR UPDATE";
    private static final String DELETE_SQL = "DELETE FROM public.skill_object_references WHERE game_id = ?";
    @Mock private JdbcTemplate jdbc;
    private GameConfigurationWriteGuard guard;

    @BeforeEach
    void setUp() {
        guard = new GameConfigurationWriteGuard(jdbc);
        lenient().when(jdbc.queryForObject("SHOW transaction_isolation", String.class)).thenReturn("read committed");
        lenient().when(jdbc.queryForList(LOCK_SQL, String.class, "lol")).thenReturn(List.of("lol"));
    }

    @AfterEach
    void noTransactionResourceLeaked() {
        assertNull(TransactionSynchronizationManager.getResource(guard));
        assertTrue(TransactionSynchronizationManager.getResourceMap().isEmpty());
        assertTrue(!TransactionSynchronizationManager.isActualTransactionActive());
    }

    @Test
    void rejectsMissingOrReadOnlyTransactionBeforeAnyDatabaseAccess() throws Exception {
        assertThrows(IllegalStateException.class, () -> guard.begin("lol"));
        Connection connection = connection();
        TransactionTemplate tx = transaction(connection);
        tx.setReadOnly(true);
        assertThrows(IllegalStateException.class, () -> tx.execute(status -> { guard.begin("lol"); return null; }));
        verify(jdbc, never()).queryForObject(anyString(), eq(String.class));
        verify(connection).rollback();
    }

    @Test
    void repeatedBeginRegistersOneCommitCheckAndReplacesOnlyAfterValidation() throws Exception {
        Connection connection = connection();
        TransactionTemplate tx = transaction(connection);
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "PARAMETER", "skill_key", "ez_q", "object_key", "damage")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(formulaRow()));
        tx.execute(status -> {
            guard.begin("lol");
            guard.begin("lol");
            assertEquals(1, TransactionSynchronizationManager.getSynchronizations().size());
            verify(jdbc, never()).queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol");
            return null;
        });
        verify(jdbc, times(1)).queryForList(LOCK_SQL, String.class, "lol");
        verify(jdbc, times(1)).queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol");
        verify(jdbc).update(DELETE_SQL, "lol");
        @SuppressWarnings("unchecked") ArgumentCaptor<List<Object[]>> rows = ArgumentCaptor.forClass(List.class);
        verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), rows.capture());
        assertEquals(List.of("lol", "ez_q", "FORMULA", "damage", "expression.parameterKey", "PARAMETER", "ez_q", "damage", ""),
            List.of(rows.getValue().get(0)));
        verify(connection).commit();
        verify(connection, never()).rollback();
    }

    @Test
    void businessRollbackSkipsReferenceRewriteAndNextTransactionLocksAgain() throws Exception {
        Connection first = connection();
        Connection second = connection();
        TransactionTemplate tx = transaction(first, second);
        assertThrows(IllegalArgumentException.class, () -> tx.execute(status -> {
            guard.begin("lol");
            throw new IllegalArgumentException("模拟业务失败");
        }));
        verify(jdbc, never()).queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol");
        verify(jdbc, never()).update(DELETE_SQL, "lol");
        verify(first).rollback();
        tx.execute(status -> { guard.begin("lol"); return null; });
        verify(jdbc, times(2)).queryForList(LOCK_SQL, String.class, "lol");
        verify(second).commit();
    }

    @Test
    void missingTargetInFinalDatabaseStateRollsBackWholeTransaction() throws Exception {
        Connection connection = connection();
        TransactionTemplate tx = transaction(connection);
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of());
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(formulaRow()));
        ApiException error = assertThrows(ApiException.class, () -> tx.execute(status -> {
            guard.begin("lol");
            return null;
        }));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
        verify(jdbc, never()).update(DELETE_SQL, "lol");
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void requiresNewSuspendsOuterDeduplicationAndRestoresItAfterInnerRollback() throws Exception {
        Connection outerConnection = connection();
        Connection innerConnection = connection();
        TransactionTemplate outer = transaction(outerConnection, innerConnection);
        TransactionTemplate inner = new TransactionTemplate(outer.getTransactionManager());
        inner.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        when(jdbc.queryForList(LOCK_SQL, String.class, "tft")).thenReturn(List.of("tft"));
        outer.execute(status -> {
            guard.begin("lol");
            Object outerState = TransactionSynchronizationManager.getResource(guard);
            assertThrows(IllegalArgumentException.class, () -> inner.execute(innerStatus -> {
                guard.begin("tft");
                assertTrue(outerState != TransactionSynchronizationManager.getResource(guard));
                throw new IllegalArgumentException("模拟内层回滚");
            }));
            assertEquals(outerState, TransactionSynchronizationManager.getResource(guard));
            guard.begin("lol");
            return null;
        });
        verify(jdbc, times(1)).queryForList(LOCK_SQL, String.class, "lol");
        verify(jdbc, times(1)).queryForList(LOCK_SQL, String.class, "tft");
        verify(jdbc, times(1)).update(DELETE_SQL, "lol");
        verify(innerConnection).rollback();
        verify(outerConnection).commit();
    }

    @Test
    void missingGameOrIncompatibleIsolationNeverRegistersCommitCallback() throws Exception {
        Connection first = connection();
        Connection second = connection();
        TransactionTemplate tx = transaction(first, second);
        when(jdbc.queryForList(LOCK_SQL, String.class, "missing")).thenReturn(List.of());
        ApiException missing = assertThrows(ApiException.class, () -> tx.execute(status -> {
            guard.begin("missing"); return null;
        }));
        assertEquals("404.GAME_NOT_FOUND", missing.getCode());
        when(jdbc.queryForObject("SHOW transaction_isolation", String.class)).thenReturn("repeatable read");
        assertThrows(IllegalStateException.class, () -> tx.execute(status -> { guard.begin("lol"); return null; }));
        verify(jdbc, never()).queryForList(LOCK_SQL, String.class, "lol");
        verify(jdbc, never()).queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol");
    }

    @Test
    void earlyDeleteCheckRequiresGameLockAndPreservesDomainErrorWithSourcePaths() throws Exception {
        assertThrows(IllegalStateException.class, () -> guard.assertNotReferenced("lol", "FORMULA", "ez_q", "damage",
            "409.SKILL_FORMULA_IN_USE", "技能公式被引用"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCED_SQL, "lol", "FORMULA", "ez_q", "damage"))
            .thenReturn(List.of(Map.of("source_skill_key", "ez_q", "source_type", "EFFECT", "source_key", "hit",
                "field_path", "results[0].valueRule.formulaKey", "target_type", "FORMULA", "target_skill_key", "ez_q",
                "target_key", "damage", "target_sub_key", "")));
        Connection connection = connection();
        ApiException error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            guard.assertNotReferenced("lol", "FORMULA", "ez_q", "damage", "409.SKILL_FORMULA_IN_USE", "技能公式被引用");
            return null;
        }));
        assertEquals("409.SKILL_FORMULA_IN_USE", error.getCode());
        assertTrue(error.getDetails().get("fieldIssues").toString().contains("results[0].valueRule.formulaKey"));
        verify(connection).rollback();
        assertTrue(!GameConfigurationWriteGuard.REFERENCED_SQL.contains("target_sub_key ="));
    }

    @Test
    void unreferencedTargetCanPassEarlyDeleteCheck() throws Exception {
        Connection connection = connection();
        transaction(connection).execute(status -> {
            guard.begin("lol");
            guard.assertNotReferenced("lol", "FORMULA", "ez_q", "unused", "409.SKILL_FORMULA_IN_USE", "技能公式被引用");
            return null;
        });
        verify(connection).commit();
    }

    private static Map<String, Object> formulaRow() {
        return Map.of("source_type", "FORMULA", "skill_key", "ez_q", "source_key", "damage",
            "data", "{\"expression\":{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"damage\"}}");
    }

    private static Connection connection() throws Exception {
        Connection connection = mock(Connection.class);
        when(connection.getAutoCommit()).thenReturn(true);
        return connection;
    }

    private static TransactionTemplate transaction(Connection... connections) throws Exception {
        DataSource dataSource = mock(DataSource.class);
        if (connections.length == 1) when(dataSource.getConnection()).thenReturn(connections[0]);
        else when(dataSource.getConnection()).thenReturn(connections[0], java.util.Arrays.copyOfRange(connections, 1, connections.length));
        return new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    }
}
