package xyz.game.datamanage.db.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputKind;

/** Static SQL contract for Stage 7.6.5 enriched prior-result and event-value checks. */
class EnrichedPriorResultIntegratedLinkageDbContractSqlTest {

    private static final List<String> OUTPUT_KINDS = List.of(
        "ACTUAL_HEALING", "ACTUAL_HP_LOSS", "BLOCKED", "CONFIGURED_VALUE",
        "IMMUNE", "KILLED", "POST_DEFENSE_DAMAGE", "RAW_DAMAGE",
        "SHIELD_ABSORBED", "STATUS_APPLIED"
    );
    private static final List<String> EVENT_VALUE_KEYS = List.of(
        "ACTUAL_HP_LOSS", "ATTRIBUTE_AFTER", "ATTRIBUTE_BEFORE", "BLOCKED",
        "CHARGE_DURATION_MS", "HEALTH_BEFORE", "HIT_INDEX", "IMMUNE", "KILLED",
        "LIFECYCLE_STACKS", "LINK_COUNT", "LINK_INDEX", "PERIOD_INDEX",
        "POST_DEFENSE_DAMAGE", "PROJECTED_HEALTH_AFTER", "RAW_DAMAGE", "RECAST_COUNT",
        "REMAINING_MS", "SHIELD_ABSORBED", "STATE_AFTER", "STATE_BEFORE",
        "STEP_EXECUTION_INDEX", "THRESHOLD_VALUE"
    );
    private static final List<String> STAGE_76_TABLES = List.of(
        "skill_effect_result_critical_policies",
        "skill_effect_result_vamp_rules",
        "skill_effect_result_normal_shield_interactions",
        "skill_trigger_rule_damage_events",
        "skill_effect_damage_modifier_details",
        "skill_effect_healing_modifier_details",
        "skill_effect_damage_immunity_details",
        "skill_effect_health_floor_details",
        "modifier_zones",
        "skill_effect_result_spell_shield_policies",
        "skill_trigger_rule_spell_shield_blocked_events",
        "skill_effect_execute_details",
        "skill_trigger_rule_link_events"
    );

