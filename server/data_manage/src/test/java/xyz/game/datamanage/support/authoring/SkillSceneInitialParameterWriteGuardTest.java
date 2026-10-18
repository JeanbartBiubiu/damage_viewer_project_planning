package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
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
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillSceneInitialParameterWriteGuardTest {
    private static final String GAME = "game";
    private static final String SKILL = SkillSceneInitialParameterSemanticsTest.SKILL;
    private static final String PARAMETER = "initial_count";
    private static final String WRITE = "test isolated authoring change";
    @Mock private JdbcTemplate jdbc;
    private GameConfigurationWriteGuard guard;

    @BeforeEach void setUp() {
        guard = new GameConfigurationWriteGuard(jdbc);
        when(jdbc.queryForObject("SHOW transaction_isolation", String.class)).thenReturn("read committed");
        when(jdbc.queryForList("SELECT game_id FROM public.games WHERE game_id = ? FOR UPDATE", String.class, GAME))
            .thenReturn(List.of(GAME));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, GAME)).thenReturn(catalogRows(true));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, GAME)).thenReturn(parameters("INTEGER", "RUNTIME_INPUT"));
        when(jdbc.queryForList(HealingRatioMaxSemantics.ZONES_SQL, GAME)).thenReturn(List.of(Map.of(
            "modifier_zone_key", "flat_initial", "domain", "ATTRIBUTE", "calculation_mode", "FLAT_ADD",
            "application_stage", "ATTRIBUTE_FLAT")));
    }

    @AfterEach void transactionResourcesAreAlwaysReleased() {
        assertNull(TransactionSynchronizationManager.getResource(guard));
        assertTrue(TransactionSynchronizationManager.getResourceMap().isEmpty());
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
        assertFalse(TransactionSynchronizationManager.isSynchronizationActive());
    }

    @Test void aNewCompleteAggregateReachesBeforeCommitAndWritesItsActualParameterReference() throws Exception {
        var after = objects(SkillSceneInitialParameterSemanticsTest.DETAIL);
        Set<Target> catalog = Set.of(new Target(TargetType.SKILL, "", SKILL, ""),
            new Target(TargetType.PARAMETER, SKILL, PARAMETER, ""), new Target(TargetType.ATTRIBUTE, "", "armor", ""),
            new Target(TargetType.MODIFIER_ZONE, "", "flat_initial", ""));
        var expected = SkillObjectReferences.extractAndValidate(GAME, after, after, catalog);
        assertTrue(expected.stream().anyMatch(SkillSceneInitialParameterWriteGuardTest::isBindingParameter));
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(List.of(), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(
            snapshot(List.of(), "INTEGER", "RUNTIME_INPUT", true), snapshot(after, "INTEGER", "RUNTIME_INPUT", true));
        Connection connection = connection();
        transaction(connection).execute(status -> {
            guard.begin(GAME);
            assertNotNull(TransactionSynchronizationManager.getResource(guard));
            jdbc.update(WRITE);
            assertNoIndexWrites();
            return null;
        });
        @SuppressWarnings("unchecked") ArgumentCaptor<List<Object[]>> entries = ArgumentCaptor.forClass(List.class);
        verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), entries.capture());
        Set<List<Object>> actualRows = entries.getValue().stream().map(Arrays::asList).collect(Collectors.toSet());
        Set<List<Object>> expectedRows = expected.stream().map(ref -> List.<Object>of(ref.gameId(), ref.sourceSkillKey(),
            ref.sourceType().name(), ref.sourceKey(), ref.fieldPath(), ref.target().type().name(), ref.target().skillKey(),
            ref.target().key(), ref.target().subKey())).collect(Collectors.toSet());
        assertEquals(expectedRows, actualRows);
        assertTrue(actualRows.contains(List.of(GAME, SKILL, "TRIGGER", "initial",
            "actions[0].runtimeInputBindings[0].parameterKey", "PARAMETER", SKILL, PARAMETER, "")));
        assertEquals(2, actualRows.stream().filter(row -> "PARAMETER".equals(row.get(5))).count());
        verify(jdbc, times(2)).queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME);
        verify(jdbc).update(GameConfigurationWriteGuard.DELETE_SOURCE_SQL, GAME, SKILL, "EFFECT", "permanent");
        verify(jdbc).update(GameConfigurationWriteGuard.DELETE_SOURCE_SQL, GAME, SKILL, "TRIGGER", "initial");
        var order = inOrder(jdbc, connection);
        order.verify(jdbc).update(WRITE);
        order.verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
        order.verify(connection).commit();
        verify(connection, never()).rollback();
    }

    @ParameterizedTest
    @ValueSource(strings = {"PARAMETER_FIXED", "INTEGER_FRACTION", "EVENT", "TARGET", "UNUSED",
        "LIFECYCLE_ONLY", "LIFECYCLE_ALSO", "CONDITION_ONLY", "CONDITION_ALSO"})
    void finalDependencyChangesRollBackBeforeDeletingOrInsertingAnyReference(String change) throws Exception {
        String detail = "INTEGER_FRACTION".equals(change) ? "{\"minValue\":0.5,\"maxValue\":5.5}"
            : SkillSceneInitialParameterSemanticsTest.DETAIL;
        String beforeType = "INTEGER_FRACTION".equals(change) ? "DECIMAL" : "INTEGER";
        var before = objects(detail);
        var after = objects(detail);
        ObjectNode effect = (ObjectNode) after.getFirst().data();
        ObjectNode rule = (ObjectNode) after.get(1).data();
        ObjectNode action = (ObjectNode) rule.path("actions").get(0);
        if ("EVENT".equals(change)) ((ObjectNode) rule.path("eventSource")).put("eventType", "BASIC_ATTACK_HIT");
        if ("TARGET".equals(change)) action.put("targetContext", "CURRENT_TARGET");
        if (Set.of("UNUSED", "LIFECYCLE_ONLY", "CONDITION_ONLY").contains(change)) {
            ((ObjectNode) effect.path("results").get(0).path("valueRule"))
                .set("value", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":1}"));
        }
        if (change.startsWith("LIFECYCLE")) {
            ((ObjectNode) effect.path("lifecycle")).set("maxStacksValue",
                AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"initial_count\"}"));
        }
        if (change.startsWith("CONDITION")) {
            rule.set("conditionGroups", AggregateJson.tree("""
                [{"groupKey":"only_when","name":"条件","sortOrder":0,"conditions":[
                  {"conditionKey":"initial_check","conditionType":"ATTRIBUTE_COMPARE","sortOrder":0,
                   "detail":{"subject":"EVENT_SOURCE","attributeKey":"armor","attributeValueKind":"TOTAL",
                   "comparator":"GTE","comparisonValue":{"kind":"PARAMETER","parameterKey":"initial_count"}}}]}]
                """));
        }
        String afterMode = "PARAMETER_FIXED".equals(change) ? "FIXED" : "RUNTIME_INPUT";
        stage(before, beforeType, after, "INTEGER", afterMode);
        Connection connection = connection();
        ApiException failure = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin(GAME);
            jdbc.update(WRITE);
            assertNoIndexWrites();
            return null;
        }));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", failure.getCode(), failure.getDetails().toString());
        String issues = failure.getDetails().toString();
        assertTrue(issues.contains("fieldIssues"));
        if ("INTEGER_FRACTION".equals(change)) assertTrue(issues.contains("RANGE_INVALID"));
        if (Set.of("EVENT", "TARGET").contains(change)) assertTrue(issues.contains("EVENT_VALUE_NOT_AVAILABLE"));
        if (change.startsWith("CONDITION")) assertTrue(issues.contains("conditionGroups"));
        verify(jdbc).update(WRITE);
        assertNoIndexWrites();
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test void anIndexedInitializationParameterCannotBeDeletedByTheEarlyDomainGuard() throws Exception {
        var before = objects(SkillSceneInitialParameterSemanticsTest.DETAIL);
        stage(before, "INTEGER", before, "INTEGER", "RUNTIME_INPUT");
        var reference = SkillObjectReferences.extract(GAME, before).stream().filter(SkillSceneInitialParameterWriteGuardTest::isBindingParameter).findFirst().orElseThrow();
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCED_SQL, GAME, "PARAMETER", SKILL, PARAMETER))
            .thenReturn(referenceRows(List.of(reference)));
        Connection connection = connection();
        ApiException failure = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin(GAME);
            guard.assertNotReferenced(GAME, "PARAMETER", SKILL, PARAMETER, "409.SKILL_PARAMETER_IN_USE", "技能参数被引用");
            jdbc.update(WRITE);
            return null;
        }));
        assertEquals("409.SKILL_PARAMETER_IN_USE", failure.getCode());
        assertTrue(failure.getDetails().toString().contains("actions[0].runtimeInputBindings[0].parameterKey"));
        verify(jdbc, never()).update(WRITE);
        assertNoIndexWrites();
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test void finalParameterDeletionAlsoRollsBackWhenTheEarlyCheckIsNotCalled() throws Exception {
        var before = objects(SkillSceneInitialParameterSemanticsTest.DETAIL);
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(rows(before));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, GAME))
            .thenReturn(referenceRows(SkillObjectReferences.extract(GAME, before)));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(
            snapshot(before, "INTEGER", "RUNTIME_INPUT", true), snapshot(before, "INTEGER", "RUNTIME_INPUT", false));
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, GAME)).thenReturn(catalogRows(false));
        Connection connection = connection();
        ApiException failure = assertThrows(ApiException.class, () -> transaction(connection).execute(status -> {
            guard.begin(GAME);
            jdbc.update(WRITE);
            return null;
        }));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", failure.getCode());
        assertTrue(failure.getDetails().toString().contains("actions[0].runtimeInputBindings[0].parameterKey"));
        assertTrue(failure.getDetails().toString().contains("MISSING_REFERENCE_TARGET"));
        assertNoIndexWrites();
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    private void stage(List<Aggregate> before, String beforeType, List<Aggregate> after, String afterType, String afterMode) {
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(rows(before), rows(after));
        when(jdbc.queryForList(GameConfigurationWriteGuard.REFERENCES_SQL, GAME))
            .thenReturn(referenceRows(SkillObjectReferences.extract(GAME, before)));
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(
            snapshot(before, beforeType, "RUNTIME_INPUT", true), snapshot(after, afterType, afterMode, true));
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, GAME)).thenReturn(parameters(afterType, afterMode));
    }

    private void assertNoIndexWrites() {
        verify(jdbc, never()).update(eq(GameConfigurationWriteGuard.DELETE_SOURCE_SQL), any(), any(), any(), any());
        verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
    }

    private static boolean isBindingParameter(Reference ref) {
        return ref.sourceType() == SkillObjectReferences.SourceType.TRIGGER && ref.target().type() == TargetType.PARAMETER
            && ref.fieldPath().equals("actions[0].runtimeInputBindings[0].parameterKey") && ref.target().key().equals(PARAMETER);
    }

    private static List<Aggregate> objects(String detail) {
        var objects = SkillSceneInitialParameterSemanticsTest.objects(detail);
        ObjectNode effect = (ObjectNode) objects.getFirst().data();
        effect.put("name", "初始化常驻效果").put("sortOrder", 0).putNull("description");
        effect.set("lifecycle", AggregateJson.tree("""
            {"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},
             "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE",
             "reapplicationStackMode":"KEEP","reapplicationDurationMode":"KEEP_REMAINING",
             "expiryMode":"EXPLICIT_ONLY","periodicIntervalValue":null,"firstPeriodicExecution":null}
            """));
        ObjectNode result = (ObjectNode) effect.path("results").get(0);
        result.put("name", "初始护甲加算").put("target", "SOURCE").put("sortOrder", 0).putNull("description").putNull("spellShieldBlockScope");
        result.set("detail", AggregateJson.tree("{\"attributeKey\":\"armor\",\"operation\":\"INCREASE\",\"modifierZoneKey\":\"flat_initial\"}"));
        result.set("lifecycleBehavior", AggregateJson.tree("""
            {"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED",
             "reapplicationValueMode":"REPLACE","periodicExecutionMode":null}
            """));
        ObjectNode rule = (ObjectNode) objects.get(1).data();
        rule.put("name", "初始化规则").put("sortOrder", 0).putNull("description");
        return objects;
    }

    private static List<Map<String, Object>> rows(List<Aggregate> objects) {
        return objects.stream().map(a -> Map.<String, Object>of("source_type", a.type().name(), "skill_key", a.skillKey(),
            "source_key", a.key(), "data", a.data().toString())).toList();
    }

    private static List<Map<String, Object>> snapshot(List<Aggregate> objects, String type, String mode, boolean hasParameter) {
        var result = new ArrayList<>(objects.stream().map(a -> Map.<String, Object>of("object_type", a.type().name(),
            "skill_key", a.skillKey(), "object_key", a.key(), "data", a.data().toString())).toList());
        result.add(Map.of("object_type", "SKILL", "skill_key", "", "object_key", SKILL, "data", "{\"status\":\"ENABLED\"}"));
        result.add(Map.of("object_type", "ATTRIBUTE", "skill_key", "", "object_key", "armor", "data", "{\"status\":\"ENABLED\",\"value_type\":\"DECIMAL\"}"));
        if (hasParameter) result.add(Map.of("object_type", "PARAMETER", "skill_key", SKILL, "object_key", PARAMETER,
            "data", "{\"value_mode\":\"" + mode + "\",\"value_type\":\"" + type + "\"}"));
        return result;
    }

    private static List<Map<String, Object>> catalogRows(boolean hasParameter) {
        var result = new ArrayList<Map<String, Object>>(List.of(
            Map.of("target_type", "SKILL", "skill_key", "", "object_key", SKILL),
            Map.of("target_type", "ATTRIBUTE", "skill_key", "", "object_key", "armor"),
            Map.of("target_type", "MODIFIER_ZONE", "skill_key", "", "object_key", "flat_initial")));
        if (hasParameter) result.add(Map.of("target_type", "PARAMETER", "skill_key", SKILL, "object_key", PARAMETER));
        return result;
    }

    private static List<Map<String, Object>> parameters(String type, String mode) {
        var parameter = new LinkedHashMap<String, Object>(Map.of("skill_key", SKILL, "parameter_key", PARAMETER,
            "value_type", type, "value_mode", mode));
        if ("FIXED".equals(mode)) parameter.put("fixed_value", BigDecimal.ZERO);
        return List.of(parameter);
    }

    private static List<Map<String, Object>> referenceRows(List<Reference> references) {
        return references.stream().map(ref -> Map.<String, Object>of("source_skill_key", ref.sourceSkillKey(),
            "source_type", ref.sourceType().name(), "source_key", ref.sourceKey(), "field_path", ref.fieldPath(),
            "target_type", ref.target().type().name(), "target_skill_key", ref.target().skillKey(),
            "target_key", ref.target().key(), "target_sub_key", ref.target().subKey())).toList();
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
