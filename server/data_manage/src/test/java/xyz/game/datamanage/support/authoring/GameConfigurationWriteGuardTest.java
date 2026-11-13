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

import java.math.BigDecimal;
import java.sql.Connection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.CsvSource;
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
    private static final String DELETE_SQL = GameConfigurationWriteGuard.DELETE_SOURCE_SQL;
    @Mock private JdbcTemplate jdbc;
    private GameConfigurationWriteGuard guard;

    @BeforeEach
    void setUp() {
        guard = new GameConfigurationWriteGuard(jdbc);
        lenient().when(jdbc.queryForObject("SHOW transaction_isolation", String.class)).thenReturn("read committed");
        lenient().when(jdbc.queryForList(LOCK_SQL, String.class, "lol")).thenReturn(List.of("lol"));
        lenient().when(jdbc.queryForList(GameVampRuleSemantics.RULES_SQL, String.class, "lol")).thenReturn(List.of());
        lenient().when(jdbc.queryForList(GameVampRuleSemantics.CATEGORIES_SQL, String.class, "lol")).thenReturn(List.of());
        lenient().when(jdbc.queryForList(GameVampRuleSemantics.ATTRIBUTES_SQL, "lol")).thenReturn(List.of());
        lenient().when(jdbc.queryForList(GameVampRuleSemantics.SKILL_CATEGORIES_SQL, "lol")).thenReturn(List.of());
        lenient().when(jdbc.queryForList(HealingRatioMaxSemantics.ZONES_SQL, "lol")).thenReturn(List.of());
        lenient().when(jdbc.queryForList(eq(GameConfigurationWriteGuard.AGGREGATES_SQL), anyString())).thenReturn(List.of());
        lenient().when(jdbc.queryForList(eq(GameConfigurationWriteGuard.REFERENCES_SQL), anyString())).thenReturn(List.of());
        lenient().when(jdbc.queryForList(eq(GameConfigurationWriteGuard.SNAPSHOT_SQL), anyString())).thenReturn(List.of());
        lenient().when(jdbc.queryForList(eq(GameConfigurationWriteGuard.CATALOG_SQL), anyString())).thenReturn(List.of());
        lenient().when(jdbc.queryForList(eq(GameCalculationRuleSemantics.RULES_SQL), eq(String.class), anyString())).thenReturn(List.of());
        lenient().when(jdbc.queryForList(eq(SkillNumericSemantics.PARAMETERS_SQL), anyString())).thenReturn(List.of());
        // 以下既有用例描述事务中写入给定的最终组成；起始快照尚无这些对象。
        AtomicInteger snapshots = new AtomicInteger();
        lenient().when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenAnswer(ignored ->
            snapshots.getAndIncrement() == 0 ? List.of()
                : snapshotRows(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")));
    }

    @AfterEach
    void noTransactionResourceLeaked() {
        assertNull(TransactionSynchronizationManager.getResource(guard));
        assertTrue(TransactionSynchronizationManager.getResourceMap().isEmpty());
        assertTrue(!TransactionSynchronizationManager.isActualTransactionActive());
    }

    @Test
    void finalPassiveDelayWithARealTailCanCommitTogether() throws Exception {
        Connection connection = connection();
        var objects = List.of(ProcessBehaviorTestData.row(ProcessBehaviorTestData.waitProcess("waiter")),
            ProcessBehaviorTestData.row(ProcessBehaviorTestData.rule("after", "waiter", "consume")),
            ProcessBehaviorTestData.row(ProcessBehaviorTestData.leafProcess("consume")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(objects);
        transaction(connection).execute(tx -> { guard.begin("lol"); jdbc.update("isolated complete passive process graph"); return null; });
        verify(connection).commit(); verify(connection, never()).rollback();
    }

    @ParameterizedTest
    @ValueSource(strings = {"last_tail_removed", "last_leaf_behavior_removed"})
    void deletingTheLastPassiveTailBehaviorRollsBackBeforeReferenceReplacement(String scenario) throws Exception {
        Connection connection = connection();
        var wait = ProcessBehaviorTestData.row(ProcessBehaviorTestData.waitProcess("waiter"));
        var tail = ProcessBehaviorTestData.row(ProcessBehaviorTestData.rule("after", "waiter", "consume"));
        var leaf = ProcessBehaviorTestData.row(ProcessBehaviorTestData.leafProcess("consume"));
        var before = List.of(wait, tail, leaf);
        var after = scenario.equals("last_tail_removed") ? List.of(wait, leaf)
            : List.of(wait, tail, ProcessBehaviorTestData.row(ProcessBehaviorTestData.waitProcess("consume")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol"))
            .thenReturn(snapshotRows(before), snapshotRows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(after);
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(tx -> {
            guard.begin("lol"); jdbc.update("isolated remove last passive behavior"); return null;
        }));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertTrue(error.getDetails().toString().contains("PROCESS_BEHAVIOR_REQUIRED"));
        verify(connection).rollback(); verify(connection, never()).commit();
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
    }

    @Test
    void changingOnlyMultiplierParameterRevalidatesTheUnchangedEffectBeforeCommit() throws Exception {
        Connection connection = connection();
        var effect = CooldownDurationTestData.effect();
        ((com.fasterxml.jackson.databind.node.ObjectNode) effect.path("results").get(0).path("valueRule"))
            .set("value", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"factor\"}"));
        Map<String, Object> object = Map.of("source_type", "EFFECT", "skill_key", "caster_skill", "source_key", "buff", "data", effect.toString());
        var before = new java.util.ArrayList<>(snapshotRows(List.of(object)));
        var after = new java.util.ArrayList<>(snapshotRows(List.of(object)));
        before.add(Map.of("object_type", "PARAMETER", "skill_key", "caster_skill", "object_key", "factor", "data", "{\"fixedValue\":0.5}"));
        after.add(Map.of("object_type", "PARAMETER", "skill_key", "caster_skill", "object_key", "factor", "data", "{\"fixedValue\":0}"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(before, after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(object));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_skill_key", "caster_skill", "source_type", "EFFECT", "source_key", "buff", "field_path", "results[0].valueRule.value.parameterKey",
            "target_type", "PARAMETER", "target_skill_key", "caster_skill", "target_key", "factor", "target_sub_key", "")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "PARAMETER", "skill_key", "caster_skill", "object_key", "factor"),
            Map.of("target_type", "SKILL", "skill_key", "", "object_key", "target_skill")));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, "lol")).thenReturn(List.of(Map.of(
            "skill_key", "caster_skill", "parameter_key", "factor", "value_type", "DECIMAL", "value_mode", "FIXED", "fixed_value", 0)));
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(tx -> {
            guard.begin("lol"); jdbc.update("isolated multiplier change"); return null;
        }));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        assertTrue(error.getDetails().toString().contains("VALUE_RANGE_INVALID"));
        verify(connection).rollback(); verify(connection, never()).commit();
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
    }

    @ParameterizedTest @ValueSource(strings = {"scope", "duration", "moment"})
    void finalEffectMutationsCannotBypassTheDurationModifierPositionContract(String scenario) throws Exception {
        Connection connection = connection();
        var beforeEffect = CooldownDurationTestData.effect();
        var afterEffect = beforeEffect.deepCopy();
        if (scenario.equals("scope")) ((com.fasterxml.jackson.databind.node.ObjectNode) afterEffect.path("lifecycle")).put("instanceScope", "TARGET");
        if (scenario.equals("duration")) ((com.fasterxml.jackson.databind.node.ObjectNode) afterEffect.path("lifecycle")).set("durationValue", CooldownDurationTestData.fixed("0"));
        if (scenario.equals("moment")) ((com.fasterxml.jackson.databind.node.ObjectNode) afterEffect.path("results").get(0).path("lifecycleBehavior")).put("moment", "APPLICATION");
        Map<String, Object> before = Map.of("source_type", "EFFECT", "skill_key", "caster_skill", "source_key", "buff", "data", beforeEffect.toString());
        Map<String, Object> after = Map.of("source_type", "EFFECT", "skill_key", "caster_skill", "source_key", "buff", "data", afterEffect.toString());
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(before), List.of(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(snapshotRows(List.of(before)), snapshotRows(List.of(after)));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(Map.of("target_type", "SKILL", "skill_key", "", "object_key", "target_skill")));
        assertThrows(ApiException.class, () -> transaction(connection).execute(tx -> {
            guard.begin("lol"); jdbc.update("isolated duration shape change"); return null;
        }));
        verify(connection).rollback(); verify(connection, never()).commit();
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
    }

    @Test
    void deletingASkillReferencedByDurationScopeRollsBackTheWholeTransaction() throws Exception {
        Connection connection = connection();
        Map<String, Object> effect = Map.of("source_type", "EFFECT", "skill_key", "caster_skill", "source_key", "buff", "data", CooldownDurationTestData.effect().toString());
        var before = new java.util.ArrayList<>(snapshotRows(List.of(effect)));
        before.add(Map.of("object_type", "SKILL", "skill_key", "", "object_key", "target_skill", "data", "{\"status\":\"ENABLED\"}"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(effect));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(before, snapshotRows(List.of(effect)));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_skill_key", "caster_skill", "source_type", "EFFECT", "source_key", "buff", "field_path", "results[0].detail.affectedSkillScope.skillKeys[0]",
            "target_type", "SKILL", "target_skill_key", "", "target_key", "target_skill", "target_sub_key", "")));
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(tx -> {
            guard.begin("lol"); jdbc.update("isolated target skill deletion"); return null;
        }));
        assertTrue(error.getDetails().toString().contains("target_skill"));
        verify(connection).rollback(); verify(connection, never()).commit();
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
    }

    @Test
    void finalChannelEndpointChangeRollsBackBeforeReferenceReplacement() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "PARAMETER", "skill_key", "ez_q", "object_key", "last")));
        List<Map<String, Object>> objects = List.of(Map.of("source_type", "PROCESS", "skill_key", "ez_q", "source_key", "cast", "data", """
            {"steps":[{"stepKey":"channel","stepType":"CHANNEL","detail":{"firstExecution":"CUSTOM_WINDOW",
             "durationValue":{"kind":"FIXED","value":20},"executionCountValue":{"kind":"FIXED","value":4},
             "firstExecutionOffsetValue":{"kind":"FIXED","value":2},"lastExecutionOffsetValue":{"kind":"PARAMETER","parameterKey":"last"}}}],
             "cooldown":null,"effectBindings":[],"stateOperations":[]}
            """));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(objects);
        List<Map<String, Object>> beforeRows = new java.util.ArrayList<>(snapshotRows(objects));
        List<Map<String, Object>> afterRows = new java.util.ArrayList<>(snapshotRows(objects));
        beforeRows.add(Map.of("object_type", "PARAMETER", "skill_key", "ez_q", "object_key", "last", "data", "{\"fixed_value\":13}"));
        afterRows.add(Map.of("object_type", "PARAMETER", "skill_key", "ez_q", "object_key", "last", "data", "{\"fixed_value\":4}"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(beforeRows, afterRows);
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_skill_key", "ez_q", "source_type", "PROCESS", "source_key", "cast",
            "field_path", "steps[0].detail.lastExecutionOffsetValue.parameterKey", "target_type", "PARAMETER", "target_skill_key", "ez_q",
            "target_key", "last", "target_sub_key", "")));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, "lol")).thenReturn(List.of(Map.of(
            "skill_key", "ez_q", "parameter_key", "last", "value_type", "INTEGER", "value_mode", "FIXED", "fixed_value", 4)));
        ApiException failure = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE channel endpoint for test");
            return null;
        }));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", failure.getCode());
        assertTrue(failure.getDetails().toString().contains("CHANNEL_WINDOW_INVALID"));
        verify(connection).rollback();
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
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
    void changingOnlyAProcessCannotInvalidateAnUnchangedReplacementRoleAtCommit() throws Exception {
        Connection connection = connection();
        var effect = SkillAttackDamageRoleSemanticsTest.effect("REPLACE_PRIMARY");
        var original = SkillAttackDamageRoleSemanticsTest.process();
        var changed = SkillAttackDamageRoleSemanticsTest.process();
        ((com.fasterxml.jackson.databind.node.ObjectNode) changed.data().path("steps").get(0)).put("stepType", "DELAY");
        var effectRow = Map.<String, Object>of("source_type", "EFFECT", "skill_key", effect.skillKey(), "source_key", effect.key(), "data", effect.data().toString());
        var originalRow = Map.<String, Object>of("source_type", "PROCESS", "skill_key", original.skillKey(), "source_key", original.key(), "data", original.data().toString());
        var changedRow = Map.<String, Object>of("source_type", "PROCESS", "skill_key", changed.skillKey(), "source_key", changed.key(), "data", changed.data().toString());
        var before = List.of(effectRow, originalRow);
        var after = List.of(effectRow, changedRow);
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(before, after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(snapshotRows(before), snapshotRows(after));
        ApiException failure = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE replacement process for test");
            return null;
        }));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", failure.getCode());
        assertTrue(failure.getDetails().toString().contains("ATTACK_DAMAGE_ROLE_INVALID"));
        verify(connection).rollback();
        verify(connection, never()).commit();
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
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
        verify(jdbc).update(DELETE_SQL, "lol", "ez_q", "FORMULA", "damage");
        @SuppressWarnings("unchecked") ArgumentCaptor<List<Object[]>> rows = ArgumentCaptor.forClass(List.class);
        verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), rows.capture());
        assertEquals(List.of("lol", "ez_q", "FORMULA", "damage", "expression/inputs/0/binding/parameterKey", "PARAMETER", "ez_q", "damage", ""),
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
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
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
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
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
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
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
                "field_path", "results[0].valueRule.value.formulaKey", "target_type", "FORMULA", "target_skill_key", "ez_q",
                "target_key", "damage", "target_sub_key", "")));
        Connection connection = connection();
        ApiException error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            guard.assertNotReferenced("lol", "FORMULA", "ez_q", "damage", "409.SKILL_FORMULA_IN_USE", "技能公式被引用");
            return null;
        }));
        assertEquals("409.SKILL_FORMULA_IN_USE", error.getCode());
        assertTrue(error.getDetails().get("fieldIssues").toString().contains("results[0].valueRule.value.formulaKey"));
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

    @Test
    void finalLevelExpansionZeroRollsBackBusinessWriteBeforeReferenceReplacement() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "PARAMETER", "skill_key", "ez_q", "object_key", "count")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_type", "PROCESS", "skill_key", "ez_q", "source_key", "cast", "data", """
                {"steps":[{"stepKey":"repeat","stepType":"MULTI_HIT","detail":{
                  "repeatCountValue":{"kind":"PARAMETER","parameterKey":"count"}}}],
                 "cooldown":null,"effectBindings":[],"stateOperations":[]}
                """)));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, "lol")).thenReturn(List.of(Map.of(
            "skill_key", "ez_q", "parameter_key", "count", "value_type", "INTEGER", "value_mode", "SKILL_LEVEL",
            "level_values", "{\"1\":1,\"2\":0}")));
        ApiException failure = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE parameter levels for test");
            return null;
        }));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", failure.getCode());
        assertTrue(failure.getDetails().toString().contains("VALUE_RANGE_INVALID"));
        verify(jdbc).update("UPDATE parameter levels for test");
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void finalRecastIntervalParameterChangedToZeroRollsBackBusinessWrite() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "PARAMETER", "skill_key", "ez_q", "object_key", "gap")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_type", "PROCESS", "skill_key", "ez_q", "source_key", "cast", "data", """
                {"activationType":"ACTIVE","steps":[{"stepKey":"again","stepType":"RECAST","sortOrder":0,
                  "detail":{"windowValue":{"kind":"FIXED","value":15000},"maximumRecastCountValue":{"kind":"FIXED","value":2},
                    "intervalValue":{"kind":"PARAMETER","parameterKey":"gap"}}}],"effectBindings":[],"stateOperations":[]}
                """)));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, "lol")).thenReturn(List.of(Map.of(
            "skill_key", "ez_q", "parameter_key", "gap", "value_type", "INTEGER", "value_mode", "FIXED", "fixed_value", BigDecimal.ZERO)));
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol"); jdbc.update("UPDATE recast interval for test"); return null;
        }));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        assertTrue(error.getDetails().toString().contains("steps[0].detail.intervalValue"));
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback(); verify(connection, never()).commit();
    }

    @Test
    void finalProtectionCooldownParameterChangedToZeroRollsBackBusinessWrite() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "PARAMETER", "skill_key", "ez_q", "object_key", "cooldown")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_type", "TRIGGER", "skill_key", "ez_q", "source_key", "rule", "data", """
                {"eventSource":{"eventType":"BASIC_ATTACK_START","detail":{}},"conditionGroups":[],"actions":[],
                 "limits":{"perTargetCooldown":{"durationValue":{"kind":"PARAMETER","parameterKey":"cooldown"}}}}
                """)));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, "lol")).thenReturn(List.of(Map.of(
            "skill_key", "ez_q", "parameter_key", "cooldown", "value_type", "DECIMAL", "value_mode", "FIXED",
            "fixed_value", BigDecimal.ZERO)));
        ApiException failure = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE protection cooldown for test");
            return null;
        }));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", failure.getCode());
        assertTrue(failure.getDetails().toString().contains("VALUE_RANGE_INVALID"));
        assertTrue(failure.getDetails().toString().contains("perTargetCooldown.durationValue"));
        verify(jdbc).update("UPDATE protection cooldown for test");
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void finalLifecycleScopeMismatchRollsBackBeforeReferenceReplacement() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of());
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(
            Map.of("source_type", "EFFECT", "skill_key", "ez_q", "source_key", "mark", "data",
                "{\"results\":[],\"lifecycle\":{\"instanceScope\":\"SKILL\"}}"),
            Map.of("source_type", "TRIGGER", "skill_key", "ez_q", "source_key", "rule", "data", """
                {"eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},"actions":[],
                 "conditionGroups":[{"conditions":[{"conditionType":"LIFECYCLE_CHECK","detail":{
                  "effectSkillKey":"ez_q","effectKey":"mark","subject":"CURRENT_TARGET","checkKind":"PRESENT"}}]}]}
                """)));
        ApiException failure = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE lifecycle scope for test");
            return null;
        }));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", failure.getCode());
        assertTrue(failure.getDetails().toString().contains("conditionGroups[0].conditions[0].detail.subject"));
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @ParameterizedTest
    @ValueSource(strings = {"ATTRIBUTE_REMOVED", "INTEGER", "FIXED", "EVENT_CHANGED"})
    void sourceCastCostFinalChangesRollBackBusinessWrites(String change) throws Exception {
        Connection connection = connection();
        List<Map<String, Object>> catalog = new java.util.ArrayList<>();
        catalog.add(Map.of("target_type", "SKILL", "skill_key", "", "object_key", "source_skill"));
        catalog.add(Map.of("target_type", "PARAMETER", "skill_key", "skill", "object_key", "cost"));
        if (!"ATTRIBUTE_REMOVED".equals(change)) catalog.add(Map.of("target_type", "ATTRIBUTE", "skill_key", "", "object_key", "mana"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(catalog);
        List<Map<String, Object>> objects = SourceCastResourceCostSemanticsTest.objects(
            "EVENT_CHANGED".equals(change) ? "SKILL_USED" : "SKILL_HIT", "source_skill", "{\"attributeKey\":\"mana\"}")
            .stream().map(a -> Map.<String, Object>of("source_type", a.type().name(), "skill_key", a.skillKey(),
                "source_key", a.key(), "data", a.data().toString())).toList();
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(objects);
        if (!"ATTRIBUTE_REMOVED".equals(change)) {
            when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, "lol")).thenReturn(List.of(Map.of(
                "skill_key", "skill", "parameter_key", "cost", "value_type", "INTEGER".equals(change) ? "INTEGER" : "DECIMAL",
                "value_mode", "FIXED".equals(change) ? "FIXED" : "RUNTIME_INPUT", "fixed_value", BigDecimal.ZERO)));
        }
        ApiException failure = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE source cost configuration for test");
            return null;
        }));
        assertEquals("ATTRIBUTE_REMOVED".equals(change) ? "409.SKILL_OBJECT_REFERENCE_INVALID" : "400.INVALID_SKILL_NUMERIC_VALUE", failure.getCode());
        assertTrue(failure.getDetails().toString().contains("actions[0].runtimeInputBindings[0]"));
        verify(jdbc).update("UPDATE source cost configuration for test");
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_USED", "BASIC_ATTACK_START"})
    void finalTargetCategoryEventChangeRollsBackBeforeReferenceReplacement(String event) throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of());
        var rule = SkillTargetCategoryConditionSemanticsTest.rule(event, "{\"categories\":[\"CHAMPION\"]}");
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_type", "TRIGGER", "skill_key", rule.skillKey(), "source_key", rule.key(), "data", rule.data().toString())));
        ApiException error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE category event for test");
            return null;
        }));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
        assertTrue(error.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
        verify(jdbc).update("UPDATE category event for test");
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void finalExplicitSelfTargetEventChangeRollsBackBeforeReferenceReplacement() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of());
        var rule = SkillExplicitTargetIsSourceConditionSemanticsTest.rule("SKILL_HIT", "{}");
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_type", "TRIGGER",
            "skill_key", rule.skillKey(),
            "source_key", rule.key(),
            "data", rule.data().toString()
        )));

        ApiException error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE explicit self target event for test");
            return null;
        }));

        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
        assertTrue(error.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
        verify(jdbc).update("UPDATE explicit self target event for test");
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @ParameterizedTest
    @ValueSource(strings = {"CONDITION_EVENT", "BINDING_EVENT", "BINDING_DOMAIN"})
    void finalSkillHitShieldEventOrDomainChangeRollsBack(String change) throws Exception {
        Connection connection = connection();
        boolean condition = "CONDITION_EVENT".equals(change);
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(condition ? List.of()
            : List.of(Map.of("target_type", "PARAMETER", "skill_key", "skill", "object_key", "flag")));
        var objects = condition ? List.of(SkillHitShieldValueSemanticsTest.condition("BASIC_ATTACK_HIT", "0"))
            : SkillHitShieldValueSemanticsTest.binding("BINDING_DOMAIN".equals(change) ? "DAMAGE_DEALT" : "BASIC_ATTACK_HIT",
                "BINDING_DOMAIN".equals(change) ? "RAW_DAMAGE" : "SKILL_HIT_SPELL_SHIELD_BLOCKED");
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(objects.stream().map(a ->
            Map.<String, Object>of("source_type", a.type().name(), "skill_key", a.skillKey(), "source_key", a.key(), "data", a.data().toString())).toList());
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, "lol")).thenReturn(condition ? List.of() : List.of(Map.of(
            "skill_key", "skill", "parameter_key", "flag", "value_type", "INTEGER", "value_mode", "RUNTIME_INPUT")));
        ApiException error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE shield event for test");
            return null;
        }));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        assertTrue(error.getDetails().toString().contains("BINDING_DOMAIN".equals(change) ? "REFERENCE_TYPE_MISMATCH" : "EVENT_VALUE_NOT_AVAILABLE"));
        verify(jdbc).update("UPDATE shield event for test");
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void finalHealingRatioMaxCombinationBypassRollsBackBeforeReferenceReplacement() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "MODIFIER_ZONE", "skill_key", "", "object_key", "foo")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_type", "EFFECT", "skill_key", "skill", "source_key", "effect", "data", """
                {"results":[{"resultKey":"grievous","resultType":"HEALING_MODIFIER","detail":{
                  "modifierZoneKey":"foo","direction":"DONE","operation":"INCREASE","healingKind":"ANY"},
                  "valueRule":{"value":{"kind":"FIXED","value":0.4},"fixedMultiplier":1}}]}
                """)));
        when(jdbc.queryForList(HealingRatioMaxSemantics.ZONES_SQL, "lol")).thenReturn(List.of(Map.of(
            "modifier_zone_key", "foo", "domain", "HEALING", "calculation_mode", "RATIO_MAX")));
        ApiException error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE healing modifier bypass for test");
            return null;
        }));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("results[0].detail.direction"));
        assertTrue(error.getDetails().toString().contains("results[0].detail.operation"));
        verify(jdbc).update("UPDATE healing modifier bypass for test");
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void finalHealingRatioMaxKeepsRatioAddIncrease() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "MODIFIER_ZONE", "skill_key", "", "object_key", "healing_ratio_max")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_type", "EFFECT", "skill_key", "skill", "source_key", "effect", "data", """
                {"results":[{"resultKey":"boost","resultType":"HEALING_MODIFIER","detail":{
                  "modifierZoneKey":"healing_ratio_max","direction":"DONE","operation":"INCREASE","healingKind":"DIRECT"},
                  "valueRule":{"value":{"kind":"FIXED","value":0.4},"fixedMultiplier":1}}]}
                """)));
        when(jdbc.queryForList(HealingRatioMaxSemantics.ZONES_SQL, "lol")).thenReturn(List.of(Map.of(
            "modifier_zone_key", "healing_ratio_max", "domain", "HEALING", "calculation_mode", "RATIO_ADD")));
        transaction(connection).execute(status -> {
            guard.begin("lol");
            return null;
        });
        verify(jdbc).update(DELETE_SQL, "lol", "skill", "EFFECT", "effect");
        verify(connection).commit();
    }

    @Test
    void finalOncePerUseIllegalEventRollsBackBeforeReferenceReplacement() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of());
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_type", "TRIGGER", "skill_key", "skill", "source_key", "used", "data", """
                {"eventSource":{"eventType":"SKILL_USED","detail":{"useKind":"ANY"}},
                 "conditionGroups":[],"actions":[],
                 "limits":{"oncePerUse":{"groupKey":"eclipse","scope":"SKILL"}}}
                """)));
        ApiException error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE once per use bypass for test");
            return null;
        }));
        assertEquals("409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("ONCE_PER_USE_EVENT_INVALID"));
        assertTrue(error.getDetails().toString().contains("limits.oncePerUse"));
        verify(jdbc).update("UPDATE once per use bypass for test");
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void deletingTheReleaseRootRespectsTheExplicitAutomaticReleaseDeclaration(boolean automaticRelease) throws Exception {
        Connection connection = connection();
        Map<String, Object> process = Map.of("source_type", "PROCESS", "skill_key", "charge_skill", "source_key", "cast", "data", """
            {"activationType":"ACTIVE","steps":[{"stepKey":"charge","stepType":"CHARGE","detail":{"releaseAtMaximum":%s}}],"effectBindings":[],"stateOperations":[]}
            """.formatted(automaticRelease));
        Map<String, Object> initial = Map.of("source_type", "TRIGGER", "skill_key", "charge_skill", "source_key", "initial", "data", """
            {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"charge_skill","castPhase":"INITIAL"}},
             "conditionGroups":[],"actions":[{"actionType":"START_PROCESS","detail":{"processKey":"cast"},"runtimeInputBindings":[]}]}
            """);
        Map<String, Object> release = Map.of("source_type", "TRIGGER", "skill_key", "charge_skill", "source_key", "release", "data", """
            {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"charge_skill","castPhase":"CHARGE_RELEASE"}},
             "conditionGroups":[],"actions":[{"actionType":"ADVANCE_PROCESS","detail":{"processKey":"cast","stepKey":"charge"},"runtimeInputBindings":[]}]}
            """);
        Map<String, Object> hit = Map.of("source_type", "TRIGGER", "skill_key", "charge_skill", "source_key", "hit", "data", """
            {"eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"charge_skill"}},
             "conditionGroups":[{"conditions":[{"conditionType":"EVENT_VALUE_COMPARE","detail":{"eventValueKey":"CHARGE_DURATION_MS"}}]}],"actions":[]}
            """);
        List<Map<String, Object>> before = List.of(process, initial, release, hit);
        List<Map<String, Object>> after = List.of(process, initial, hit);
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(before, after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(snapshotRows(before), snapshotRows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of());
        if (automaticRelease) {
            transaction(connection).execute(status -> { guard.begin("lol"); return null; });
            verify(connection).commit();
            verify(connection, never()).rollback();
            return;
        }
        ApiException error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            return null;
        }));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
        assertTrue(error.getDetails().toString().contains("sourceKey=hit"));
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    private static Map<String, Object> formulaRow() {
        return Map.of("source_type", "FORMULA", "skill_key", "ez_q", "source_key", "damage",
            "data", "{\"expression\":{\"inputs\":[{\"key\":\"input_0\",\"binding\":{\"kind\":\"parameter\",\"skillKey\":\"ez_q\",\"parameterKey\":\"damage\"}}],\"stages\":[{\"key\":\"output\",\"name\":\"原技能公式输出\",\"expression\":{\"op\":\"read\",\"inputKey\":\"input_0\"}}],\"outputStageKey\":\"output\"}}");
    }

    @ParameterizedTest
    @ValueSource(strings = {"RULE_DELETED", "CATEGORY_DELETED", "ATTRIBUTE_INTEGER"})
    void finalVampConfigurationChangeRollsBackBusinessWrite(String change) throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of());
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_type", "EFFECT", "skill_key", "skill", "source_key", "effect", "data", """
            {"results":[{"resultKey":"hit","resultType":"DAMAGE","detail":{
              "deliveryKind":"SKILL","originKind":"DIRECT","vampQualification":"RESOLVED","vampOverrides":[]}}]}
            """)));
        when(jdbc.queryForList(GameVampRuleSemantics.RULES_SQL, String.class, "lol")).thenReturn(
            "RULE_DELETED".equals(change) ? List.of() : List.of("""
                {"vampType":"OMNIVAMP","sourceAttributeKey":"vamp","basisOutputKind":"POST_DEFENSE_DAMAGE",
                 "defaultEfficiency":1,"deliveryKinds":["SKILL"],"originKinds":["DIRECT"],"skillCategoryKeys":["common"]}
                """));
        when(jdbc.queryForList(GameVampRuleSemantics.ATTRIBUTES_SQL, "lol")).thenReturn(List.of(Map.of(
            "attribute_key", "vamp", "value_type", "ATTRIBUTE_INTEGER".equals(change) ? "INTEGER" : "DECIMAL")));
        when(jdbc.queryForList(GameVampRuleSemantics.CATEGORIES_SQL, String.class, "lol")).thenReturn(
            "CATEGORY_DELETED".equals(change) ? List.of() : List.of("common"));
        when(jdbc.queryForList(GameVampRuleSemantics.SKILL_CATEGORIES_SQL, "lol")).thenReturn(List.of(Map.of(
            "skill_key", "skill", "skill_category_key", "common")));
        List<Map<String, Object>> finalSnapshot = snapshotRows(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(
            List.of(Map.of("object_type", "VAMP_RULE", "skill_key", "", "object_key", "OMNIVAMP", "data", "{}")),
            finalSnapshot);
        ApiException error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE vamp configuration for test");
            return null;
        }));
        assertEquals("409.GAME_VAMP_RULE_INVALID", error.getCode());
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void unrelatedOldCompositionAndItsIndexRemainUntouched() throws Exception {
        Connection connection = connection();
        Map<String, Object> old = Map.of("source_type", "EFFECT", "skill_key", "outside",
            "source_key", "old", "data", "{\"results\":[{\"resultType\":\"LEGACY\"}]}");
        List<Map<String, Object>> current = List.of(old, formulaRow());
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(old), current);
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol"))
            .thenReturn(snapshotRows(List.of(old)), snapshotRows(current));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "PARAMETER", "skill_key", "ez_q", "object_key", "damage")));
        transaction(connection).execute(status -> { guard.begin("lol"); return null; });
        verify(jdbc).update(DELETE_SQL, "lol", "ez_q", "FORMULA", "damage");
        verify(jdbc, never()).update(DELETE_SQL, "lol", "outside", "EFFECT", "old");
        verify(jdbc, never()).update("DELETE FROM public.skill_object_references WHERE game_id = ?", "lol");
        verify(connection).commit();
    }

    @Test
    void unchangedConfigurationDoesNotRewriteAnyReference() throws Exception {
        Connection connection = connection();
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(formulaRow()));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol"))
            .thenReturn(snapshotRows(List.of(formulaRow())));
        transaction(connection).execute(status -> { guard.begin("lol"); return null; });
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
        verify(connection).commit();
    }

    @ParameterizedTest @ValueSource(strings={"ENABLED","DISABLED"})
    void skillFormulaDependencyDisableKeepsDisabledSkillReferences(String status) throws Exception {
        Connection connection=connection();
        var expression=xyz.game.datamanage.support.formula.SkillFormulaFixtures.attribute("source","armor","TOTAL");
        Map<String,Object> object=Map.of("source_type","FORMULA","skill_key","ez_q","source_key","damage",
            "data",new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().set("expression",expression).toString());
        var before=new java.util.ArrayList<>(snapshotRows(List.of(object)));
        var after=new java.util.ArrayList<>(snapshotRows(List.of(object)));
        var skill=Map.<String,Object>of("object_type","SKILL","skill_key","","object_key","ez_q","data","{\"status\":\""+status+"\"}");
        before.add(skill);after.add(skill);before.add(attributeSnapshot("ENABLED"));after.add(attributeSnapshot("DISABLED"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL,"lol")).thenReturn(List.of(object));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL,"lol")).thenReturn(before,after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL,"lol")).thenReturn(List.of(Map.of("target_type","ATTRIBUTE","skill_key","","object_key","armor")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL,"lol")).thenReturn(List.of(Map.of(
            "source_skill_key","ez_q","source_type","FORMULA","source_key","damage","field_path","expression/inputs/0/binding/attributeKey",
            "target_type","ATTRIBUTE","target_skill_key","","target_key","armor","target_sub_key","")));
        if(status.equals("ENABLED")) {
            var error=assertThrows(ApiException.class,()->transaction(connection).execute(tx->{guard.begin("lol");return null;}));
            assertEquals("409.SKILL_FORMULA_INVALID",error.getCode());verify(connection).rollback();
        } else {transaction(connection).execute(tx->{guard.begin("lol");return null;});verify(connection).commit();}
        verify(jdbc,never()).update(eq(DELETE_SQL),any(),any(),any(),any());
    }

    @Test void reenablingSkillChecksAllFormulaDeclarationsAndRollsBack() throws Exception {
        Connection connection=connection();
        var expression=xyz.game.datamanage.support.formula.SkillFormulaFixtures.attribute("source","armor","TOTAL");
        ((com.fasterxml.jackson.databind.node.ObjectNode)expression.path("stages").get(0)).set("expression",AggregateJson.tree("{\"op\":\"const\",\"value\":\"1\"}"));
        Map<String,Object> object=Map.of("source_type","FORMULA","skill_key","ez_q","source_key","damage",
            "data",new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().set("expression",expression).toString());
        var before=new java.util.ArrayList<>(snapshotRows(List.of(object)));
        var after=new java.util.ArrayList<>(snapshotRows(List.of(object)));
        before.add(Map.of("object_type","SKILL","skill_key","","object_key","ez_q","data","{\"status\":\"DISABLED\"}"));
        after.add(Map.of("object_type","SKILL","skill_key","","object_key","ez_q","data","{\"status\":\"ENABLED\"}"));
        before.add(attributeSnapshot("DISABLED"));after.add(attributeSnapshot("DISABLED"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL,"lol")).thenReturn(List.of(object));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL,"lol")).thenReturn(before,after);
        var error=assertThrows(ApiException.class,()->transaction(connection).execute(tx->{guard.begin("lol");return null;}));
        assertEquals("409.SKILL_FORMULA_INVALID",error.getCode());verify(connection).rollback();
    }

    private static List<Map<String, Object>> snapshotRows(List<Map<String, Object>> aggregates) {
        return aggregates.stream().map(row -> Map.<String, Object>of(
            "object_type", row.get("source_type"), "skill_key", row.get("skill_key"),
            "object_key", row.get("source_key"), "data", row.get("data"))).toList();
    }

    @ParameterizedTest @ValueSource(strings = {"ENABLED", "DISABLED"})
    void dependencyDisableChecksOnlyEnabledDamageTypeAndKeepsItsIndex(String typeStatus) throws Exception {
        Connection connection = connection();
        var object = damageTypeRow(typeStatus);
        var before = new java.util.ArrayList<>(snapshotRows(List.of(object)));
        before.add(attributeSnapshot("ENABLED"));
        var after = new java.util.ArrayList<>(snapshotRows(List.of(object)));
        after.add(attributeSnapshot("DISABLED"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(object));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(before, after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(List.of(damageTypeReference()));
        if (typeStatus.equals("ENABLED")) {
            var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin("lol"); return null; }));
            assertEquals("409.DAMAGE_TYPE_FORMULA_INVALID", error.getCode());
            assertTrue(error.getDetails().toString().contains("FORMULA_UNKNOWN_BINDING"));
            verify(connection).rollback();
        } else {
            when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
                Map.of("target_type", "ATTRIBUTE", "skill_key", "", "object_key", "armor")));
            transaction(connection).execute(status -> { guard.begin("lol"); return null; });
            verify(connection).commit();
        }
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
    }

    @Test void inactiveDamageTypeStillProtectsDependencyDeletion() throws Exception {
        Connection connection = connection();
        var object = damageTypeRow("DISABLED");
        var before = new java.util.ArrayList<>(snapshotRows(List.of(object)));
        before.add(attributeSnapshot("DISABLED"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(object));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(before, snapshotRows(List.of(object)));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(List.of(damageTypeReference()));
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin("lol"); return null; }));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
        verify(connection).rollback();
    }

    @Test void typeReenableRejectsDisabledDependencyAndRollsBack() throws Exception {
        Connection connection = connection();
        var before = new java.util.ArrayList<>(snapshotRows(List.of(damageTypeRow("DISABLED"))));
        before.add(attributeSnapshot("DISABLED"));
        var after = new java.util.ArrayList<>(snapshotRows(List.of(damageTypeRow("ENABLED"))));
        after.add(attributeSnapshot("DISABLED"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(damageTypeRow("DISABLED")), List.of(damageTypeRow("ENABLED")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(before, after);
        assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin("lol"); return null; }));
        verify(connection).rollback();
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @Test void clearingFormulaRemovesOnlyDamageTypeSourceIndex() throws Exception {
        Connection connection = connection();
        var old = damageTypeRow("ENABLED");
        Map<String, Object> cleared = Map.of("source_type", "DAMAGE_TYPE", "skill_key", "", "source_key", "heat",
            "data", "{\"status\":\"ENABLED\",\"formula\":null}");
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(old), List.of(cleared));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(snapshotRows(List.of(old)), snapshotRows(List.of(cleared)));
        transaction(connection).execute(status -> { guard.begin("lol"); return null; });
        verify(jdbc).update(DELETE_SQL, "lol", "", "DAMAGE_TYPE", "heat");
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
        verify(connection).commit();
    }

    @Test void referenceIndexFailureRollsBackFormulaWriteInSameTransaction() throws Exception {
        Connection connection = connection();
        var object = damageTypeRow("ENABLED");
        var after = new java.util.ArrayList<>(snapshotRows(List.of(object)));
        after.add(attributeSnapshot("ENABLED"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(List.of(), List.of(object));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(List.of(attributeSnapshot("ENABLED")), after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "ATTRIBUTE", "skill_key", "", "object_key", "armor")));
        when(jdbc.batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class)))
            .thenThrow(new org.springframework.dao.DataIntegrityViolationException("test index failure"));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol");
            jdbc.update("UPDATE formula for transaction test");
            return null;
        }));
        verify(jdbc).update(DELETE_SQL, "lol", "", "DAMAGE_TYPE", "heat");
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    private static Map<String, Object> damageTypeRow(String status) {
        var data = new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().put("status", status);
        data.set("formula", xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition("1", "armor"));
        return Map.of("source_type", "DAMAGE_TYPE", "skill_key", "", "source_key", "heat", "data", data.toString());
    }

    @Test void disablingDamageTypeCannotBeAuthorizedByItsAggregateForAnEnabledSkill() throws Exception {
        Connection connection = connection();
        Map<String, Object> effect = Map.of("source_type", "EFFECT", "skill_key", "active", "source_key", "hit", "data",
            "{\"results\":[{\"resultKey\":\"damage\",\"resultType\":\"DAMAGE\",\"detail\":{\"damageTypeKey\":\"heat\",\"deliveryKind\":\"SKILL\",\"originKind\":\"DIRECT\",\"vampQualification\":\"UNRESOLVED\",\"vampOverrides\":[]}}]}");
        var before = new java.util.ArrayList<>(snapshotRows(List.of(damageTypeRow("ENABLED"), effect)));
        var after = new java.util.ArrayList<>(snapshotRows(List.of(damageTypeRow("DISABLED"), effect)));
        Map<String, Object> active = Map.of("object_type", "SKILL", "skill_key", "", "object_key", "active", "data", "{\"status\":\"ENABLED\"}");
        before.add(active); after.add(active);
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol"))
            .thenReturn(List.of(damageTypeRow("ENABLED"), effect), List.of(damageTypeRow("DISABLED"), effect));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(before, after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(List.of(Map.of(
            "source_skill_key", "active", "source_type", "EFFECT", "source_key", "hit", "field_path", "results[0].detail.damageTypeKey",
            "target_type", "DAMAGE_TYPE", "target_skill_key", "", "target_key", "heat", "target_sub_key", "")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "DAMAGE_TYPE", "skill_key", "", "object_key", "heat"),
            Map.of("target_type", "ATTRIBUTE", "skill_key", "", "object_key", "armor")));
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin("lol"); return null; }));
        assertEquals("409.DAMAGE_TYPE_IN_USE", error.getCode());
        verify(connection).rollback();
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void formulaChangePreservesUnmodifiedProcessButChangedProcessStillRequiresOwner(boolean changeProcess) throws Exception {
        Connection connection = connection();
        var oldFormula = Map.<String, Object>of("source_type", "FORMULA", "skill_key", "active", "source_key", "duration", "data",
            "{\"expression\":{\"inputs\":[],\"stages\":[{\"key\":\"output\",\"name\":\"输出\",\"expression\":{\"op\":\"const\",\"value\":\"1\"}}],\"outputStageKey\":\"output\"}}");
        var newFormula = new java.util.HashMap<>(oldFormula);
        newFormula.put("data", ((String) oldFormula.get("data")).replace("\"1\"", "\"2\""));
        var process = Map.<String, Object>of("source_type", "PROCESS", "skill_key", "active", "source_key", "cast", "data", """
            {"activationType":"PASSIVE","steps":[],"cooldown":{"durationValue":{"kind":"FORMULA","formulaKey":"duration"}},
             "effectBindings":[],"stateOperations":[{"operationKey":"enable","stateKey":"ready","operation":"ENABLE"}]}
            """);
        var state = Map.<String, Object>of("source_type", "STATE", "skill_key", "active", "source_key", "ready", "data",
            "{\"stateType\":\"FLAG\",\"scope\":\"SOURCE\",\"detail\":{\"initialEnabled\":false}}");
        var oldObjects = List.of(oldFormula, process, state);
        var afterProcess = new java.util.HashMap<>(process);
        if (changeProcess) afterProcess.put("data", ((String) process.get("data")).replace("PASSIVE", "ACTIVE"));
        var newObjects = List.of((Map<String, Object>) newFormula, (Map<String, Object>) afterProcess, state);
        var before = new java.util.ArrayList<>(snapshotRows(oldObjects));
        var after = new java.util.ArrayList<>(snapshotRows(newObjects));
        var active = Map.<String, Object>of("object_type", "SKILL", "skill_key", "", "object_key", "active", "data", "{\"status\":\"ENABLED\"}");
        before.add(active); after.add(active);
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(before, after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(oldObjects, newObjects);
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(List.of(
            Map.of("source_skill_key", "active", "source_type", "PROCESS", "source_key", "cast", "field_path", "cooldown.durationValue.formulaKey",
                "target_type", "FORMULA", "target_skill_key", "active", "target_key", "duration", "target_sub_key", ""),
            Map.of("source_skill_key", "active", "source_type", "PROCESS", "source_key", "cast", "field_path", "stateOperations[0].stateKey",
                "target_type", "STATE", "target_skill_key", "active", "target_key", "ready", "target_sub_key", "")));
        if (changeProcess) {
            var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin("lol"); return null; }));
            assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
            assertTrue(error.getDetails().toString().contains("stateOperations[0].stateSkillKey"));
            verify(connection).rollback();
        } else {
            transaction(connection).execute(status -> { guard.begin("lol"); return null; });
            verify(connection).commit();
            verify(jdbc, never()).update(DELETE_SQL, "lol", "active", "PROCESS", "cast");
        }
    }

    @ParameterizedTest @ValueSource(strings = {"new_disabled", "rebind_enabled", "removed_reference", "deleted_source", "skill_restart"})
    void changedDamageReferencesReplaceRetiredIndexAndSkillRestartChecksTarget(String scenario) throws Exception {
        Connection connection = connection();
        var beforeEffect = Map.<String, Object>of("source_type", "EFFECT", "skill_key", "active", "source_key", "hit", "data",
            "{\"results\":[{\"resultKey\":\"damage\",\"resultType\":\"DAMAGE\",\"detail\":{\"damageTypeKey\":\"heat\",\"deliveryKind\":\"SKILL\",\"originKind\":\"DIRECT\",\"vampQualification\":\"UNRESOLVED\",\"vampOverrides\":[]}}]}");
        var afterEffect = new java.util.HashMap<>(beforeEffect);
        if (scenario.equals("rebind_enabled")) afterEffect.put("data", ((String) beforeEffect.get("data")).replace("heat", "magic"));
        if (scenario.equals("removed_reference")) afterEffect.put("data", "{\"results\":[]}");
        var oldObjects = scenario.equals("new_disabled") ? List.<Map<String, Object>>of() : List.of(beforeEffect);
        var newObjects = scenario.equals("deleted_source") ? List.<Map<String, Object>>of() : List.of((Map<String, Object>) afterEffect);
        var before = new java.util.ArrayList<>(snapshotRows(oldObjects));
        var after = new java.util.ArrayList<>(snapshotRows(newObjects));
        String oldTypeStatus = scenario.equals("new_disabled") || scenario.equals("skill_restart") ? "DISABLED" : "ENABLED";
        before.add(Map.of("object_type", "DAMAGE_TYPE", "skill_key", "", "object_key", "heat", "data", "{\"status\":\"" + oldTypeStatus + "\"}"));
        after.add(Map.of("object_type", "DAMAGE_TYPE", "skill_key", "", "object_key", "heat", "data", "{\"status\":\"DISABLED\"}"));
        var magic = Map.<String, Object>of("object_type", "DAMAGE_TYPE", "skill_key", "", "object_key", "magic", "data", "{\"status\":\"ENABLED\"}");
        before.add(magic); after.add(magic);
        before.add(Map.of("object_type", "SKILL", "skill_key", "", "object_key", "active", "data",
            "{\"status\":\"" + (scenario.equals("skill_restart") ? "DISABLED" : "ENABLED") + "\"}"));
        after.add(Map.of("object_type", "SKILL", "skill_key", "", "object_key", "active", "data", "{\"status\":\"ENABLED\"}"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(before, after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(oldObjects, newObjects);
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, "lol")).thenReturn(List.of(
            Map.of("target_type", "DAMAGE_TYPE", "skill_key", "", "object_key", "heat"),
            Map.of("target_type", "DAMAGE_TYPE", "skill_key", "", "object_key", "magic")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(oldObjects.isEmpty() ? List.of() : List.of(Map.of(
            "source_skill_key", "active", "source_type", "EFFECT", "source_key", "hit", "field_path", "results[0].detail.damageTypeKey",
            "target_type", "DAMAGE_TYPE", "target_skill_key", "", "target_key", "heat", "target_sub_key", "")));
        if (scenario.equals("new_disabled") || scenario.equals("skill_restart")) {
            var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin("lol"); return null; }));
            assertEquals("409.DAMAGE_TYPE_IN_USE", error.getCode());
            verify(connection).rollback();
        } else {
            transaction(connection).execute(status -> { guard.begin("lol"); return null; });
            verify(connection).commit();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"disable", "delete", "invalid_type", "integer_type"})
    void gameCalculationBindingsRevalidateTheFinalAttributeStateWithoutSkillIndexOwnership(String scenario) throws Exception {
        Connection connection = connection();
        String configuration = """
            {"criticalChanceAttributeKey":"chance","criticalMultiplierMin":0,"attackSpeedAttributeKey":null,"attributeDerivations":[],
             "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
            """;
        when(jdbc.queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "lol")).thenReturn(List.of(configuration));
        Map<String, Object> before = calculationAttribute("chance", "DECIMAL", "ENABLED");
        List<Map<String, Object>> after = switch (scenario) {
            case "delete" -> List.of();
            case "disable" -> List.of(calculationAttribute("chance", "DECIMAL", "DISABLED"));
            case "invalid_type" -> List.of(calculationAttribute("chance", "INVALID", "ENABLED"));
            default -> List.of(calculationAttribute("chance", "INTEGER", "ENABLED"));
        };
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(List.of(before), after);
        if (scenario.equals("integer_type")) {
            transaction(connection).execute(status -> { guard.begin("lol"); jdbc.update("isolated attribute change"); return null; });
            verify(connection).commit();
        } else {
            var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
                guard.begin("lol"); jdbc.update("isolated attribute change"); return null;
            }));
            assertEquals("409.GAME_CALCULATION_RULES_INVALID", error.getCode());
            assertTrue(error.getDetails().toString().contains("/configuration/criticalChanceAttributeKey"));
            verify(connection).rollback();
            verify(connection, never()).commit();
        }
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @Test void removingTheCalculationReferenceInTheSameTransactionAllowsFinalAttributeDeletion() throws Exception {
        Connection connection = connection();
        String beforeConfiguration = """
            {"criticalChanceAttributeKey":"chance","criticalMultiplierMin":1,"attackSpeedAttributeKey":null,"attributeDerivations":[],
             "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
            """;
        String afterConfiguration = beforeConfiguration.replace("\"chance\"", "null");
        when(jdbc.queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "lol"))
            .thenReturn(List.of(beforeConfiguration), List.of(afterConfiguration));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol"))
            .thenReturn(List.of(calculationAttribute("chance", "DECIMAL", "ENABLED")), List.of());
        transaction(connection).execute(status -> { guard.begin("lol"); return null; });
        verify(connection).commit();
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @Test void unrelatedSkillWritesDoNotForceAnUnchangedIncompleteCalculationDraftToBecomeRunnable() throws Exception {
        Connection connection = connection();
        String unchanged = """
            {"criticalChanceAttributeKey":null,"criticalMultiplierMin":null,"attackSpeedAttributeKey":null,"attributeDerivations":[],
             "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
            """;
        when(jdbc.queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "lol")).thenReturn(List.of(unchanged));
        transaction(connection).execute(status -> { guard.begin("lol"); return null; });
        verify(connection).commit();
        verify(jdbc, never()).queryForList(GameCalculationRuleSemantics.ATTRIBUTES_SQL, "lol");
    }

    @Test void newlyWrittenUnauthorizedGameFormulaRollsBackWithoutAnySkillReferenceReplacement() throws Exception {
        Connection connection = connection();
        String invalid = """
            {"criticalChanceAttributeKey":null,"criticalMultiplierMin":null,"attackSpeedAttributeKey":null,
             "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[],
             "attributeDerivations":[{"ruleKey":"rule","attributeKey":"velocity","valuePolicy":"set","activationAttributeKeys":["growth"],
               "formula":{"inputs":[{"key":"x","binding":{"kind":"parameter","skillKey":"skill","parameterKey":"amount"}}],
                 "stages":[{"key":"result","name":"结果","expression":{"op":"const","value":"1"}}],"outputStageKey":"result"}}]}
            """;
        when(jdbc.queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "lol")).thenReturn(List.of(), List.of(invalid));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(List.of(
            calculationAttribute("velocity", "DECIMAL", "ENABLED"), calculationAttribute("growth", "DECIMAL", "ENABLED")));
        var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol"); jdbc.update("isolated calculation replacement"); return null;
        }));
        assertEquals("409.GAME_CALCULATION_RULES_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("FORMULA_UNKNOWN_BINDING"));
        verify(connection).rollback();
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"result_type", "target", "scope", "no_lifecycle", "no_end", "layers", "second_shield", "delete_result", "delete_effect"})
    void referencedShieldMutationsAndDeletionRollBackWithoutReplacingAnyIndex(String mutation) throws Exception {
        Connection connection = connection();
        var rule = ShieldAbsorptionTestData.rule("skill");
        var shield = ShieldAbsorptionTestData.shield("skill");
        var beforeObjects = List.of(shieldAbsorptionRow(shield), shieldAbsorptionRow(rule));
        var life = (com.fasterxml.jackson.databind.node.ObjectNode) shield.data().path("lifecycle");
        var result = (com.fasterxml.jackson.databind.node.ObjectNode) shield.data().path("results").get(0);
        switch (mutation) {
            case "result_type" -> result.put("resultType", "SPELL_SHIELD");
            case "target" -> result.put("target", "TARGET");
            case "scope" -> life.put("instanceScope", "TARGET");
            case "no_lifecycle" -> ((com.fasterxml.jackson.databind.node.ObjectNode) shield.data()).putNull("lifecycle");
            case "no_end" -> life.putNull("endWhenShieldEndsResultKey");
            case "layers" -> ((com.fasterxml.jackson.databind.node.ObjectNode) life.path("maxStacksValue")).put("value", 2);
            case "second_shield" -> ((com.fasterxml.jackson.databind.node.ArrayNode) shield.data().path("results")).add(result.deepCopy().put("resultKey", "second"));
            case "delete_result" -> ((com.fasterxml.jackson.databind.node.ArrayNode) shield.data().path("results")).removeAll();
        }
        var afterObjects = mutation.equals("delete_effect") ? List.of(shieldAbsorptionRow(rule))
            : List.of(shieldAbsorptionRow(shield), shieldAbsorptionRow(rule));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(beforeObjects, afterObjects);
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(snapshotRows(beforeObjects), snapshotRows(afterObjects));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(List.of(shieldAbsorptionReference()));
        assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin("lol"); jdbc.update("isolated shield change"); return null;
        }));
        verify(connection).rollback();
        verify(connection, never()).commit();
        verify(jdbc, never()).update(eq(DELETE_SQL), any(), any(), any(), any());
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 2})
    void newlyAddedSelectorProvesExistingShieldSingleLayerBeforeCommit(int layers) throws Exception {
        Connection connection = connection();
        var shield = ShieldAbsorptionTestData.shield("skill");
        ((com.fasterxml.jackson.databind.node.ObjectNode) shield.data().path("lifecycle").path("maxStacksValue")).put("value", layers);
        var before = List.of(shieldAbsorptionRow(shield));
        var after = List.of(shieldAbsorptionRow(shield), shieldAbsorptionRow(ShieldAbsorptionTestData.rule("skill")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(before, after);
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(snapshotRows(before), snapshotRows(after));
        if (layers == 2) {
            var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin("lol"); return null; }));
            assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
            verify(connection).rollback();
            verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
        } else {
            transaction(connection).execute(status -> { guard.begin("lol"); return null; });
            verify(connection).commit();
            @SuppressWarnings("unchecked") ArgumentCaptor<List<Object[]>> rows = ArgumentCaptor.forClass(List.class);
            verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), rows.capture());
            assertEquals(1, rows.getValue().size());
            assertEquals(List.of("lol", "skill", "TRIGGER", "first_damage", "conditionGroups[0].conditions[0].detail.shieldResult.resultKey",
                "RESULT", "skill", "barrier", "shield"), java.util.Arrays.asList(rows.getValue().getFirst()));
        }
    }

    @Test
    void deletingBothReadConditionAndShieldInSameTransactionLeavesNoDanglingReference() throws Exception {
        Connection connection = connection();
        var before = List.of(shieldAbsorptionRow(ShieldAbsorptionTestData.shield("skill")),
            shieldAbsorptionRow(ShieldAbsorptionTestData.rule("skill")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, "lol")).thenReturn(before, List.of());
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol")).thenReturn(snapshotRows(before), List.of());
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, "lol")).thenReturn(List.of(shieldAbsorptionReference()), List.of());
        transaction(connection).execute(status -> { guard.begin("lol"); return null; });
        verify(connection).commit();
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    private static Map<String, Object> shieldAbsorptionRow(SkillObjectReferences.Aggregate source) {
        return Map.of("source_type", source.type().name(), "skill_key", source.skillKey(), "source_key", source.key(),
            "data", source.data().toString());
    }

    private static Map<String, Object> shieldAbsorptionReference() {
        return Map.of("source_skill_key", "skill", "source_type", "TRIGGER", "source_key", "first_damage",
            "field_path", "conditionGroups[0].conditions[0].detail.shieldResult.resultKey", "target_type", "RESULT",
            "target_skill_key", "skill", "target_key", "barrier", "target_sub_key", "shield");
    }

    private static Map<String, Object> calculationAttribute(String key, String type, String status) {
        return Map.of("object_type", "ATTRIBUTE", "skill_key", "", "object_key", key,
            "data", "{\"value_type\":\"" + type + "\",\"status\":\"" + status + "\"}");
    }

    @ParameterizedTest
    @CsvSource({"basicAttackCategoryKey,disable", "basicAttackCategoryKey,delete", "basicAttackCategoryKey,rename",
        "equipmentPassiveCategoryKey,disable", "equipmentPassiveCategoryKey,delete", "equipmentPassiveCategoryKey,rename"})
    void calculationCategoryBindingsRevalidateIndependentFinalDirectoryState(String field, String scenario) throws Exception {
        Connection connection = connection();
        var configuration = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree("""
            {"criticalChanceAttributeKey":null,"criticalMultiplierMin":null,"attackSpeedAttributeKey":null,"attributeDerivations":[],
             "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
            """);
        configuration.put(field, "renamed_category");
        when(jdbc.queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "lol")).thenReturn(List.of(configuration.toString()));
        List<Map<String, Object>> after = scenario.equals("delete") ? List.of()
            : List.of(calculationCategory("renamed_category", scenario.equals("disable") ? "DISABLED" : "ENABLED", "修改名称"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol"))
            .thenReturn(List.of(calculationCategory("renamed_category", "ENABLED", "原名称")), after);
        if (scenario.equals("rename")) {
            transaction(connection).execute(status -> { guard.begin("lol"); jdbc.update("isolated category metadata change"); return null; });
            verify(connection).commit();
        } else {
            var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
                guard.begin("lol"); jdbc.update("isolated category change"); return null;
            }));
            assertEquals("409.GAME_CALCULATION_RULES_INVALID", error.getCode());
            assertTrue(error.getDetails().toString().contains("/configuration/" + field));
            verify(connection).rollback();
            verify(connection, never()).commit();
        }
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"disable", "delete", "invalid_type", "integer_type"})
    void declaredIgnorableCostAloneProtectsItsFinalNumericDirectory(String scenario) throws Exception {
        Connection connection = connection();
        String configuration = """
            {"criticalChanceAttributeKey":null,"criticalMultiplierMin":null,"attackSpeedAttributeKey":null,"attributeDerivations":[],
             "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":["custom_cost"]}
            """;
        when(jdbc.queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "lol")).thenReturn(List.of(configuration));
        List<Map<String, Object>> after = switch (scenario) {
            case "delete" -> List.of();
            case "disable" -> List.of(calculationAttribute("custom_cost", "DECIMAL", "DISABLED"));
            case "invalid_type" -> List.of(calculationAttribute("custom_cost", "STRING", "ENABLED"));
            default -> List.of(calculationAttribute("custom_cost", "INTEGER", "ENABLED"));
        };
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol"))
            .thenReturn(List.of(calculationAttribute("custom_cost", "DECIMAL", "ENABLED")), after);
        if (scenario.equals("integer_type")) {
            transaction(connection).execute(status -> { guard.begin("lol"); return null; });
            verify(connection).commit();
        } else {
            var error = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin("lol"); return null; }));
            assertEquals("409.GAME_CALCULATION_RULES_INVALID", error.getCode());
            assertTrue(error.getDetails().toString().contains("/configuration/ignorableCastCostAttributeKeys/0"));
            verify(connection).rollback();
            verify(connection, never()).commit();
        }
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"basicAttackCategoryKey", "equipmentPassiveCategoryKey", "ignorableCastCostAttributeKeys"})
    void removingUsageBindingAllowsItsDirectoryDeletionInTheSameTransaction(String field) throws Exception {
        Connection connection = connection();
        var candidate = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree("""
            {"criticalChanceAttributeKey":null,"criticalMultiplierMin":null,"attackSpeedAttributeKey":null,"attributeDerivations":[],
             "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
            """);
        String after = candidate.toString();
        boolean cost = field.equals("ignorableCastCostAttributeKeys");
        if (cost) candidate.putArray(field).add("custom_cost");
        else candidate.put(field, "renamed_category");
        when(jdbc.queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "lol"))
            .thenReturn(List.of(candidate.toString()), List.of(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, "lol"))
            .thenReturn(List.of(cost ? calculationAttribute("custom_cost", "DECIMAL", "ENABLED")
                : calculationCategory("renamed_category", "ENABLED", "原名称")), List.of());
        transaction(connection).execute(status -> { guard.begin("lol"); return null; });
        verify(connection).commit();
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    private static Map<String, Object> calculationCategory(String key, String status, String name) {
        return Map.of("object_type", "CATEGORY", "skill_key", "", "object_key", key,
            "data", "{\"status\":\"" + status + "\",\"name\":\"" + name + "\"}");
    }

    private static Map<String, Object> attributeSnapshot(String status) {
        return Map.of("object_type", "ATTRIBUTE", "skill_key", "", "object_key", "armor", "data", "{\"status\":\"" + status + "\"}");
    }

    private static Map<String, Object> damageTypeReference() {
        return Map.of("source_skill_key", "", "source_type", "DAMAGE_TYPE", "source_key", "heat",
            "field_path", "inputs/0/binding/attributeKey", "target_type", "ATTRIBUTE", "target_skill_key", "", "target_key", "armor", "target_sub_key", "");
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
