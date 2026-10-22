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
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTargetCounterTimeWriteGuardTest {
    private static final String GAME = "game", OWNER = "mark_owner", WRITE = "isolated target mark authoring write";
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

    @Test void realFinalGuardCommitsAndIndexesTheOwnMarkAndActualSiblingEvent() throws Exception {
        var after = objects();
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(List.of(), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(snapshot(List.of(), false), snapshot(after, false));
        Connection connection = connection();
        transaction(connection).execute(status -> { guard.begin(GAME); jdbc.update(WRITE); return null; });
        var refs = SkillObjectReferences.extract(GAME, after);
        assertTrue(refs.stream().anyMatch(ref -> ref.fieldPath().equals("eventSource.detail.sourceSkillKey") && ref.target().key().equals("actual_active")));
        assertTrue(refs.stream().anyMatch(ref -> ref.fieldPath().equals("conditionGroups[0].conditions[0].detail.stateKey") && ref.target().skillKey().equals(OWNER)));
        assertTrue(refs.stream().anyMatch(ref -> ref.fieldPath().equals("actions[0].detail.stateKey") && ref.target().skillKey().equals(OWNER)));
        verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), argThat((List<Object[]> entries) -> entries.size() == refs.size()));
        verify(connection).commit();
        verify(connection, never()).rollback();
    }

    @ParameterizedTest @ValueSource(strings = {"STATE_SCOPE", "STATE_KIND", "NO_DURATION", "ZERO_DURATION", "FRACTIONAL_DURATION", "PARAMETER_DURATION_ZERO", "ENSURE_ZERO", "COMPARE_FRACTION"})
    void laterDependencyMutationsRollBackBusinessWriteBeforeReferenceIndexReplacement(String change) throws Exception {
        var before = objects(); var after = objects();
        ObjectNode state = (ObjectNode) after.getFirst().data();
        ObjectNode duration = (ObjectNode) state.path("detail");
        switch (change) {
            case "STATE_SCOPE" -> state.put("scope", "SKILL");
            case "STATE_KIND" -> state.put("stateType", "AMMO");
            case "NO_DURATION" -> duration.remove("durationValue");
            case "ZERO_DURATION" -> duration.set("durationValue", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":0}"));
            case "FRACTIONAL_DURATION" -> duration.set("durationValue", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":0.5}"));
            case "PARAMETER_DURATION_ZERO" -> { }
            case "ENSURE_ZERO" -> ((ObjectNode) after.get(1).data().path("actions").get(0).path("detail")).set("value", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":0}"));
            case "COMPARE_FRACTION" -> ((ObjectNode) after.get(1).data().path("conditionGroups").get(0).path("conditions").get(0).path("detail"))
                .set("comparisonValue", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":0.5}"));
            default -> throw new IllegalArgumentException(change);
        }
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(rows(before), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(snapshot(before, false), snapshot(after, change.equals("PARAMETER_DURATION_ZERO")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, GAME)).thenReturn(referenceRows(SkillObjectReferences.extract(GAME, before)));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, GAME)).thenReturn(parameters(change.equals("PARAMETER_DURATION_ZERO")));
        Connection connection = connection();
        assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin(GAME); jdbc.update(WRITE); return null; }));
        verify(connection).rollback();
        verify(connection, never()).commit();
        verify(jdbc, never()).update(eq(GameConfigurationWriteGuard.DELETE_SOURCE_SQL), any(), any(), any(), any());
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    @Test void qualifiedConditionReadDoesNotAuthorizeTheSameRuntimeBindingOrCooldownEvent() {
        var state = SkillTargetCounterTimeSemanticsTest.state(); var rule = SkillTargetCounterTimeSemanticsTest.rule();
        assertDoesNotThrow(() -> SkillQualifiedReferenceSemantics.validate(List.of(rule), List.of(state, rule)));
        ObjectNode data = (ObjectNode) rule.data();
        ObjectNode binding = ((ObjectNode) data.path("actions").get(0)).withArray("runtimeInputBindings").addObject();
        binding.put("sourceType", "INTERNAL_STATE").set("detail", data.path("conditionGroups").get(0).path("conditions").get(0).path("detail").deepCopy());
        assertThrows(ApiException.class, () -> SkillQualifiedReferenceSemantics.validate(List.of(rule), List.of(state, rule)));
        ((ObjectNode) data.path("actions").get(0)).withArray("runtimeInputBindings").removeAll();
        ObjectNode event = (ObjectNode) data.path("eventSource"); event.put("eventType", "INTERNAL_STATE_CHANGED");
        event.set("detail", AggregateJson.tree("{\"stateSkillKey\":\"mark_owner\",\"stateKey\":\"mark\",\"changeKind\":\"COOLDOWN_READY\"}"));
        assertThrows(ApiException.class, () -> SkillQualifiedReferenceSemantics.validate(List.of(rule), List.of(state, rule)));
    }

    @Test void qualifiedTargetConditionRequiresExplicitOwnSkillEvenIfLegacyOwnerFallbackCouldResolve() {
        var state = SkillTargetCounterTimeSemanticsTest.state(); var rule = SkillTargetCounterTimeSemanticsTest.rule();
        ((ObjectNode) rule.data().path("conditionGroups").get(0).path("conditions").get(0).path("detail")).remove("stateSkillKey");
        assertThrows(ApiException.class, () -> SkillQualifiedReferenceSemantics.validate(List.of(rule), List.of(state, rule)));
        var foreignState = new Aggregate(SourceType.STATE, "another_owner", "mark", state.data());
        ((ObjectNode) rule.data().path("conditionGroups").get(0).path("conditions").get(0).path("detail")).put("stateSkillKey", "another_owner");
        assertThrows(ApiException.class, () -> SkillQualifiedReferenceSemantics.validate(List.of(rule), List.of(foreignState, rule)));
    }

    private static List<Aggregate> objects() {
        var state = SkillTargetCounterTimeSemanticsTest.state();
        ((ObjectNode) state.data().path("detail")).set("durationValue", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"duration\"}"));
        return List.of(state, SkillTargetCounterTimeSemanticsTest.rule());
    }

    @ParameterizedTest @ValueSource(strings = {"VALID_INTERVAL", "ZERO_INTERVAL", "PULSE_STATE_WRITE", "EXPIRE_SELF_REARM", "DELETED_PROCESS", "READER_SCOPE", "PARAMETER_ZERO",
        "READER_PHASE", "READER_RESERVATION", "OLD_ENSURE_PHASE", "OLD_ENSURE_RESERVATION", "LATER_PHASE_DECLARATION", "LATER_RESERVATION_DECLARATION"})
    void targetTimingSingleEntityChangesUseTheExistingFinalTransactionAndRollbackBeforeIndexWrites(String change) throws Exception {
        ObjectNode beforeConfig = TargetTimingAuthoringFixture.configuration(), afterConfig = TargetTimingAuthoringFixture.configuration();
        if (change.equals("PARAMETER_ZERO")) {
            for (ObjectNode config : List.of(beforeConfig, afterConfig)) ((ObjectNode) TargetTimingAuthoringFixture.find(config, "internalStates", "stateKey", "slot_1")
                .path("detail").path("targetTiming")).set("intervalValue", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"duration\"}"));
        } else if (change.equals("VALID_INTERVAL") || change.equals("ZERO_INTERVAL")) {
            ((ObjectNode) TargetTimingAuthoringFixture.find(afterConfig, "internalStates", "stateKey", "slot_1").path("detail").path("targetTiming"))
                .set("intervalValue", TargetTimingAuthoringFixture.fixed(change.equals("VALID_INTERVAL") ? 300 : 0));
        } else if (change.equals("PULSE_STATE_WRITE")) {
            TargetTimingAuthoringFixture.find(afterConfig, "processes", "processKey", "pulse").withArray("stateOperations")
                .add(TargetTimingAuthoringFixture.find(afterConfig, "processes", "processKey", "burst").path("stateOperations").get(0).deepCopy());
        } else if (change.equals("EXPIRE_SELF_REARM")) {
            ObjectNode op = (ObjectNode) TargetTimingAuthoringFixture.find(afterConfig, "processes", "processKey", "burst").path("stateOperations").get(0);
            op.put("stateKey", "pending"); op.set("value", TargetTimingAuthoringFixture.fixed(1));
        } else if (change.equals("DELETED_PROCESS")) {
            var list = afterConfig.withArray("processes");
            for (int index = list.size() - 1; index >= 0; index--) if (list.get(index).path("processKey").asText().equals("pulse")) list.remove(index);
        } else if (change.equals("READER_SCOPE")) TargetTimingAuthoringFixture.find(afterConfig, "internalStates", "stateKey", "count").put("scope", "SKILL");
        else if (change.startsWith("READER_")) {
            ((ObjectNode) TargetTimingAuthoringFixture.find(afterConfig, "triggerRules", "ruleKey", "refund").path("conditionGroups").get(0).path("conditions").get(0).path("detail"))
                .put("stateKey", change.equals("READER_PHASE") ? "slot_1" : "pending");
        } else if (change.startsWith("OLD_ENSURE_")) {
            ObjectNode rule = TargetTimingAuthoringFixture.find(afterConfig, "triggerRules", "ruleKey", "apply_hit");
            ObjectNode action = (ObjectNode) rule.path("actions").get(1).deepCopy();
            ((ObjectNode) action.path("detail")).put("operation", "ENSURE_REMAINING").put("stateKey", change.equals("OLD_ENSURE_PHASE") ? "slot_1" : "pending");
            rule.putArray("actions").add(action); rule.putArray("conditionGroups");
            rule.set("eventSource", AggregateJson.tree("{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"actual_active\",\"useKind\":\"ACTIVE\",\"castPhase\":\"INITIAL\"}}"));
        } else if (change.startsWith("LATER_")) {
            for (ObjectNode config : List.of(beforeConfig, afterConfig)) ((ObjectNode) TargetTimingAuthoringFixture.find(config, "internalStates", "stateKey", "count").path("detail"))
                .set("maxValue", TargetTimingAuthoringFixture.fixed(1));
            ObjectNode count = TargetTimingAuthoringFixture.find(afterConfig, "internalStates", "stateKey", "count");
            // 只交换声明所属状态，既有伤害前值规则仍必须按引用重验。
            ObjectNode donor = (ObjectNode) TargetTimingAuthoringFixture.find(afterConfig, "internalStates", "stateKey",
                change.equals("LATER_PHASE_DECLARATION") ? "slot_2" : "pending").path("detail");
            ((ObjectNode) count.path("detail")).set("targetTiming", donor.path("targetTiming").deepCopy());
            donor.remove("targetTiming");
        }
        var before = TargetTimingAuthoringFixture.aggregates(beforeConfig); var after = TargetTimingAuthoringFixture.aggregates(afterConfig);
        var extendedCatalog = new ArrayList<>(catalog());
        for (String attribute : List.of("hp", "mana")) extendedCatalog.add(Map.of("target_type", "ATTRIBUTE", "skill_key", "", "object_key", attribute));
        extendedCatalog.add(Map.of("target_type", "DAMAGE_TYPE", "skill_key", "", "object_key", "magic"));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, GAME)).thenReturn(extendedCatalog);
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(rows(before), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(snapshot(before, false), snapshot(after, change.equals("PARAMETER_ZERO")));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, GAME)).thenReturn(referenceRows(SkillObjectReferences.extract(GAME, before)));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, GAME)).thenReturn(parameters(change.equals("PARAMETER_ZERO")));
        Connection connection = connection();
        if (change.equals("VALID_INTERVAL")) {
            assertDoesNotThrow(() -> transaction(connection).execute(status -> { guard.begin(GAME); jdbc.update(WRITE); return null; }));
            verify(connection).commit(); verify(connection, never()).rollback();
            verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
        } else {
            assertThrows(ApiException.class, () -> transaction(connection).execute(status -> { guard.begin(GAME); jdbc.update(WRITE); return null; }));
            verify(connection).rollback(); verify(connection, never()).commit();
            verify(jdbc, never()).update(eq(GameConfigurationWriteGuard.DELETE_SOURCE_SQL), any(), any(), any(), any());
            verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
        }
    }
    private static List<Map<String, Object>> parameters(boolean invalid) {
        return List.of(Map.of("skill_key", OWNER, "parameter_key", "duration", "value_type", "INTEGER", "value_mode", "SKILL_LEVEL",
            "level_values", invalid ? "{\"1\":6000,\"2\":0}" : "{\"1\":6000,\"2\":7000}"));
    }
    private static List<Map<String, Object>> catalog() {
        return List.of(Map.of("target_type", "SKILL", "skill_key", "", "object_key", OWNER),
            Map.of("target_type", "SKILL", "skill_key", "", "object_key", "actual_active"),
            Map.of("target_type", "PARAMETER", "skill_key", OWNER, "object_key", "duration"));
    }
    private static List<Map<String, Object>> rows(List<Aggregate> objects) {
        return objects.stream().map(a -> Map.<String, Object>of("source_type", a.type().name(), "skill_key", a.skillKey(), "source_key", a.key(), "data", a.data().toString())).toList();
    }
    private static List<Map<String, Object>> snapshot(List<Aggregate> objects, boolean invalid) {
        var result = new ArrayList<>(objects.stream().map(a -> Map.<String, Object>of("object_type", a.type().name(), "skill_key", a.skillKey(), "object_key", a.key(), "data", a.data().toString())).toList());
        for (String skill : List.of(OWNER, "actual_active")) result.add(Map.of("object_type", "SKILL", "skill_key", "", "object_key", skill, "data", "{\"status\":\"ENABLED\"}"));
        // 快照使用真正的 JSON，让仅参数发生变化也沿现有索引触发状态与规则重验。
        result.add(Map.of("object_type", "PARAMETER", "skill_key", OWNER, "object_key", "duration", "data", AggregateJson.tree(
            "{\"value_mode\":\"SKILL_LEVEL\",\"value_type\":\"INTEGER\",\"level_values\":{" + (invalid ? "\"1\":6000,\"2\":0" : "\"1\":6000,\"2\":7000") + "}}").toString()));
        return result;
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
