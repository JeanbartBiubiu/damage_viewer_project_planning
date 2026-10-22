package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationSaveRequest;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 使用实际事务查询的字段投影，避免完整作者配置掩盖持久化读取丢字段。 */
public class TargetTimingTransactionProjectionTest {
    private static final String GAME = "projection_lab", OWNER = TargetTimingAuthoringFixture.OWNER;
    private static final String LEGACY_TRIGGER_PROJECTION = "'eventSource', event_source, 'conditionGroups', condition_groups, 'actions', actions, 'limits', limits";
    private static final List<String> LIMITS = List.of("perTargetCooldown", "maxTriggersPerProcess", "oncePerUse");

    @Test void completeAuthorGraphPassedWhileTheFormerTransactionProjectionLostTailOrder() {
        ObjectNode config = synthetic();
        var complete = TargetTimingAuthoringFixture.aggregates(config);
        assertDoesNotThrow(() -> SkillNumericSemantics.validateTargetTiming(complete, complete, List.of()));
        var old = projected(config, OWNER, LEGACY_TRIGGER_PROJECTION);
        ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validateTargetTiming(old, old, List.of()));
        assertEquals("400.SKILL_TARGET_TIMING_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("sortOrder"));
        assertTrue(error.getDetails().toString().contains("burst"));
    }

    @Test void actualTransactionProjectionRetainsDistinctSixtyNinetyAndCommits() throws Exception {
        ObjectNode config = synthetic();
        var rows = projected(config, OWNER, triggerProjection());
        JsonNode tail = rows.stream().filter(a -> a.type() == SourceType.TRIGGER && a.key().equals("alive_tail")).findFirst().orElseThrow().data();
        assertEquals(90, tail.path("sortOrder").asInt(-1));
        for (String key : LIMITS) {
            assertTrue(tail.has(key));
            assertEquals(tail.path("limits").path(key), tail.path(key));
        }
        assertDoesNotThrow(() -> throughGuard(config, OWNER, List.of()));
        var parsed = org.postgresql.core.Parser.parseJdbcSql(GameConfigurationWriteGuard.AGGREGATES_SQL, true, true, false, false, false);
        assertEquals(1, parsed.size());
        assertEquals(1, parsed.getFirst().bindPositions.length);
    }

