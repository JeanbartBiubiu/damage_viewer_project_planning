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

/** Static SQL contract for cooldown-change multi-select storage and migration. */
class SkillCooldownMultiSelectDbContractSqlTest {

    private static String schema;
    private static String triggers;
    private static String migration;
    private static String historicalMigration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schema = read("db/game_manage/schema.sql");
        triggers = read("db/game_manage/triggers.sql");
        migration = read("db/game_manage/migrations/compatibility/skill_cooldown_multi_select_migration.sql");
        historicalMigration = read(
            "db/game_manage/migrations/compatibility/skill_effect_basic_result_management_migration.sql"
        );
    }

    @Test
    void currentSchemaSeparatesOperationFromTargetSet() {
        String detail = normalize(extractCreateTable(schema, "skill_effect_cooldown_change_details"));
        String targets = normalize(extractCreateTable(schema, "skill_effect_cooldown_change_targets"));

        assertFalse(detail.contains("affected_skill_key"));
        assertTrue(detail.contains("constraint pk_skill_effect_cooldown_change_details"));
        assertTrue(detail.contains("operation in ('reduce', 'increase', 'reset')"));
        assertTrue(targets.contains(
            "primary key (game_id, skill_key, effect_key, result_key, affected_skill_key)"
        ));
        assertTrue(targets.contains("constraint fk_skill_effect_cooldown_change_targets_detail"));
        assertTrue(targets.contains("on delete cascade"));
        assertTrue(targets.contains("constraint fk_skill_effect_cooldown_change_targets_skill"));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_cooldown_change_targets_skill[^,]*on delete cascade"
        ).matcher(targets).find());
        assertTrue(normalize(schema).contains(
            "create index ix_skill_effect_cooldown_change_targets_skill "
                + "on public.skill_effect_cooldown_change_targets "
                + "(game_id, affected_skill_key, skill_key, effect_key, result_key)"
        ));
    }

    @Test
    void deferredShapeRequiresAtLeastOneTargetAndWatchesTargetRows() {
        String normalized = normalize(triggers);
        assertTrue(normalized.contains("v_cooldown_target_count int"));
        assertTrue(normalized.contains("from public.skill_effect_cooldown_change_targets t"));
        assertTrue(normalized.contains("or v_cooldown_target_count < 1"));
        assertTrue(triggers.contains("'skill_effect_cooldown_change_targets'"));
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
            "(?is)CREATE\\s+TABLE\\s+public\\." + Pattern.quote(tableName) + "\\s*\\((.*?)\\n\\);"
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
