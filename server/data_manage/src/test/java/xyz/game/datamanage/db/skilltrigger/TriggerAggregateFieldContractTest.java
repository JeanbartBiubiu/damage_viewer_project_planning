package xyz.game.datamanage.db.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventMoment;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputSourceType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.support.authoring.AggregateJson;

/** 用真实接口序列化字段核对迁移及查询，避免从旧 SQL 列名推断接口字段。 */
class TriggerAggregateFieldContractTest {
    private static final String PART = "db/game_manage/migrations/breaking/aggregate_parts/triggers.sql";
    private static final String TOTAL = "db/game_manage/migrations/breaking/skill_aggregate_migration.sql";
    private static final String READ_MODEL =
        "server/data_manage/src/main/resources/mapper/authoring/AuthoringReadModel.xml";

    @Test
    void eventDetailFieldsMatchSerializedDtoInBothMigrationAndReadModel() throws IOException {
        List<EventCase> cases = List.of(
            new EventCase(SkillTriggerEventType.LIFECYCLE_MOMENT,
                new SkillTriggerLifecycleEventDetail("marked", SkillTriggerLifecycleEventMoment.APPLICATION),
                "triggerRuleLifecycleEvents", Set.of("effect_key", "lifecycle_moment")),
            new EventCase(SkillTriggerEventType.STATUS_CHANGED,
                new SkillTriggerStatusEventDetail(SkillTriggerSubject.CURRENT_TARGET, "burn", SkillTriggerStatusChangeKind.APPLY),
                "triggerRuleStatusEvents", Set.of("subject", "status_key", "change_kind")),
            new EventCase(SkillTriggerEventType.INTERNAL_STATE_CHANGED,
                new SkillTriggerInternalStateEventDetail("counter", SkillTriggerInternalStateChangeKind.VALUE_CHANGED),
                "triggerRuleInternalStateEvents", Set.of("state_key", "change_kind"))
        );
        String readModel = read(READ_MODEL);
        for (EventCase item : cases) {
            Set<String> serializedFields = fields(json(item.detail()));
            String reader = fragment(readModel, item.readerId());
            Map<String, String> readFields = pairs(reader,
                "event_source->'detail'->>'([^']+)'\\s+AS\\s+([a-z_]+)");
            assertEquals(serializedFields, readFields.keySet(), item.eventType() + " 读取字段");
            assertEquals(item.columns(), new LinkedHashSet<>(readFields.values()), item.eventType() + " 语义列");
            for (String migration : List.of(PART, TOTAL)) {
                String branch = eventBranch(read(migration), item.eventType());
                Map<String, String> savedFields = pairs(branch, "'([^']+)'\\s*,\\s*d\\.([a-z_]+)");
                assertEquals(serializedFields, savedFields.keySet(), migration + " " + item.eventType());
                assertEquals(readFields, savedFields, migration + " 存取列必须对应");
            }
        }
    }

    @Test
    void processEventPreservesNestedMomentObject() throws IOException {
        JsonNode detail = json(new SkillTriggerProcessEventDetail("cast",
            new SkillProcessMoment(SkillProcessMomentType.STEP_COMPLETE, "windup")));
        String reader = fragment(read(READ_MODEL), "triggerRuleProcessEvents");
        Set<String> readerLeaves = new LinkedHashSet<>();
        Matcher leaves = Pattern.compile("event_source->'detail'->'moment'->>'([^']+)'").matcher(reader);
        while (leaves.find()) readerLeaves.add(leaves.group(1));
        assertEquals(fields(detail.get("moment")), readerLeaves);
        for (String migration : List.of(PART, TOTAL)) {
            String branch = eventBranch(read(migration), SkillTriggerEventType.PROCESS_MOMENT);
            Set<String> topFields = pairs(branch, "'([^']+)'\\s*,\\s*(d\\.process_key|jsonb_build_object)").keySet();
            assertEquals(fields(detail), topFields, migration);
            Map<String, String> nested = pairs(branch, "'(momentType|stepKey)'\\s*,\\s*d\\.([a-z_]+)");
            assertEquals(fields(detail.get("moment")), nested.keySet());
            assertEquals(Map.of("momentType", "moment_type", "stepKey", "step_key"), nested);
        }
    }