    @ParameterizedTest @ValueSource(strings = {"ORDER_COLLISION", "oncePerUse", "perTargetCooldown", "maxTriggersPerProcess"})
    void actualTransactionProjectionDoesNotDropConflictsOrNonemptyTailLimits(String mutation) throws Exception {
        ObjectNode config = synthetic(), tail = TargetTimingAuthoringFixture.find(config, "triggerRules", "ruleKey", "alive_tail");
        if (mutation.equals("ORDER_COLLISION")) tail.put("sortOrder", 60);
        else tail.set(mutation, switch (mutation) {
            case "oncePerUse" -> AggregateJson.tree("{\"groupKey\":\"one_tail\",\"scope\":\"PER_USE\"}");
            case "perTargetCooldown" -> AggregateJson.tree("{\"durationValue\":{\"kind\":\"FIXED\",\"value\":1000}}");
            case "maxTriggersPerProcess" -> AggregateJson.tree("{\"processKey\":\"burst\",\"limitValue\":{\"kind\":\"FIXED\",\"value\":1}}");
            default -> throw new IllegalArgumentException(mutation);
        });
        var all = projected(config, OWNER, triggerProjection());
        var projectedTail = all.stream().filter(a -> a.type() == SourceType.TRIGGER && a.key().equals("alive_tail")).findFirst().orElseThrow().data();
        if (!mutation.equals("ORDER_COLLISION")) assertEquals(tail.path(mutation), projectedTail.path(mutation));
        var error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validateTargetTiming(all, all, List.of()));
        assertEquals("400.SKILL_TARGET_TIMING_INVALID", error.getCode());
        assertThrows(ApiException.class, () -> throughGuard(config, OWNER, List.of()));
    }

    private static ObjectNode synthetic() {
        ObjectNode config = TargetTimingAuthoringFixture.configuration();
        ((ObjectNode) TargetTimingAuthoringFixture.find(config, "processes", "processKey", "burst").path("stateOperations").get(4)).put("sortOrder", 60);
        TargetTimingAuthoringFixture.find(config, "triggerRules", "ruleKey", "alive_tail").put("sortOrder", 90);
        return config;
    }

    private static String triggerProjection() {
        var matcher = Pattern.compile("UNION ALL SELECT 'TRIGGER', skill_key, rule_key,\\s*jsonb_build_object\\((.*?)\\)::text\\s*FROM public.skill_trigger_rules", Pattern.DOTALL)
            .matcher(GameConfigurationWriteGuard.AGGREGATES_SQL);
        assertTrue(matcher.find(), "必须读取生产事务查询中的真实TRIGGER投影");
        return matcher.group(1);
    }

    /** 只解释查询现有的平面列和limits子字段；遇到未知表达式立即失败。此处不执行数据库查询。 */
    private static List<Aggregate> projected(ObjectNode config, String owner, String triggerFields) {
        List<Aggregate> out = new ArrayList<>();
        for (Aggregate author : TargetTimingAuthoringFixture.aggregates(owner, config)) {
            ObjectNode data = (ObjectNode) AggregateJson.tree("{}");
            if (author.type() == SourceType.TRIGGER) {
                String[] pairs = triggerFields.split(",\\s*");
                assertEquals(0, pairs.length % 2);
                ObjectNode limits = (ObjectNode) AggregateJson.tree("{}");
                for (String key : LIMITS) limits.set(key, author.data().path(key).isMissingNode() ? AggregateJson.tree("null") : author.data().path(key));
                for (int i = 0; i < pairs.length; i += 2) {
                    String field = pairs[i].trim(); assertTrue(field.startsWith("'") && field.endsWith("'"));
                    field = field.substring(1, field.length() - 1);
                    String column = pairs[i + 1].trim();
                    JsonNode value;
                    if (column.startsWith("limits->'") && column.endsWith("'")) value = limits.path(column.substring(9, column.length() - 1));
                    else value = switch (column) {
                        case "event_source" -> author.data().path("eventSource");
                        case "condition_groups" -> author.data().path("conditionGroups");
                        case "actions" -> author.data().path("actions");
                        case "sort_order" -> author.data().path("sortOrder");
                        case "limits" -> limits;
                        default -> throw new AssertionError("未覆盖的生产投影表达式：" + column);
                    };
                    data.set(field, value);
                }
            } else for (String field : switch (author.type()) {
                case FORMULA -> List.of("expression");
                case EFFECT -> List.of("results", "lifecycle");
                case STATE -> List.of("stateType", "scope", "detail");
                case PROCESS -> List.of("activationType", "steps", "cooldown", "effectBindings", "stateOperations");
                default -> throw new AssertionError(author.type());
            }) data.set(field, author.data().path(field));
            out.add(new Aggregate(author.type(), author.skillKey(), author.key(), data));
        }
        return out;
    }

    private static void throughGuard(ObjectNode config, String owner, List<Map<String, Object>> parameters) throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class); GameConfigurationWriteGuard guard = new GameConfigurationWriteGuard(jdbc);
        when(jdbc.queryForObject("SHOW transaction_isolation", String.class)).thenReturn("read committed");
        when(jdbc.queryForList("SELECT game_id FROM public.games WHERE game_id = ? FOR UPDATE", String.class, GAME)).thenReturn(List.of(GAME));
        var objects = projected(config, owner, triggerProjection());
        var rows = objects.stream().map(a -> Map.<String, Object>of("source_type", a.type().name(), "skill_key", a.skillKey(), "source_key", a.key(), "data", a.data().toString())).toList();
        when(jdbc.queryForList(GameConfigurationWriteGuard.AGGREGATES_SQL, GAME)).thenReturn(List.of(), rows);
        var snapshot = new ArrayList<>(objects.stream().map(a -> Map.<String, Object>of("object_type", a.type().name(), "skill_key", a.skillKey(), "object_key", a.key(), "data", a.data().toString())).toList());
        var catalog = new ArrayList<Map<String, Object>>();
        for (var ref : SkillObjectReferences.extract(GAME, objects)) if (ref.target().skillKey().isEmpty()
            || ref.target().type() == SkillObjectReferences.TargetType.PARAMETER) {
            catalog.add(Map.of("target_type", ref.target().type().name(), "skill_key", ref.target().skillKey(), "object_key", ref.target().key()));
            if (ref.target().type() == SkillObjectReferences.TargetType.ATTRIBUTE) snapshot.add(Map.of("object_type", "ATTRIBUTE", "skill_key", "", "object_key", ref.target().key(), "data", "{\"status\":\"ENABLED\",\"value_type\":\"DECIMAL\"}"));
        }
        when(jdbc.queryForList(GameConfigurationWriteGuard.CATALOG_SQL, GAME)).thenReturn(catalog);
        when(jdbc.queryForList(GameConfigurationWriteGuard.SNAPSHOT_SQL, GAME)).thenReturn(List.of(), snapshot);
        when(jdbc.queryForList(SkillNumericSemantics.PARAMETERS_SQL, GAME)).thenReturn(parameters);
        when(jdbc.queryForList(GameVampRuleSemantics.RULES_SQL, String.class, GAME)).thenReturn(List.of("""
            {"vampType":"OMNIVAMP","sourceAttributeKey":"omni","basisOutputKind":"POST_DEFENSE_DAMAGE","defaultEfficiency":1,
             "deliveryKinds":["SKILL"],"originKinds":["DIRECT"],"skillCategoryKeys":["passive"]}
            """, """
            {"vampType":"LIFE_STEAL","sourceAttributeKey":"life_steal","basisOutputKind":"POST_DEFENSE_DAMAGE","defaultEfficiency":1,
             "deliveryKinds":["BASIC_ATTACK"],"originKinds":["DIRECT"],"skillCategoryKeys":["basic_attack"]}
            """));
        when(jdbc.queryForList(GameVampRuleSemantics.SKILL_CATEGORIES_SQL, GAME))
            .thenReturn(List.of(Map.of("skill_key", owner, "skill_category_key", "passive")));
        Connection connection = mock(Connection.class); when(connection.getAutoCommit()).thenReturn(true);
        DataSource source = mock(DataSource.class); when(source.getConnection()).thenReturn(connection);
        try {
            new TransactionTemplate(new DataSourceTransactionManager(source)).execute(status -> { guard.begin(GAME); jdbc.update("isolated projected author graph"); return null; });
            verify(connection).commit(); verify(connection, never()).rollback();
            verify(jdbc).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
        } catch (RuntimeException error) {
            verify(connection).rollback(); verify(connection, never()).commit();
            verify(jdbc, never()).batchUpdate(eq(GameConfigurationWriteGuard.INSERT_SQL), any(List.class));
            throw error;
        } finally {
            assertTrue(TransactionSynchronizationManager.getResourceMap().isEmpty());
        }
    }

    /** 一次性真实保存失败调查入口；日常回归只使用上面的完全合成图。 */
    public static void main(String[] args) throws Exception {
        Path folder = Path.of(args[0]);
        var request = AggregateJson.read(Files.readString(folder.resolve("request.json")), SkillConfigurationSaveRequest.class);
        ObjectNode candidate = (ObjectNode) AggregateJson.tree(Files.readString(folder.resolve("before.json")));
        ObjectNode expected = (ObjectNode) AggregateJson.tree(Files.readString(folder.resolve("expected.json")));
        Map<String, String[]> sections = Map.of("PARAMETER", new String[]{"parameters", "parameterKey"}, "FORMULA", new String[]{"formulas", "formulaKey"},
            "EFFECT", new String[]{"effects", "effectKey"}, "INTERNAL_STATE", new String[]{"internalStates", "stateKey"},
            "PROCESS", new String[]{"processes", "processKey"}, "TRIGGER_RULE", new String[]{"triggerRules", "ruleKey"});
        for (var change : request.changes()) {
            var fields = sections.get(change.objectType()); assertNotNull(fields);
            var rows = candidate.withArray(fields[0]); ObjectNode row = null;
            for (JsonNode value : rows) if (value.path(fields[1]).asText().equals(change.key())) row = (ObjectNode) value;
            if (change.operation().equals("CREATE")) { assertNull(row); row = rows.addObject(); }
            else assertEquals("UPDATE", change.operation());
            assertNotNull(row); row.setAll((ObjectNode) change.value()); row.put(fields[1], change.key());
        }
        for (var fields : sections.values()) {
            var actualRows = new LinkedHashMap<String, JsonNode>();
            var expectedRows = new LinkedHashMap<String, JsonNode>();
            for (JsonNode row : candidate.path(fields[0])) actualRows.put(row.path(fields[1]).asText(), business(row));
            for (JsonNode row : expected.path(fields[0])) expectedRows.put(row.path(fields[1]).asText(), business(row));
            assertEquals(expectedRows, actualRows, fields[0]);
        }
        String owner = expected.path("skill").path("skillKey").asText();
        List<SkillNumericSemantics.Parameter> numbers = new ArrayList<>();
        List<Map<String, Object>> parameters = new ArrayList<>();
        for (JsonNode p : candidate.path("parameters")) {
            numbers.add(new SkillNumericSemantics.Parameter(owner, p.path("parameterKey").asText(), p.path("valueType").asText(), p.path("valueMode").asText(), p.hasNonNull("fixedValue") ? p.path("fixedValue").decimalValue() : null, p.hasNonNull("levelValues") ? p.path("levelValues") : null));
            Map<String, Object> row = new LinkedHashMap<>(); row.put("skill_key", owner); row.put("parameter_key", p.path("parameterKey").asText()); row.put("value_type", p.path("valueType").asText()); row.put("value_mode", p.path("valueMode").asText());
            row.put("fixed_value", p.hasNonNull("fixedValue") ? p.path("fixedValue").decimalValue() : null); row.put("level_values", p.hasNonNull("levelValues") ? p.path("levelValues").toString() : null); parameters.add(row);
        }
        var old = projected(candidate, owner, LEGACY_TRIGGER_PROJECTION);
        var error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validateTargetTiming(old, old, numbers));
        assertEquals("400.SKILL_TARGET_TIMING_INVALID", error.getCode()); assertTrue(error.getDetails().toString().contains("sortOrder"));
        var fixed = projected(candidate, owner, triggerProjection());
        SkillNumericSemantics.validateTargetTiming(fixed, fixed, numbers);
        throughGuard(candidate, owner, parameters);
        System.out.println("CAPTURED_REQUEST_PASSED changes=" + request.changes().size() + " owner=" + owner + " legacyError=" + error.getCode() + " fixedProjectionAndFinalGuard=PASSED");
    }

    private static JsonNode business(JsonNode row) {
        ObjectNode result = ((ObjectNode) row).deepCopy(); result.remove(List.of("gameId", "skillKey", "createdAt", "updatedAt")); return result;
    }
}