    private static String schema;
    private static String triggers;
    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schema = read("db/game_manage/schema.sql");
        triggers = read("db/game_manage/triggers.sql");
        migration = read(
            "db/game_manage/migrations/compatibility/enriched_prior_result_integrated_linkage_migration.sql"
        );
    }

    @Test
    void schemaExtendsExistingChecksWithoutNewTablesColumnsOrKeys() {
        assertEquals(21, SkillTriggerEventType.values().length);
        assertEquals(10, SkillTriggerPriorResultOutputKind.values().length);
        assertEquals(23, SkillTriggerEventValueKey.values().length);
        assertEquals(13, STAGE_76_TABLES.size());
        for (String table : STAGE_76_TABLES) {
            assertTrue(schema.contains("CREATE TABLE public." + table), () -> "missing " + table);
        }

        String prior = extractCreateTable(schema, "skill_trigger_rule_prior_result_bindings");
        assertEquals(OUTPUT_KINDS, extractQuotedUppercase(extractConstraint(prior, "ck_skill_trigger_prior_result_bind_output")));
        assertFalse(prior.contains("json"));
        assertTrue(prior.contains("source_action_key"));
        assertTrue(prior.contains("source_effect_key"));
        assertTrue(prior.contains("source_result_key"));

        List<String> condKeys = extractQuotedUppercase(extractConstraint(
            extractCreateTable(schema, "skill_trigger_rule_event_value_conditions"),
            "ck_skill_trigger_event_value_cond_key"
        ));
        List<String> bindKeys = extractQuotedUppercase(extractConstraint(
            extractCreateTable(schema, "skill_trigger_rule_event_value_bindings"),
            "ck_skill_trigger_event_value_bind_key"
        ));
        assertEquals(EVENT_VALUE_KEYS, condKeys);
        assertEquals(condKeys, bindKeys);
        assertEquals(23, condKeys.size());

        String normalizedSchema = normalize(schema);
        assertTrue(normalizedSchema.contains("create table public.modifier_zones"));
        assertFalse(normalizedSchema.contains("create table public.skill_effect_cooldown_change_targets"));
        assertTrue(normalize(migration).contains("skill_effect_cooldown_change_targets"));
        assertTrue(normalizedSchema.contains("'application_snapshot', 'moment_evaluation'"));
        assertFalse(normalizedSchema.contains("create table public.skill_trigger_rule_prior_result_outputs"));
        assertFalse(schema.contains("JSONB"));
    }

    @Test
    void deferredFunctionGatesConfiguredValueOnlyAndKeepsSixteenAndTwentyOneShapes() {
        String normalized = normalize(triggers);
        assertTrue(triggers.contains("IF v_prior.output_kind = 'CONFIGURED_VALUE' THEN"));
        assertTrue(triggers.contains("prior action result is not immediately available at commit"));
        assertTrue(normalized.contains("v_result_type varchar(32)"));
        assertTrue(normalized.contains("v_event_type varchar(32)"));
        assertTrue(normalized.contains("v_result_type = 'execute'"));
        assertTrue(normalized.contains("v_event_type in ('hit_link_applied', 'attack_link_applied')"));
        assertTrue(normalized.contains("moment_evaluation"));
        assertTrue(triggers.contains("MOMENT_EVALUATION forbids reapplication_value_mode"));
        assertTrue(triggers.contains("modifier zone domain invalid at commit"));
        assertTrue(triggers.contains("'skill_effect_execute_details'"));
        assertTrue(triggers.contains("'skill_trigger_rule_link_events'"));
        assertEquals(21, SkillTriggerEventType.values().length);
    }

    @Test
    void migrationIsAtomicFailClosedIdempotentAndEquivalentToSchemaChecks() {
        String normalized = normalize(migration);
        assertTrue(normalized.startsWith("-- 阶段 7.6.5"));
        assertTrue(normalized.contains("begin;"));
        assertTrue(normalized.endsWith("commit;"));
        assertEquals(1, count(normalized, "begin;"));
        assertEquals(1, count(normalized, "commit;"));
        assertTrue(normalized.contains("parent table count drifted"));
        assertTrue(normalized.contains("stage 7.6 table set drifted"));
        assertTrue(normalized.contains("stage 7.6.5 checks are partial"));
        assertTrue(normalized.contains("skill trigger event value constraints are inconsistent"));
        assertTrue(normalized.contains("skill trigger event value constraint drifted"));
        assertTrue(normalized.contains("prior result output constraint drifted"));
        assertTrue(normalized.contains("existing event value rows are outside the predecessor set"));
        assertTrue(normalized.contains("existing prior result rows are outside the predecessor set"));
        assertTrue(normalized.contains("v_previous_event_value_keys constant text[]"));
        assertTrue(normalized.contains("v_target_event_value_keys constant text[]"));
        assertTrue(normalized.contains("v_previous_output_kinds constant text[] := array['configured_value']"));
        assertTrue(normalized.contains("damage.viewer.stage765.state"));
        assertTrue(normalized.contains("v_state = 'target'"));
        assertTrue(normalized.contains("v_event_value_state := 'target'"));
        assertTrue(normalized.contains("drop constraint ck_skill_trigger_event_value_cond_key"));
        assertTrue(normalized.contains("drop constraint ck_skill_trigger_event_value_bind_key"));
        assertTrue(normalized.contains("drop constraint ck_skill_trigger_prior_result_bind_output"));
        assertFalse(normalized.contains("drop constraint if exists ck_skill_trigger_event_value_cond_key"));
        assertTrue(normalized.contains(
            "create or replace function public.trg_skill_trigger_rule_complete_shape()"
        ));
        assertTrue(migration.contains("IF v_prior.output_kind = 'CONFIGURED_VALUE' THEN"));
        assertFalse(Pattern.compile("(?is)create\\s+table\\b").matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\binsert\\s+into\\s+public\\.").matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\bupdate\\s+public\\.").matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+[^;]*\\bcascade\\b").matcher(migration).find());
        assertFalse(normalized.contains("jsonb"));
        assertTrue(normalized.contains("fk_skill_effect_damage_modifier_zone"));
        assertTrue(normalized.contains("fk_skill_effect_healing_modifier_zone"));
        assertTrue(normalized.contains("fk_skill_effect_attribute_change_details_zone"));
        assertTrue(normalized.contains("moment_evaluation lifecycle matrix is missing"));
        assertTrue(normalized.contains("stage 7.6.4 shape functions are missing"));
        assertTrue(normalized.contains("stage 7.6.4 result shape function drifted"));
        assertTrue(normalized.contains("stage 7.6.4 lifecycle aggregate function drifted"));
        assertTrue(normalized.contains("stage 7.6.4 trigger-rule shape function drifted"));
        assertFalse(normalized.contains("modifier-zone compatible result shape function drifted"));

        assertEquals(
            extractQuotedUppercase(extractConstraint(
                extractCreateTable(schema, "skill_trigger_rule_prior_result_bindings"),
                "ck_skill_trigger_prior_result_bind_output"
            )),
            extractQuotedUppercase(extractNamedConstraint(migration, "ck_skill_trigger_prior_result_bind_output"))
        );
        assertEquals(
            extractQuotedUppercase(extractConstraint(
                extractCreateTable(schema, "skill_trigger_rule_event_value_conditions"),
                "ck_skill_trigger_event_value_cond_key"
            )),
            extractQuotedUppercase(extractNamedConstraint(migration, "ck_skill_trigger_event_value_cond_key"))
        );
        assertEquals(
            extractQuotedUppercase(extractConstraint(
                extractCreateTable(schema, "skill_trigger_rule_event_value_bindings"),
                "ck_skill_trigger_event_value_bind_key"
            )),
            extractQuotedUppercase(extractNamedConstraint(migration, "ck_skill_trigger_event_value_bind_key"))
        );
    }

    @Test
    void migrationReadsLifecycleAggregateForMomentEvaluationNotResultShape() {
        String preflight = extractDoBlock(migration, "migration_preflight");
        assertTrue(preflight.contains("to_regprocedure('public.trg_skill_effect_result_complete_shape()')"));
        assertTrue(preflight.contains("to_regprocedure('public.trg_skill_effect_lifecycle_aggregate_shape()')"));
        assertTrue(preflight.contains("to_regprocedure('public.trg_skill_trigger_rule_complete_shape()')"));
        assertTrue(preflight.contains("ILIKE '%MOMENT_EVALUATION%'"));

        String resultShapeCheck = extractFunctionDefCheck(
            preflight,
            "trg_skill_effect_result_complete_shape"
        );
        assertTrue(resultShapeCheck.contains("modifier zone domain invalid at commit"));
        assertFalse(resultShapeCheck.contains("MOMENT_EVALUATION"));
        assertTrue(resultShapeCheck.contains("stage 7.6.4 result shape function drifted"));

        String lifecycleCheck = extractFunctionDefCheck(
            preflight,
            "trg_skill_effect_lifecycle_aggregate_shape"
        );
        assertTrue(lifecycleCheck.contains("MOMENT_EVALUATION"));
        assertTrue(lifecycleCheck.contains("stage 7.6.4 lifecycle aggregate function drifted"));

        String triggerRuleCheck = extractFunctionDefCheck(
            preflight,
            "trg_skill_trigger_rule_complete_shape"
        );
        assertTrue(triggerRuleCheck.contains("v_link_event_count"));
        assertTrue(triggerRuleCheck.contains("HIT_LINK_APPLIED"));
        assertTrue(triggerRuleCheck.contains("stage 7.6.4 trigger-rule shape function drifted"));
    }

    @Test
    void mapperShapeQueryExposesVampCountAndCooldownOperationWithoutNewTables() throws IOException {
        String mapperXml = read(
            "server/data_manage/src/main/resources/mapper/skilltrigger/SkillTriggerRuleMapper.xml"
        );
        assertTrue(mapperXml.contains("AS vamp_count"));
        assertTrue(mapperXml.contains("cd.operation AS cooldown_operation"));
        assertTrue(mapperXml.contains("skill_effect_result_vamp_rules"));
        assertTrue(mapperXml.contains("skill_effect_cooldown_change_details"));
        assertTrue(mapperXml.contains("source_result_key"));
        assertFalse(mapperXml.contains("affected_skill_key AS source_result_key"));
    }

    private static String extractDoBlock(String sql, String label) {
        Matcher matcher = Pattern.compile(
            "(?is)DO\\s+\\$" + Pattern.quote(label) + "\\$(.*?)\\$" + Pattern.quote(label) + "\\$;"
        ).matcher(sql);
        if (!matcher.find()) {
            throw new AssertionError("missing DO block " + label);
        }
        return matcher.group(1);
    }

    private static String extractFunctionDefCheck(String sql, String functionName) {
        Matcher matcher = Pattern.compile(
            "(?is)SELECT\\s+pg_get_functiondef\\('public\\." + Pattern.quote(functionName)
                + "\\(\\)'::regprocedure\\)\\s+INTO\\s+v_function_src;\\s*"
                + "IF\\s+v_function_src\\s+NOT\\s+ILIKE\\s+.*?END IF;"
        ).matcher(sql);
        if (!matcher.find()) {
            throw new AssertionError("missing functiondef check for " + functionName);
        }
        return matcher.group();
    }

    private static List<String> extractCreateTableNames(String sql) {
        Matcher matcher = Pattern.compile("(?m)^CREATE TABLE public\\.([a-z0-9_]+)").matcher(sql);
        List<String> names = new ArrayList<>();
        while (matcher.find()) {
            names.add(matcher.group(1));
        }
        return names;
    }

    private static String extractCreateTable(String sql, String tableName) {
        var matcher = Pattern.compile(
            "(?is)CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\." + Pattern.quote(tableName)
                + "\\s*\\((.*?)\\n\\);"
        ).matcher(sql);
        if (!matcher.find()) {
            throw new AssertionError("missing CREATE TABLE public." + tableName);
        }
        return matcher.group();
    }

    private static String extractConstraint(String tableSql, String constraintName) {
        Matcher matcher = Pattern.compile(
            "(?is)CONSTRAINT\\s+" + Pattern.quote(constraintName) + "\\s+CHECK\\s*\\((.*?)\\)\\s*(?:,|\\n\\))"
        ).matcher(tableSql);
        if (!matcher.find()) {
            throw new AssertionError("missing constraint " + constraintName);
        }
        return matcher.group(1);
    }

    private static String extractNamedConstraint(String sql, String constraintName) {
        Matcher matcher = Pattern.compile(
            "(?is)ADD CONSTRAINT\\s+" + Pattern.quote(constraintName) + "\\s+CHECK\\s*\\((.*?)\\)\\s*;"
        ).matcher(sql);
        if (!matcher.find()) {
            throw new AssertionError("missing ADD CONSTRAINT " + constraintName);
        }
        return matcher.group(1);
    }

    private static List<String> extractQuotedUppercase(String fragment) {
        Matcher matcher = Pattern.compile("'([A-Z_]+)'").matcher(fragment);
        List<String> values = new ArrayList<>();
        while (matcher.find()) {
            values.add(matcher.group(1));
        }
        values.sort(String::compareTo);
        return values;
    }

    private static int count(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int at = haystack.indexOf(needle, from);
            if (at < 0) {
                return count;
            }
            count++;
            from = at + needle.length();
        }
    }

    private static String normalize(String sql) {
        return sql.toLowerCase().replaceAll("\\s+", " ").trim();
    }

    private static String read(String relative) throws IOException {
        Path root = findRepoRoot();
        return Files.readString(root.resolve(relative), StandardCharsets.UTF_8);
    }

    private static Path findRepoRoot() {
        Path current = Paths.get("").toAbsolutePath();
        while (current != null) {
            if (Files.isRegularFile(current.resolve("db/game_manage/schema.sql"))) {
                return current;
            }
            current = current.getParent();
        }
        throw new IllegalStateException("repository root not found");
    }
}