    @Test
    void typeFiltersUseRealEnumSerialization() throws IOException {
        String reader = read(READ_MODEL);
        assertFilter(reader, "internalStateCooldownDetails", "r\\.state_type", SkillInternalStateType.INTERNAL_COOLDOWN);
        assertFilter(reader, "triggerRuleAttributeConditions", "c->>'conditionType'", SkillTriggerConditionType.ATTRIBUTE_COMPARE);
        assertFilter(reader, "triggerRuleEventValueConditions", "c->>'conditionType'", SkillTriggerConditionType.EVENT_VALUE_COMPARE);
        assertFilter(reader, "triggerRulePriorResultBindings", "b->>'sourceType'", SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT);
        for (String migration : List.of(PART, TOTAL)) {
            String sql = read(migration);
            for (Enum<?> type : List.of(SkillTriggerConditionType.ATTRIBUTE_COMPARE,
                SkillTriggerConditionType.EVENT_VALUE_COMPARE, SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT)) {
                assertTrue(sql.contains("WHEN '" + json(type).asText() + "' THEN"), migration + " " + type);
            }
        }
        assertTrue(read("db/game_manage/migrations/breaking/aggregate_parts/internal_states.sql")
            .contains("WHEN '" + json(SkillInternalStateType.INTERNAL_COOLDOWN).asText() + "' THEN"));
    }

    @Test
    void emptyDetailEventsDoNotCreateSubjectRows() throws IOException {
        assertTrue(fields(json(new SkillTriggerEmptyEventDetail())).isEmpty());
        String reader = fragment(read(READ_MODEL), "triggerRuleSubjectEvents");
        for (SkillTriggerEventType type : List.of(SkillTriggerEventType.CONTROL_RECEIVED, SkillTriggerEventType.KILL)) {
            assertFalse(reader.contains("'" + json(type).asText() + "'"), type.toString());
            for (String migration : List.of(PART, TOTAL)) {
                assertTrue(eventBranch(read(migration), type).contains("'{}'::jsonb"), migration + " " + type);
            }
        }
    }

    private static void assertFilter(String readModel, String id, String columnPattern, Enum<?> value) {
        Matcher filter = Pattern.compile("WHERE\\s+" + columnPattern + "\\s*=\\s*'([^']+)'")
            .matcher(fragment(readModel, id));
        assertTrue(filter.find(), id + " 缺少类型筛选");
        assertEquals(json(value).asText(), filter.group(1), id);
    }

    private static Map<String, String> pairs(String source, String regex) {
        Map<String, String> result = new LinkedHashMap<>();
        Matcher matcher = Pattern.compile(regex).matcher(source);
        while (matcher.find()) result.put(matcher.group(1), matcher.group(2));
        return result;
    }

    private static String eventBranch(String sql, SkillTriggerEventType type) {
        Matcher branch = Pattern.compile("WHEN\\s+r\\.event_type\\s+IN\\s*\\([^)]*'" +
            Pattern.quote(json(type).asText()) + "'[^)]*\\)\\s+THEN\\s+(.*?)(?=\\n\\s*WHEN\\s+r\\.event_type|\\n\\s*END)",
            Pattern.DOTALL).matcher(sql);
        assertTrue(branch.find(), "缺少事件迁移分支: " + type);
        return branch.group(1);
    }

    private static String fragment(String xml, String id) {
        Matcher fragment = Pattern.compile("<sql id=\"" + Pattern.quote(id) + "\">(.*?)</sql>", Pattern.DOTALL).matcher(xml);
        assertTrue(fragment.find(), "缺少读取片段: " + id);
        return fragment.group(1);
    }

    private static JsonNode json(Object value) {
        return AggregateJson.tree(AggregateJson.write(value));
    }

    private static Set<String> fields(JsonNode value) {
        Set<String> fields = new LinkedHashSet<>();
        value.fieldNames().forEachRemaining(fields::add);
        return fields;
    }

    private static String read(String relative) throws IOException {
        for (Path root = Path.of("").toAbsolutePath(); root != null; root = root.getParent()) {
            Path path = root.resolve(relative);
            if (Files.isRegularFile(path)) return Files.readString(path);
        }
        throw new IOException("缺少文件: " + relative);
    }

    private record EventCase(SkillTriggerEventType eventType, Object detail, String readerId, Set<String> columns) {}
}
