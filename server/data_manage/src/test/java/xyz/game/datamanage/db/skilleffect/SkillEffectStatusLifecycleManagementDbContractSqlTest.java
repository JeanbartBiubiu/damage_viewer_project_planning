package xyz.game.datamanage.db.skilleffect;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** 历史兼容迁移的安全边界；当前聚合业务行为由 SkillEffectServiceTest 覆盖。 */
class SkillEffectStatusLifecycleManagementDbContractSqlTest {

    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/effect_status_lifecycle_management_migration.sql";
    private static final String BASIC_MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/skill_effect_basic_result_management_migration.sql";
    private static final String PROCESS_MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/skill_process_internal_state_authoring_migration.sql";

    private static final List<String> TARGET_TABLES = List.of(
        "skill_effect_lifecycles",
        "skill_effect_result_lifecycle_behaviors",
        "skill_effect_lifecycle_operation_details"
    );

    private static final String REFRESH_CONSTRAINT =
        "ck_skill_effect_lifecycle_refresh_target_duration";

    private static String migrationSql;
    private static String migrationNormalized;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        migrationSql = readRelative(MIGRATION_RELATIVE);
        migrationNormalized = normalize(stripLineComments(migrationSql));
    }

    @Test
    void compatibilityMigrationPreflightsSevenTwoSevenThreeAndFourBranches() {
        String catalogChecks = normalize(stripLineComments(extractDoBlock(migrationSql)));

        assertTrue(catalogChecks.contains("information_schema.tables"));
        assertTrue(catalogChecks.contains("information_schema.columns"));
        assertTrue(catalogChecks.contains("pg_constraint"));
        assertTrue(catalogChecks.contains("pg_get_constraintdef"));
        assertTrue(catalogChecks.contains("pg_attribute"));
        assertTrue(catalogChecks.contains("conkey"));
        assertTrue(catalogChecks.contains("confkey"));
        assertTrue(catalogChecks.contains("unnest("));
        assertTrue(catalogChecks.contains("pg_indexes"));
        assertTrue(catalogChecks.contains("pg_index"));
        assertTrue(catalogChecks.contains("raise exception"));
        assertTrue(catalogChecks.contains("confdeltype <> 'c'") || catalogChecks.contains("confdeltype<>'c'"));
        assertTrue(catalogChecks.contains("confdeltype = 'c'") || catalogChecks.contains("confdeltype='c'"));

        assertTrue(catalogChecks.contains("prerequisite public.skills is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.skill_formulas is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.skill_effects is missing or incompatible"));
        assertTrue(catalogChecks.contains(
            "prerequisite public.skill_effect_status_operation_details is missing or incompatible"
        ));
        assertTrue(catalogChecks.contains(
            "prerequisite fk_skill_process_effect_bindings_effect is missing or incompatible"
        ));

        assertTrue(catalogChecks.contains("existing_count not in (0, 3)"));
        assertTrue(catalogChecks.contains("partial target structure exists"));
        assertTrue(catalogChecks.contains("is incompatible: unexpected column set"));
        assertTrue(catalogChecks.contains("is incompatible: missing or wrong pk/fk/check constraint"));

        int prereqPos = catalogChecks.indexOf("prerequisite public.skills");
        int sevenThreePos = catalogChecks.indexOf("fk_skill_process_effect_bindings_effect");
        int partialPos = catalogChecks.indexOf("existing_count not in (0, 3)");
        int createPos = catalogChecks.indexOf("create table public.skill_effect_lifecycles");
        assertTrue(prereqPos >= 0 && prereqPos < sevenThreePos);
        assertTrue(sevenThreePos >= 0 && sevenThreePos < partialPos);
        assertTrue(partialPos >= 0 && partialPos < createPos);

        assertFalse(catalogChecks.contains("create table if not exists"));
        assertFalse(catalogChecks.contains("create index if not exists"));
        for (String tableName : TARGET_TABLES) {
            assertTrue(catalogChecks.contains("create table public." + tableName));
        }
    }

    @Test
    void migrationReplacesOnlyResultShapeObjectsAndDoesNotTouchStage73Functions() {
        String catalogChecks = normalize(stripLineComments(extractDoBlock(migrationSql)));
        assertTrue(catalogChecks.contains("ck_skill_effect_results_type"));
        assertTrue(catalogChecks.contains("trg_skill_effect_result_complete_shape"));
        assertTrue(catalogChecks.contains("trg_skill_effect_results_complete_shape"));
        assertTrue(catalogChecks.contains("trg_skill_effect_result_values_complete_shape"));
        assertTrue(catalogChecks.contains("trg_skill_effect_status_operation_details_complete_shape"));
        assertFalse(catalogChecks.contains("trg_skill_internal_state_complete_shape"));
        assertFalse(catalogChecks.contains("trg_skill_process_complete_shape"));
        assertFalse(catalogChecks.contains("create table public.skill_internal_states"));
        assertFalse(catalogChecks.contains("create table public.skill_processes"));

        assertTrue(migrationNormalized.contains("drop constraint ck_skill_effect_results_type"));
        assertTrue(migrationNormalized.contains("'lifecycle_operation'"));
        assertTrue(migrationNormalized.contains(
            "create or replace function public.trg_skill_effect_result_complete_shape()"
        ));
        assertTrue(migrationNormalized.contains("skill_effect_lifecycle_operation_details"));
        assertTrue(migrationNormalized.contains(
            "create or replace function public.trg_skill_effect_lifecycle_aggregate_shape()"
        ));
        assertTrue(migrationNormalized.contains(REFRESH_CONSTRAINT.toLowerCase()));
        assertFalse(migrationNormalized.contains("trg_skill_internal_state_complete_shape"));
        assertFalse(migrationNormalized.contains("create table public.skill_processes"));
    }

    @Test
    void migrationDoesNotReadLegacyDataSeedDeleteOrDropCascade() {
        assertFalse(migrationNormalized.contains("create table if not exists public.skill_effect_lifecycles"));
        assertFalse(Pattern.compile("(?is)\\bdelete\\s+from\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+cascade\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)drop\\s+\\w+\\s+.*cascade").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\binsert\\s+into\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?i)\\bability\\b").matcher(migrationNormalized).find());
        assertFalse(migrationNormalized.contains("provider"));
        assertFalse(migrationNormalized.contains("combat-data"));
        assertFalse(migrationNormalized.contains("versions:publish"));
        assertFalse(migrationNormalized.contains("wasm"));
        assertFalse(migrationNormalized.contains("种子"));
        assertFalse(migrationNormalized.contains("发布"));
        assertFalse(migrationNormalized.contains("status_definitions"));
        assertFalse(migrationNormalized.contains("legacy_lifecycle"));
        for (String tableName : TARGET_TABLES) {
            String table = normalize(extractCreateTable(migrationSql, tableName));
            assertFalse(table.contains("jsonb"));
            assertFalse(table.contains("integer[]"));
        }
        for (String constraint : List.of(
            "fk_skill_effect_lifecycles_effect",
            "fk_skill_effect_result_lifecycle_behaviors_result",
            "fk_skill_effect_lifecycle_operation_details_result"
        )) {
            assertTrue(migrationNormalized.contains(constraint));
        }
        assertTrue(migrationNormalized.contains("fk_skill_effect_lifecycle_operations_target"));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_lifecycle_operations_target[^,]*on delete cascade"
        ).matcher(migrationNormalized).find());
    }

    @Test
    void previousStageMigrationsAreUnchangedByThisWorktreeFileSet() throws IOException {
        String basic = readRelative(BASIC_MIGRATION_RELATIVE);
        String process = readRelative(PROCESS_MIGRATION_RELATIVE);
        assertFalse(basic.contains("skill_effect_lifecycles"));
        assertFalse(basic.contains("LIFECYCLE_OPERATION"));
        assertFalse(process.contains("skill_effect_lifecycles"));
        assertFalse(process.contains("LIFECYCLE_OPERATION"));
    }

    private static String extractCreateTable(String sql, String tableName) {
        Matcher matcher = Pattern.compile(
            "(?is)CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\."
                + Pattern.quote(tableName)
                + "\\s*\\("
        ).matcher(sql);
        assertTrue(matcher.find(), "CREATE TABLE public." + tableName + " missing");
        int depth = 0;
        boolean inParens = false;
        for (int i = matcher.end() - 1; i < sql.length(); i++) {
            char ch = sql.charAt(i);
            if (ch == '(') {
                depth++;
                inParens = true;
            } else if (ch == ')') {
                depth--;
                if (inParens && depth == 0) {
                    int end = i + 1;
                    while (end < sql.length() && sql.charAt(end) != ';') {
                        end++;
                    }
                    return sql.substring(matcher.start(), Math.min(end + 1, sql.length()));
                }
            }
        }
        fail("unable to extract CREATE TABLE body for " + tableName);
        return "";
    }

    private static String extractDoBlock(String sql) {
        Matcher matcher = Pattern.compile("(?is)DO\\s+\\$.*?\\$.*?END\\s*\\$.*?\\$").matcher(sql);
        assertTrue(matcher.find(), "DO catalog check block missing");
        return matcher.group();
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    private static String normalize(String value) {
        return value.toLowerCase().replaceAll("\\s+", " ").trim();
    }

    private static String readRelative(String relative) throws IOException {
        return Files.readString(resolveRelative(relative), StandardCharsets.UTF_8);
    }

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        List<Path> candidates = List.of(
            cwd.resolve("../../" + relative).normalize(),
            cwd.resolve("../" + relative).normalize(),
            cwd.resolve(relative).normalize()
        );
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        fail("unable to resolve " + relative + " from cwd=" + cwd);
        return null;
    }
}
