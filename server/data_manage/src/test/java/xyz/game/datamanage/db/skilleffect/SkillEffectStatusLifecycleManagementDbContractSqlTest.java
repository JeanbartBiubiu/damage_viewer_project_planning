package xyz.game.datamanage.db.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

/**
 * Static SQL contract for effect lifecycle tables, deferred aggregate/refresh
 * triggers and compatibility migration. Does not connect to a live database.
 */
class SkillEffectStatusLifecycleManagementDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String TRIGGERS_RELATIVE = "db/game_manage/triggers.sql";
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

    private static final List<String> EXACT_FK_NAMES = List.of(
        "fk_skill_effect_lifecycles_duration_formula",
        "fk_skill_effect_lifecycles_max_stacks_formula",
        "fk_skill_effect_lifecycles_application_stacks_formula",
        "fk_skill_effect_lifecycles_periodic_interval_formula",
        "fk_skill_effect_lifecycle_operations_target"
    );

    private static final String REFRESH_CONSTRAINT =
        "ck_skill_effect_lifecycle_refresh_target_duration";

    private static String schemaSql;
    private static String triggersSql;
    private static String migrationSql;
    private static String schemaNormalized;
    private static String triggersNormalized;
    private static String migrationNormalized;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        triggersSql = readRelative(TRIGGERS_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
        schemaNormalized = normalize(schemaSql);
        triggersNormalized = normalize(triggersSql);
        migrationNormalized = normalize(stripLineComments(migrationSql));
    }

    @Test
    void schemaDefinesThreeLifecycleTablesWithCompositeKeysForeignKeysChecksAndIndexes() {
        for (String tableName : TARGET_TABLES) {
            assertTrue(
                schemaNormalized.contains("create table public." + tableName),
                () -> "missing CREATE TABLE public." + tableName
            );
            assertFalse(
                schemaNormalized.contains("create table if not exists public." + tableName),
                () -> "fresh schema must not use IF NOT EXISTS for " + tableName
            );
        }

        String lifecycles = normalize(extractCreateTable(schemaSql, "skill_effect_lifecycles"));
        assertTrue(lifecycles.contains("constraint pk_skill_effect_lifecycles"));
        assertTrue(lifecycles.contains("primary key (game_id, skill_key, effect_key)"));
        assertTrue(lifecycles.contains("constraint fk_skill_effect_lifecycles_effect"));
        assertTrue(lifecycles.contains("on delete cascade"));
        assertTrue(lifecycles.contains("constraint fk_skill_effect_lifecycles_duration_formula"));
        assertTrue(lifecycles.contains("constraint fk_skill_effect_lifecycles_max_stacks_formula"));
        assertTrue(lifecycles.contains("constraint fk_skill_effect_lifecycles_application_stacks_formula"));
        assertTrue(lifecycles.contains("constraint fk_skill_effect_lifecycles_periodic_interval_formula"));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_lifecycles_duration_formula[^,]*on delete cascade"
        ).matcher(lifecycles).find());
        assertTrue(lifecycles.contains("varchar(24)"));
        assertTrue(lifecycles.contains("'skill', 'source', 'target', 'source_target'"));
        assertTrue(lifecycles.contains("'keep', 'increase', 'replace'"));
        assertTrue(lifecycles.contains("'refresh_all', 'keep_remaining', 'independent'"));
        assertTrue(lifecycles.contains("'all_at_once', 'one_by_one', 'independent', 'explicit_only'"));
        assertTrue(lifecycles.contains("'immediate', 'after_interval'"));
        assertTrue(lifecycles.contains("constraint ck_skill_effect_lifecycles_duration_expiry"));
        assertTrue(lifecycles.contains("constraint ck_skill_effect_lifecycles_independent_pair"));
        assertTrue(lifecycles.contains("constraint ck_skill_effect_lifecycles_one_by_one"));
        assertTrue(lifecycles.contains("constraint ck_skill_effect_lifecycles_periodic_pair"));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effect_lifecycles_duration_formula "
                + "on public.skill_effect_lifecycles"
        ));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effect_lifecycles_application_stacks_formula "
                + "on public.skill_effect_lifecycles"
        ));

        String behaviors = normalize(extractCreateTable(
            schemaSql, "skill_effect_result_lifecycle_behaviors"
        ));
        assertTrue(behaviors.contains("constraint pk_skill_effect_result_lifecycle_behaviors"));
        assertTrue(behaviors.contains("primary key (game_id, skill_key, effect_key, result_key)"));
        assertTrue(behaviors.contains("constraint fk_skill_effect_result_lifecycle_behaviors_result"));
        assertTrue(behaviors.contains("on delete cascade"));
        assertTrue(behaviors.contains("varchar(24)"));
        assertTrue(behaviors.contains("'application', 'persistent', 'full_stacks'"));
        assertTrue(behaviors.contains("'periodic', 'natural_end', 'early_remove'"));
        assertTrue(behaviors.contains("'application_snapshot', 'moment_evaluation'"));
        assertTrue(behaviors.contains("'shared', 'per_stack'"));
        assertTrue(behaviors.contains("'keep', 'replace', 'add'"));
        assertTrue(behaviors.contains("'once_per_instance', 'once_per_active_stack'"));

        String operations = normalize(extractCreateTable(
            schemaSql, "skill_effect_lifecycle_operation_details"
        ));
        assertTrue(operations.contains("constraint pk_skill_effect_lifecycle_operation_details"));
        assertTrue(operations.contains("constraint fk_skill_effect_lifecycle_operation_details_result"));
        assertTrue(operations.contains("on delete cascade"));
        assertTrue(operations.contains("constraint fk_skill_effect_lifecycle_operations_target"));
        assertTrue(operations.contains(
            "references public.skill_effect_lifecycles (game_id, skill_key, effect_key)"
        ));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_lifecycle_operations_target[^,]*on delete cascade"
        ).matcher(operations).find());
        assertTrue(operations.contains("constraint ck_skill_effect_lifecycle_operation_details_not_self"));
        assertTrue(operations.contains("target_effect_key <> effect_key"));
        assertTrue(operations.contains("'increase', 'decrease', 'set', 'refresh', 'consume', 'remove'"));
        assertTrue(operations.contains("varchar(24)"));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effect_lifecycle_operations_target "
                + "on public.skill_effect_lifecycle_operation_details "
                + "(game_id, skill_key, target_effect_key, effect_key, result_key)"
        ));
    }

    @Test
    void foreignKeyAndRefreshConstraintNamesAreExactAndUntruncated() {
        for (String name : EXACT_FK_NAMES) {
            assertTrue(name.length() <= 63, () -> name + " exceeds NAMEDATALEN");
            assertTrue(schemaSql.contains(name), () -> "schema missing exact name " + name);
            assertTrue(migrationSql.contains(name), () -> "migration missing exact name " + name);
        }
        assertTrue(REFRESH_CONSTRAINT.length() <= 63);
        assertTrue(triggersSql.contains(REFRESH_CONSTRAINT));
        assertTrue(migrationSql.contains(REFRESH_CONSTRAINT));
        assertTrue(schemaSql.contains("CONSTRAINT fk_skill_effect_lifecycles_application_stacks_formula"));
        assertTrue(schemaSql.contains("CONSTRAINT ck_skill_effect_lifecycle_refresh_target_duration")
            || triggersSql.contains("ck_skill_effect_lifecycle_refresh_target_duration"));
    }

    @Test
    void resultTypeCheckAppendsLifecycleOperationWithoutRewritingTheOriginalSeven() {
        String results = normalize(extractCreateTable(schemaSql, "skill_effect_results"));
        assertTrue(results.contains("constraint ck_skill_effect_results_type"));
        assertTrue(results.contains(
            "'damage', 'direct_heal', 'normal_shield', 'attribute_change'"
        ));
        assertTrue(results.contains(
            "'resource_change', 'cooldown_change', 'status_operation', 'lifecycle_operation'"
        ));
        int statusPos = results.indexOf("'status_operation'");
        int lifecyclePos = results.indexOf("'lifecycle_operation'");
        assertTrue(statusPos >= 0 && lifecyclePos > statusPos);

        for (String tableName : List.of(
            "skill_effects",
            "skill_effect_result_values",
            "skill_effect_damage_details",
            "skill_effect_attribute_change_details",
            "skill_effect_resource_change_details",
            "skill_effect_cooldown_change_details",
            "skill_effect_status_operation_details"
        )) {
            String table = normalize(extractCreateTable(schemaSql, tableName));
            assertFalse(table.contains("lifecycle"), () -> tableName + " must not gain lifecycle columns");
        }
    }

    @Test
    void deferredAggregateTriggersCoverEffectResultLifecycleAndBehavior() {
        assertTrue(triggersNormalized.contains(
            "create or replace function public.trg_skill_effect_lifecycle_aggregate_shape()"
        ));
        assertTrue(triggersNormalized.contains("if not exists ("));
        assertTrue(triggersNormalized.contains("from public.skill_effects e"));
        assertTrue(triggersNormalized.contains("return coalesce(new, old)"));
        assertTrue(triggersSql.contains("behaviors without lifecycle"));
        assertTrue(triggersSql.contains("must have exactly one behavior"));
        assertTrue(triggersSql.contains("cannot be PERSISTENT"));
        assertTrue(triggersSql.contains("value_read_mode required"));
        assertTrue(triggersSql.contains("APPLICATION/PERSISTENT must snapshot"));
        assertTrue(triggersSql.contains("periodic fields required"));
        assertTrue(triggersSql.contains("NATURAL_END requires duration"));

        assertTrue(triggersNormalized.contains(
            "constraint trigger trg_skill_effects_lifecycle_aggregate_shape "
                + "after insert or update on public.skill_effects "
                + "deferrable initially deferred"
        ));
        assertTrue(triggersNormalized.contains(
            "constraint trigger trg_skill_effect_results_lifecycle_aggregate_shape "
                + "after insert or update or delete on public.skill_effect_results "
                + "deferrable initially deferred"
        ));
        assertTrue(triggersNormalized.contains(
            "constraint trigger trg_skill_effect_lifecycles_aggregate_shape "
                + "after insert or update or delete on public.skill_effect_lifecycles "
                + "deferrable initially deferred"
        ));
        assertTrue(triggersNormalized.contains(
            "constraint trigger trg_skill_effect_result_lifecycle_behaviors_aggregate_shape "
                + "after insert or update or delete on public.skill_effect_result_lifecycle_behaviors "
                + "deferrable initially deferred"
        ));
    }

    @Test
    void resultShapeTriggerCountsLifecycleOperationsAndIncludesNewDetailTable() {
        assertTrue(triggersNormalized.contains("v_lifecycle_op_count"));
        assertTrue(triggersNormalized.contains("from public.skill_effect_lifecycle_operation_details d"));
        assertTrue(triggersNormalized.contains("or v_lifecycle_op_count <> 0 then"));
        assertTrue(triggersSql.contains("LIFECYCLE_OPERATION shape invalid at commit"));
        assertTrue(triggersSql.contains("LIFECYCLE_OPERATION % requires value rule at commit"));
        assertTrue(triggersSql.contains("LIFECYCLE_OPERATION % must not have value rule at commit"));
        assertTrue(Pattern.compile(
            "(?is)v_details text\\[\\] := array\\[.*"
                + "skill_effect_status_operation_details',\\s*"
                + "'skill_effect_lifecycle_operation_details'"
        ).matcher(triggersNormalized).find());
        assertTrue(triggersSql.contains("DAMAGE shape invalid at commit"));
        assertTrue(triggersSql.contains("STATUS_OPERATION shape invalid at commit"));
    }

    @Test
    void refreshDurationConstraintCoversOperatorWriteAndTargetClear() {
        assertTrue(triggersNormalized.contains(
            "create or replace function public.trg_skill_effect_lifecycle_refresh_target_duration()"
        ));
        assertTrue(triggersSql.contains(REFRESH_CONSTRAINT + ": REFRESH target"));
        assertTrue(triggersSql.contains(REFRESH_CONSTRAINT + ": lifecycle"));
        assertTrue(triggersNormalized.contains(
            "constraint trigger trg_skill_effect_lifecycle_refresh_target_duration_ops "
                + "after insert or update on public.skill_effect_lifecycle_operation_details "
                + "deferrable initially deferred"
        ));
        assertTrue(triggersNormalized.contains(
            "constraint trigger trg_skill_effect_lifecycle_refresh_target_duration_lc "
                + "after update or delete on public.skill_effect_lifecycles "
                + "deferrable initially deferred"
        ));
        assertTrue(triggersNormalized.contains("from public.skill_effects e"));
        assertTrue(triggersSql.contains("operation = 'REFRESH'"));
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
    void migrationExpectedColumnCountsMatchSchemaCreateTableColumns() {
        for (String tableName : TARGET_TABLES) {
            int schemaColumns = countCreateTableColumns(extractCreateTable(schemaSql, tableName));
            int migrationCreateColumns = countCreateTableColumns(
                extractCreateTable(migrationSql, tableName)
            );
            int expectedLiveCount = extractMigrationExpectedColumnCount(migrationSql, tableName);
            assertEquals(
                schemaColumns,
                expectedLiveCount,
                () -> tableName
                    + " migration expected column count drifted from schema: schema="
                    + schemaColumns
                    + " migration="
                    + expectedLiveCount
            );
            assertEquals(
                schemaColumns,
                migrationCreateColumns,
                () -> tableName
                    + " migration CREATE TABLE column count drifted from schema: schema="
                    + schemaColumns
                    + " migration="
                    + migrationCreateColumns
            );
        }
        assertEquals(
            9,
            countCreateTableColumns(
                extractCreateTable(schemaSql, "skill_effect_result_lifecycle_behaviors")
            ),
            "schema skill_effect_result_lifecycle_behaviors must stay at 9 columns"
        );
        assertEquals(
            9,
            extractMigrationExpectedColumnCount(
                migrationSql, "skill_effect_result_lifecycle_behaviors"
            ),
            "migration must expect 9 columns for skill_effect_result_lifecycle_behaviors"
        );
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
    void schemaAndMigrationShareFrozenCreateTableBodies() {
        for (String tableName : TARGET_TABLES) {
            String schemaTable = normalize(extractCreateTable(schemaSql, tableName));
            String migrationTable = normalize(extractCreateTable(migrationSql, tableName));
            assertTrue(schemaTable.contains("constraint pk_" + tableName)
                || schemaTable.contains("constraint pk_skill_effect_lifecycle"));
            assertFalse(migrationTable.contains("create table if not exists"));
            assertTrue(schemaTable.contains("varchar(24)") || tableName.equals("unused"));
            assertTrue(migrationTable.contains("varchar(24)"));
        }
        String schemaOps = normalize(extractCreateTable(
            schemaSql, "skill_effect_lifecycle_operation_details"
        ));
        String migrationOps = normalize(extractCreateTable(
            migrationSql, "skill_effect_lifecycle_operation_details"
        ));
        assertTrue(schemaOps.contains("fk_skill_effect_lifecycle_operations_target"));
        assertTrue(migrationOps.contains("fk_skill_effect_lifecycle_operations_target"));
        assertTrue(schemaOps.contains("ck_skill_effect_lifecycle_operation_details_not_self"));
        assertTrue(migrationOps.contains("ck_skill_effect_lifecycle_operation_details_not_self"));
    }

    @Test
    void newTablesOmitArraysJsonbAndRuntimeColumns() {
        for (String tableName : TARGET_TABLES) {
            String table = normalize(extractCreateTable(schemaSql, tableName));
            assertFalse(table.contains("jsonb"), () -> tableName + " must not use jsonb");
            assertFalse(table.contains("json "), () -> tableName + " must not use json");
            assertFalse(table.contains("integer[]"), () -> tableName + " must not use integer[]");
            assertFalse(table.contains("text[]"), () -> tableName + " must not use text[]");
            assertFalse(table.contains("varchar[]"), () -> tableName + " must not use varchar[]");
            assertFalse(table.contains("wasm"), () -> tableName + " must not add wasm columns");
            assertFalse(table.contains("publish"), () -> tableName + " must not add publish columns");
            assertFalse(table.contains("revision"), () -> tableName + " must not add revision columns");
        }
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

    private static int extractMigrationExpectedColumnCount(String sql, String tableName) {
        Matcher matcher = Pattern.compile(
            "(?is)table_name\\s*=\\s*'"
                + Pattern.quote(tableName)
                + "'\\s*;\\s*IF\\s+col_count\\s*<>\\s*(\\d+)"
        ).matcher(sql);
        assertTrue(
            matcher.find(),
            "migration expected column count missing for " + tableName
        );
        return Integer.parseInt(matcher.group(1));
    }

    private static int countCreateTableColumns(String createTableSql) {
        int open = createTableSql.indexOf('(');
        int close = createTableSql.lastIndexOf(')');
        assertTrue(open >= 0 && close > open, "CREATE TABLE body missing parentheses");
        String body = createTableSql.substring(open + 1, close);
        int count = 0;
        int depth = 0;
        StringBuilder current = new StringBuilder();
        for (int i = 0; i < body.length(); i++) {
            char ch = body.charAt(i);
            if (ch == '(') {
                depth++;
            } else if (ch == ')') {
                depth--;
            }
            if (ch == ',' && depth == 0) {
                if (isColumnDefinition(current.toString())) {
                    count++;
                }
                current.setLength(0);
            } else {
                current.append(ch);
            }
        }
        if (isColumnDefinition(current.toString())) {
            count++;
        }
        return count;
    }

    private static boolean isColumnDefinition(String fragment) {
        String trimmed = fragment.trim();
        if (trimmed.isEmpty()) {
            return false;
        }
        String lower = trimmed.toLowerCase();
        return !lower.startsWith("constraint")
            && !lower.startsWith("primary key")
            && !lower.startsWith("foreign key")
            && !lower.startsWith("unique")
            && !lower.startsWith("check");
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
