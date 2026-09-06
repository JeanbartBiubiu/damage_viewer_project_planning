package xyz.game.datamanage.db.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** 历史兼容迁移的安全边界；当前聚合业务行为由 SkillEffectServiceTest 覆盖。 */
class ExecuteHitAttackLinkageDbContractSqlTest {

    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        migration = read(
            "db/game_manage/migrations/compatibility/execute_hit_attack_linkage_migration.sql"
        );
    }

    @Test
    void migrationIsAtomicFailClosedIdempotentAndReplacesShapeFunctions() {
        String normalized = normalize(migration);
        assertTrue(normalized.startsWith("-- 阶段 7.6.4"));
        assertTrue(normalized.contains("begin;"));
        assertTrue(normalized.endsWith("commit;"));
        assertEquals(1, count(normalized, "begin;"));
        assertEquals(1, count(normalized, "commit;"));
        assertTrue(normalized.contains("v_existing_count not in (0, 2)"));
        assertTrue(normalized.contains("structure is partial"));
        assertTrue(normalized.contains("column width drifted"));
        assertTrue(normalized.contains("constraint drifted"));
        assertTrue(normalized.contains("function drifted"));
        assertTrue(normalized.contains(
            "create table if not exists public.skill_effect_execute_details"
        ));
        assertTrue(normalized.contains(
            "create table if not exists public.skill_trigger_rule_link_events"
        ));
        assertTrue(normalized.contains("alter column result_type type varchar(32)"));
        assertTrue(normalized.contains("drop constraint if exists ck_skill_effect_results_type"));
        assertTrue(normalized.contains("drop constraint if exists ck_skill_trigger_rules_event_type"));
        assertTrue(normalized.contains(
            "create or replace function public.trg_skill_effect_result_complete_shape()"
        ));
        assertTrue(normalized.contains(
            "create or replace function public.trg_skill_trigger_rule_complete_shape()"
        ));
        assertTrue(migration.contains("'skill_effect_execute_details'"));
        assertTrue(migration.contains("'skill_trigger_rule_link_events'"));
        assertTrue(normalized.contains("v_result_type varchar(32)"));
        assertTrue(normalized.contains("v_execute_count int"));
        assertTrue(normalized.contains("v_link_event_count int"));
        assertTrue(normalized.contains("output_kind = 'configured_value'")
            || !normalized.contains("output_kind"));
        assertFalse(normalized.contains("insert into public."));
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+[^;]*\\bcascade\\b").matcher(migration).find());
        assertFalse(normalized.contains("link_index"));
        assertFalse(normalized.contains("link_count"));
        assertFalse(normalized.contains("killed"));

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
