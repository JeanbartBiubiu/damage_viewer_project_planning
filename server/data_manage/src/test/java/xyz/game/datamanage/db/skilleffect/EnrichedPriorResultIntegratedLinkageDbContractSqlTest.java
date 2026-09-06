package xyz.game.datamanage.db.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** 历史兼容迁移的安全边界；当前聚合业务行为由 SkillEffectServiceTest 覆盖。 */
class EnrichedPriorResultIntegratedLinkageDbContractSqlTest {

    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        migration = read(
            "db/game_manage/migrations/compatibility/enriched_prior_result_integrated_linkage_migration.sql"
        );
    }

    @Test
    void historicalMigrationIsAtomicFailClosedAndIdempotent() {
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
        assertTrue(normalized.contains("fk_skill_effect_damage_modifier_zone"));
        assertTrue(normalized.contains("fk_skill_effect_healing_modifier_zone"));
        assertTrue(normalized.contains("fk_skill_effect_attribute_change_details_zone"));
        assertTrue(normalized.contains("moment_evaluation lifecycle matrix is missing"));
        assertTrue(normalized.contains("stage 7.6.4 shape functions are missing"));
        assertTrue(normalized.contains("stage 7.6.4 result shape function drifted"));
        assertTrue(normalized.contains("stage 7.6.4 lifecycle aggregate function drifted"));
        assertTrue(normalized.contains("stage 7.6.4 trigger-rule shape function drifted"));
        assertFalse(normalized.contains("modifier-zone compatible result shape function drifted"));

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
