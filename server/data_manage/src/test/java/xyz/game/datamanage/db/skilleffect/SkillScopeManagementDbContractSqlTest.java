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
class SkillScopeManagementDbContractSqlTest {

    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        migration = read("db/game_manage/migrations/compatibility/skill_scope_management_migration.sql");
    }

    @Test
    void migrationCopiesCooldownTargetsInOneTransactionAndIsFailClosed() {
        String normalized = normalize(migration);
        assertTrue(normalized.startsWith("-- 阶段 7 验收补项"));
        assertTrue(normalized.contains("begin;"));
        assertTrue(normalized.endsWith("commit;"));
        assertEquals(1, count(normalized, "begin;"));
        assertEquals(1, count(normalized, "commit;"));
        assertTrue(normalized.contains("parent table count drifted"));
        assertTrue(normalized.contains("skill scope structure is partial"));
        assertTrue(normalized.contains("precondition requires skill_effect_cooldown_change_targets"));
        assertTrue(normalized.contains("target state still has skill_effect_cooldown_change_targets"));
        assertTrue(normalized.contains("lock table public.skill_effect_results"));
        assertTrue(normalized.contains("access exclusive"));
        assertTrue(normalized.contains("insert into public.skill_effect_result_skill_scopes"));
        assertTrue(normalized.contains("'skills'"));
        assertTrue(normalized.contains("insert into public.skill_effect_result_skill_targets"));
        assertTrue(normalized.contains("from public.skill_effect_cooldown_change_targets"));
        assertTrue(normalized.contains("cooldown target copy count mismatch"));
        assertTrue(normalized.contains("counted.old_count <> counted.new_count"));
        assertTrue(normalized.contains("v_new_scope_count <> v_cooldown_result_count"));
        assertTrue(normalized.contains("v_new_target_count <> v_old_target_count"));
        assertTrue(normalized.contains("drop table public.skill_effect_cooldown_change_targets"));
        int copy = normalized.indexOf("insert into public.skill_effect_result_skill_targets");
        int drop = normalized.indexOf("drop table public.skill_effect_cooldown_change_targets");
        assertTrue(copy >= 0 && drop > copy);
        assertTrue(normalized.contains("v_new_count not in (0, 4)"));
        assertTrue(normalized.contains("unknown structure")
            || normalized.contains("skill_effect_result_skill_scopes unknown structure"));
        assertTrue(normalized.contains("v_state") || normalized.contains("v_new_count = 0"));
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\s+[^;]*\\bcascade\\b").matcher(normalized).find());
        assertFalse(normalized.contains("insert into public.skill_effect_haste_modifier_details"));
    }

    @Test
    void migrationRefreshesShapeFunctionsThenDropsOldTable() {
        String normalized = normalize(migration);
        int functions = normalized.indexOf(
            "create or replace function public.trg_skill_effect_result_complete_shape()"
        );
        int lifecycle = normalized.indexOf(
            "create or replace function public.trg_skill_effect_lifecycle_aggregate_shape()"
        );
        int drop = normalized.indexOf("drop table public.skill_effect_cooldown_change_targets");
        int postcheck = normalized.indexOf("migration postcheck parent table count drifted");
        assertTrue(functions >= 0 && lifecycle > functions && drop > lifecycle && postcheck > drop);
        assertTrue(migration.contains("SKILL_HASTE_MODIFIER"));
        assertTrue(migration.contains("ALL skill scope must not have targets at commit"));
        assertFalse(Pattern.compile("(?is)v_cooldown_target_count\\s+int").matcher(
            extractFunction(migration, "trg_skill_effect_result_complete_shape")
        ).find());
    }

    private static String extractFunction(String sql, String name) {
        Matcher matcher = Pattern.compile(
            "(?is)CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\." + Pattern.quote(name)
                + "\\(\\)(.*?)COMMENT ON FUNCTION"
        ).matcher(sql);
        if (!matcher.find()) {
            throw new AssertionError("missing function " + name);
        }
        return matcher.group();
    }

    private static int count(String sql, String token) {
        int found = 0;
        int from = 0;
        while (true) {
            int at = sql.indexOf(token, from);
            if (at < 0) {
                return found;
            }
            found++;
            from = at + token.length();
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
