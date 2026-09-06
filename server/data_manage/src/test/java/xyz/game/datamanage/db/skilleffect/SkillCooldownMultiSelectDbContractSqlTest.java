package xyz.game.datamanage.db.skilleffect;

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
class SkillCooldownMultiSelectDbContractSqlTest {

    private static String migration;
    private static String historicalMigration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        migration = read("db/game_manage/migrations/compatibility/skill_cooldown_multi_select_migration.sql");
        historicalMigration = read(
            "db/game_manage/migrations/compatibility/skill_effect_basic_result_management_migration.sql"
        );
    }

    @Test
    void historicalMigrationCreatesDedicatedTargetTableBeforePublicScope() {
        String targets = normalize(extractCreateTable(migration, "skill_effect_cooldown_change_targets"));
        assertTrue(targets.contains(
            "primary key (game_id, skill_key, effect_key, result_key, affected_skill_key)"
        ));
        assertTrue(targets.contains("constraint fk_skill_effect_cooldown_change_targets_detail"));
        assertTrue(targets.contains("on delete cascade"));
        assertTrue(targets.contains("constraint fk_skill_effect_cooldown_change_targets_skill"));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_cooldown_change_targets_skill[^,]*on delete cascade"
        ).matcher(targets).find());
        assertTrue(normalize(migration).contains(
            "create index if not exists ix_skill_effect_cooldown_change_targets_skill "
                + "on public.skill_effect_cooldown_change_targets "
                + "(game_id, affected_skill_key, skill_key, effect_key, result_key)"
        ));
        assertTrue(normalize(migration).contains("or v_cooldown_target_count < 1"));
        assertTrue(migration.contains("'skill_effect_cooldown_change_targets'"));
    }

    @Test
    void migrationBackfillsBeforeDroppingOldColumnAndIsFailClosedAndIdempotent() {
        String normalized = normalize(migration);
        int backfill = normalized.indexOf("insert into public.skill_effect_cooldown_change_targets");
        int dropColumn = normalized.indexOf("drop column affected_skill_key");

        assertTrue(normalized.contains("begin"));
        assertTrue(normalized.endsWith("commit;"));
        assertTrue(normalized.contains("v_has_old_column = v_has_target_table"));
        assertTrue(normalized.contains("structure is partial"));
        assertTrue(normalized.contains("create table if not exists public.skill_effect_cooldown_change_targets"));
        assertTrue(backfill >= 0 && dropColumn > backfill);
        assertTrue(normalized.contains("v_target_count <> v_old_count"));
        assertTrue(normalized.contains("having count(*) <> 1"));
        assertTrue(normalized.contains("drop constraint fk_skill_effect_cooldown_change_details_skill"));
        assertTrue(normalized.contains("drop index public.ix_skill_effect_cooldown_change_details_skill"));
        assertTrue(normalized.contains("migration postcheck failed"));
        assertFalse(Pattern.compile("(?is)\\bdelete\\s+from\\b").matcher(normalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(normalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+[^;]*\\bcascade\\b").matcher(normalized).find());
    }

    @Test
    void historicalMigrationRemainsSingleTargetAndCurrentMigrationUpgradesIt() {
        String historical = normalize(historicalMigration);
        String current = normalize(migration);
        assertTrue(historical.contains("create table public.skill_effect_cooldown_change_details"));
        assertTrue(historical.contains("affected_skill_key varchar(64) not null"));
        assertFalse(historical.contains("skill_effect_cooldown_change_targets"));
        assertTrue(current.contains("from public.skill_effect_cooldown_change_details"));
        assertTrue(current.contains("drop column affected_skill_key"));
    }

    private static String extractCreateTable(String sql, String tableName) {
        MatcherWithMessage match = new MatcherWithMessage(Pattern.compile(
            "(?is)CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\." + Pattern.quote(tableName) + "\\s*\\((.*?)\\n\\);"
        ).matcher(sql), tableName);
        return match.group();
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

    private record MatcherWithMessage(java.util.regex.Matcher matcher, String tableName) {
        String group() {
            if (!matcher.find()) {
                throw new AssertionError("missing CREATE TABLE public." + tableName);
            }
            return matcher.group();
        }
    }
}
