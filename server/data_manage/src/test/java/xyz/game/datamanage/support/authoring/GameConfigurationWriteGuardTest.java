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
            "data", "{\"expression\":{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"damage\"}}");
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

    private static List<Map<String, Object>> snapshotRows(List<Map<String, Object>> aggregates) {
        return aggregates.stream().map(row -> Map.<String, Object>of(
            "object_type", row.get("source_type"), "skill_key", row.get("skill_key"),
            "object_key", row.get("source_key"), "data", row.get("data"))).toList();
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
