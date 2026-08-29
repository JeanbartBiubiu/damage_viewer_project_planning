package xyz.game.datamanage.db.skillprocess;

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
 * Static SQL contract for skill process / internal-state tables, deferred shape triggers
 * and compatibility migration. Does not connect to a live database.
 */
class SkillProcessInternalStateAuthoringDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String TRIGGERS_RELATIVE = "db/game_manage/triggers.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/skill_process_internal_state_authoring_migration.sql";
    private static final String FORMULA_SERVICE_RELATIVE =
        "server/data_manage/src/main/java/xyz/game/datamanage/service/skillformula/SkillFormulaService.java";

    private static final List<String> TARGET_TABLES = List.of(
        "skill_internal_states",
        "skill_internal_state_counter_details",
        "skill_internal_state_ammo_details",
        "skill_internal_state_flag_details",
        "skill_internal_state_cooldown_details",
        "skill_internal_state_mode_options",
        "skill_processes",
        "skill_process_steps",
        "skill_process_delay_step_details",
        "skill_process_multi_hit_step_details",
        "skill_process_periodic_step_details",
        "skill_process_channel_step_details",
        "skill_process_charge_step_details",
        "skill_process_recast_step_details",
        "skill_process_empowered_attack_step_details",
        "skill_process_cooldowns",
        "skill_process_effect_bindings",
        "skill_process_state_operations"
    );

    private static final List<String> INTERNAL_CASCADE_FKS = List.of(
        "fk_skill_internal_state_counter_details_state",
        "fk_skill_internal_state_ammo_details_state",
        "fk_skill_internal_state_flag_details_state",
        "fk_skill_internal_state_cooldown_details_state",
        "fk_skill_internal_state_mode_options_state",
        "fk_skill_process_steps_process",
        "fk_skill_process_delay_step_details_step",
        "fk_skill_process_multi_hit_step_details_step",
        "fk_skill_process_periodic_step_details_step",
        "fk_skill_process_channel_step_details_step",
        "fk_skill_process_charge_step_details_step",
        "fk_skill_process_recast_step_details_step",
        "fk_skill_process_empowered_attack_step_details_step",
        "fk_skill_process_cooldowns_process",
        "fk_skill_process_effect_bindings_process",
        "fk_skill_process_state_operations_process"
    );

    private static final List<String> MATCH_SIMPLE_FKS = List.of(
        "fk_skill_process_multi_interval_formula",
        "fk_skill_process_cooldowns_step",
        "fk_skill_process_effect_bindings_step",
        "fk_skill_process_state_operation_value_formula",
        "fk_skill_process_state_operations_option",
        "fk_skill_process_state_operations_step"
    );

    private static final List<String> FORMULA_IN_USE_CONSTRAINTS = List.of(
        "fk_skill_effect_result_values_formula",
        "fk_skill_internal_counter_initial_formula",
        "fk_skill_internal_counter_max_formula",
        "fk_skill_internal_ammo_initial_formula",
        "fk_skill_internal_ammo_max_formula",
        "fk_skill_internal_ammo_recovery_formula",
        "fk_skill_internal_cooldown_duration_formula",
        "fk_skill_process_delay_formula",
        "fk_skill_process_multi_count_formula",
        "fk_skill_process_multi_interval_formula",
        "fk_skill_process_periodic_count_formula",
        "fk_skill_process_periodic_interval_formula",
        "fk_skill_process_channel_duration_formula",
        "fk_skill_process_channel_count_formula",
        "fk_skill_process_charge_min_formula",
        "fk_skill_process_charge_max_formula",
        "fk_skill_process_recast_window_formula",
        "fk_skill_process_recast_count_formula",
        "fk_skill_process_empowered_window_formula",
        "fk_skill_process_cooldown_duration_formula",
        "fk_skill_process_state_operation_value_formula"
    );

    private static final List<String> RESTRICT_FKS = List.of(
        "fk_skill_internal_states_skill",
        "fk_skill_processes_skill",
        "fk_skill_internal_counter_initial_formula",
        "fk_skill_internal_counter_max_formula",
        "fk_skill_internal_ammo_initial_formula",
        "fk_skill_internal_ammo_max_formula",
        "fk_skill_internal_ammo_recovery_formula",
        "fk_skill_internal_cooldown_duration_formula",
        "fk_skill_process_delay_formula",
        "fk_skill_process_multi_count_formula",
        "fk_skill_process_multi_interval_formula",
        "fk_skill_process_periodic_count_formula",
        "fk_skill_process_periodic_interval_formula",
        "fk_skill_process_channel_duration_formula",
        "fk_skill_process_channel_count_formula",
        "fk_skill_process_charge_min_formula",
        "fk_skill_process_charge_max_formula",
        "fk_skill_process_recast_window_formula",
        "fk_skill_process_recast_count_formula",
        "fk_skill_process_empowered_window_formula",
        "fk_skill_process_cooldown_duration_formula",
        "fk_skill_process_cooldowns_step",
        "fk_skill_process_effect_bindings_effect",
        "fk_skill_process_effect_bindings_step",
        "fk_skill_process_state_operations_state",
        "fk_skill_process_state_operation_value_formula",
        "fk_skill_process_state_operations_option",
        "fk_skill_process_state_operations_step"
    );

    private static String schemaSql;
    private static String triggersSql;
    private static String migrationSql;
    private static String formulaServiceJava;
    private static String schemaNormalized;
    private static String triggersNormalized;
    private static String migrationNormalized;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        triggersSql = readRelative(TRIGGERS_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
        formulaServiceJava = readRelative(FORMULA_SERVICE_RELATIVE);
        schemaNormalized = normalize(schemaSql);
        triggersNormalized = normalize(triggersSql);
        migrationNormalized = normalize(stripLineComments(migrationSql));
    }

    @Test
    void schemaDefinesEighteenTablesWithCompositeKeysForeignKeysChecksAndIndexes() {
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

        String states = normalize(extractCreateTable(schemaSql, "skill_internal_states"));
        assertTrue(states.contains("constraint pk_skill_internal_states"));
        assertTrue(states.contains("primary key (game_id, skill_key, state_key)"));
        assertTrue(states.contains("constraint fk_skill_internal_states_skill"));
        assertTrue(states.contains(
            "foreign key (game_id, skill_key) references public.skills (game_id, skill_key)"
        ));
        assertFalse(states.contains("on delete cascade"));
        assertTrue(states.contains("'counter', 'ammo', 'mode', 'flag', 'internal_cooldown'"));
        assertTrue(states.contains("scope in ('skill', 'target')"));
        assertTrue(states.contains("state_type = 'counter' or scope = 'skill'"));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_internal_states_list on public.skill_internal_states "
                + "(game_id, skill_key, sort_order, state_key)"
        ));

        String processes = normalize(extractCreateTable(schemaSql, "skill_processes"));
        assertTrue(processes.contains("constraint pk_skill_processes"));
        assertTrue(processes.contains("primary key (game_id, skill_key, process_key)"));
        assertTrue(processes.contains("constraint fk_skill_processes_skill"));
        assertFalse(processes.contains("on delete cascade"));
        assertTrue(processes.contains("activation_type in ('active', 'passive', 'consumable')"));

        String steps = normalize(extractCreateTable(schemaSql, "skill_process_steps"));
        assertTrue(steps.contains("constraint pk_skill_process_steps"));
        assertTrue(steps.contains("primary key (game_id, skill_key, process_key, step_key)"));
        assertTrue(steps.contains("constraint fk_skill_process_steps_process"));
        assertTrue(steps.contains("on delete cascade"));
        assertTrue(steps.contains("'immediate', 'delay', 'multi_hit', 'periodic'"));
        assertTrue(steps.contains("'channel', 'charge', 'recast', 'empowered_basic_attack'"));

        String cooldowns = normalize(extractCreateTable(schemaSql, "skill_process_cooldowns"));
        assertTrue(cooldowns.contains("constraint pk_skill_process_cooldowns"));
        assertTrue(cooldowns.contains("primary key (game_id, skill_key, process_key)"));
        assertTrue(cooldowns.contains("constraint fk_skill_process_cooldowns_process"));
        assertTrue(cooldowns.contains("constraint fk_skill_process_cooldowns_step"));
        assertTrue(cooldowns.contains("match simple"));

        String bindings = normalize(extractCreateTable(schemaSql, "skill_process_effect_bindings"));
        assertTrue(bindings.contains("constraint fk_skill_process_effect_bindings_effect"));
        assertTrue(bindings.contains(
            "foreign key (game_id, skill_key, effect_key) "
                + "references public.skill_effects (game_id, skill_key, effect_key)"
        ));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_process_effect_bindings_effect[^,]*on delete cascade"
        ).matcher(bindings).find());
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_process_effect_bindings_effect on public.skill_process_effect_bindings "
                + "(game_id, skill_key, effect_key, process_key, binding_key)"
        ));

        String operations = normalize(extractCreateTable(schemaSql, "skill_process_state_operations"));
        assertTrue(operations.contains("constraint fk_skill_process_state_operations_state"));
        assertTrue(operations.contains("constraint fk_skill_process_state_operations_option"));
        assertTrue(operations.contains("'increase', 'decrease', 'consume', 'set', 'reset'"));
        assertTrue(operations.contains("'select', 'enable', 'disable', 'toggle', 'start'"));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_process_state_operations_state on public.skill_process_state_operations "
                + "(game_id, skill_key, state_key, process_key, operation_key)"
        ));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_internal_counter_initial_formula on public.skill_internal_state_counter_details "
                + "(game_id, skill_key, initial_value_formula_key, state_key)"
        ));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_process_state_operations_option on public.skill_process_state_operations "
                + "(game_id, skill_key, state_key, option_key, process_key, operation_key)"
        ));
    }

    @Test
    void nullableCompositeForeignKeysUseExplicitMatchSimple() {
        for (String constraint : MATCH_SIMPLE_FKS) {
            assertTrue(
                Pattern.compile(
                    "constraint " + Pattern.quote(constraint)
                        + "[\\s\\S]*?match simple"
                ).matcher(schemaNormalized).find(),
                () -> "schema missing MATCH SIMPLE on " + constraint
            );
            assertTrue(
                Pattern.compile(
                    "constraint " + Pattern.quote(constraint)
                        + "[\\s\\S]*?match simple"
                ).matcher(migrationNormalized).find(),
                () -> "migration missing MATCH SIMPLE on " + constraint
            );
        }
        assertTrue(migrationNormalized.contains("confmatchtype = 's'")
            || migrationNormalized.contains("confmatchtype='s'"));
    }

    @Test
    void formulaConstraintNamesAreIdenticalAcrossSchemaMigrationAndService() {
        String serviceNormalized = normalize(formulaServiceJava);
        List<String> stage73Constraints = FORMULA_IN_USE_CONSTRAINTS.stream()
            .filter(name -> !name.equals("fk_skill_effect_result_values_formula"))
            .toList();
        for (String constraint : FORMULA_IN_USE_CONSTRAINTS) {
            assertTrue(schemaNormalized.contains(constraint), () -> "schema missing " + constraint);
            assertTrue(serviceNormalized.contains(constraint), () -> "SkillFormulaService missing " + constraint);
        }
        for (String constraint : stage73Constraints) {
            assertTrue(migrationNormalized.contains(constraint), () -> "migration missing " + constraint);
        }
        assertEquals(21, FORMULA_IN_USE_CONSTRAINTS.size());
        assertFalse(serviceNormalized.contains("sqlstate"));
        assertFalse(serviceNormalized.contains("23503"));
    }

    @Test
    void deferredTriggersCoverInternalStateStepAndProcessShapesAndParentDeleteShortCircuit() {
        assertTrue(triggersNormalized.contains(
            "create or replace function public.trg_skill_internal_state_complete_shape()"
        ));
        assertTrue(triggersNormalized.contains(
            "create or replace function public.trg_skill_process_step_complete_shape()"
        ));
        assertTrue(triggersNormalized.contains(
            "create or replace function public.trg_skill_process_complete_shape()"
        ));
        assertTrue(triggersNormalized.contains("constraint trigger trg_skill_internal_states_complete_shape"));
        assertTrue(triggersNormalized.contains("constraint trigger trg_skill_process_steps_complete_shape"));
        assertTrue(triggersNormalized.contains("constraint trigger trg_skill_processes_complete_shape"));
        assertTrue(triggersNormalized.contains("deferrable initially deferred"));
        assertTrue(triggersNormalized.contains("if not found then"));
        assertTrue(triggersNormalized.contains("return coalesce(new, old)"));

        assertTrue(triggersSql.contains("COUNTER shape invalid at commit"));
        assertTrue(triggersSql.contains("AMMO shape invalid at commit"));
        assertTrue(triggersSql.contains("MODE shape invalid at commit"));
        assertTrue(triggersSql.contains("FLAG shape invalid at commit"));
        assertTrue(triggersSql.contains("INTERNAL_COOLDOWN shape invalid at commit"));
        assertTrue(triggersSql.contains("v_option_count < 2"));
        assertTrue(triggersSql.contains("v_initial_count <> 1"));
        assertTrue(triggersSql.contains("requires at least one step at commit"));
        assertTrue(triggersSql.contains(
            "requires at least one effect binding or state operation at commit"
        ));
        assertTrue(triggersSql.contains(
            "STEP_TIMEOUT must reference CHARGE, RECAST or EMPOWERED_BASIC_ATTACK at commit"
        ));
    }

    @Test
    void newTablesOmitArraysJsonbAndLaterMechanismColumns() {
        for (String tableName : TARGET_TABLES) {
            String table = normalize(extractCreateTable(schemaSql, tableName));
            assertFalse(table.contains("jsonb"), () -> tableName + " must not use jsonb");
            assertFalse(table.contains("json "), () -> tableName + " must not use json");
            assertFalse(table.contains("integer[]"), () -> tableName + " must not use integer[]");
            assertFalse(table.contains("text[]"), () -> tableName + " must not use text[]");
            assertFalse(table.contains("varchar[]"), () -> tableName + " must not use varchar[]");
            assertFalse(table.contains("lifecycle"), () -> tableName + " must not add lifecycle columns");
            assertFalse(table.contains("condition"), () -> tableName + " must not add condition columns");
            assertFalse(table.contains("event_"), () -> tableName + " must not add event columns");
            assertFalse(table.contains("crit"), () -> tableName + " must not add crit columns");
            assertFalse(table.contains("lifesteal"), () -> tableName + " must not add lifesteal columns");
            assertFalse(table.contains("previous_result"), () -> tableName + " must not add previous-result columns");
            assertFalse(table.contains("wasm"), () -> tableName + " must not add wasm columns");
            assertFalse(table.contains("publish"), () -> tableName + " must not add publish columns");
            assertFalse(table.contains("revision"), () -> tableName + " must not add revision columns");
        }
    }

    @Test
    void internalCascadeIsLimitedToOwnershipForeignKeys() {
        String region = schemaNormalized.substring(
            schemaNormalized.indexOf("create table public.skill_internal_states"),
            schemaNormalized.indexOf("create table public.images")
        );
        int seen = 0;
        for (String constraint : INTERNAL_CASCADE_FKS) {
            assertTrue(
                Pattern.compile(
                    "constraint " + Pattern.quote(constraint)
                        + " foreign key \\([^)]+\\) references [\\w.]+ \\([^)]+\\) on delete cascade"
                ).matcher(region).find(),
                () -> "missing ownership ON DELETE CASCADE on " + constraint
            );
            seen++;
        }
        assertEquals(INTERNAL_CASCADE_FKS.size(), seen);

        for (String catalogFk : RESTRICT_FKS) {
            assertFalse(
                Pattern.compile("(?is)" + catalogFk + "[^,]*on delete cascade")
                    .matcher(region)
                    .find(),
                () -> catalogFk + " must restrict delete"
            );
        }
    }

    @Test
    void compatibilityMigrationPreflightsPrerequisitesAndFailsClosedOnPartialStructure() {
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
        assertTrue(catalogChecks.contains("raise exception"));

        assertTrue(catalogChecks.contains("prerequisite public.skills is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.skill_formulas is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.skill_effects is missing or incompatible"));
        assertTrue(catalogChecks.contains("pk_skills"));
        assertTrue(catalogChecks.contains("pk_skill_formulas"));
        assertTrue(catalogChecks.contains("pk_skill_effects"));

        assertTrue(catalogChecks.contains("existing_count not in (0, 18)"));
        assertTrue(catalogChecks.contains("partial target structure exists"));
        assertTrue(catalogChecks.contains("confdeltype <> 'c'") || catalogChecks.contains("confdeltype<>'c'"));
        assertTrue(catalogChecks.contains("confdeltype = 'c'") || catalogChecks.contains("confdeltype='c'"));

        int prereqPos = catalogChecks.indexOf("prerequisite public.skills");
        int partialPos = catalogChecks.indexOf("existing_count not in (0, 18)");
        int createPos = catalogChecks.indexOf("create table public.skill_internal_states");
        assertTrue(prereqPos >= 0 && prereqPos < partialPos);
        assertTrue(partialPos >= 0 && partialPos < createPos);

        assertFalse(catalogChecks.contains("create table if not exists"));
        assertFalse(catalogChecks.contains("create index if not exists"));
        for (String tableName : TARGET_TABLES) {
            assertTrue(catalogChecks.contains("create table public." + tableName));
        }
    }

    @Test
    void schemaAndMigrationShareFrozenCreateTableBodies() {
        for (String tableName : TARGET_TABLES) {
            String schemaTable = normalize(extractCreateTable(schemaSql, tableName));
            String migrationTable = normalize(extractCreateTable(migrationSql, tableName));
            assertTrue(schemaTable.contains("constraint pk_" + tableName));
            assertTrue(migrationTable.contains("constraint pk_" + tableName));
            assertFalse(migrationTable.contains("create table if not exists"));
        }
        String schemaSteps = normalize(extractCreateTable(schemaSql, "skill_process_steps"));
        String migrationSteps = normalize(extractCreateTable(migrationSql, "skill_process_steps"));
        assertTrue(schemaSteps.contains("on delete cascade"));
        assertTrue(migrationSteps.contains("on delete cascade"));
        assertTrue(migrationSteps.contains("'immediate', 'delay', 'multi_hit', 'periodic'"));
    }

    @Test
    void migrationDoesNotReadLegacyDataSeedDeleteOrDropCascade() {
        assertFalse(migrationNormalized.contains("create table if not exists public.skill_internal_states"));
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
        assertFalse(migrationNormalized.contains("legacy_process"));
        assertFalse(migrationNormalized.contains("legacy_internal"));

        Matcher cascade = Pattern.compile("on delete cascade").matcher(migrationNormalized);
        int cascadeCount = 0;
        while (cascade.find()) {
            cascadeCount++;
        }
        assertTrue(cascadeCount >= INTERNAL_CASCADE_FKS.size());
        for (String constraint : INTERNAL_CASCADE_FKS) {
            assertTrue(
                migrationNormalized.contains(constraint),
                () -> "migration missing ownership FK " + constraint
            );
        }
        assertTrue(migrationNormalized.contains("fk_skill_process_effect_bindings_effect"));
        assertTrue(migrationNormalized.contains("fk_skill_process_state_operations_state"));
        assertTrue(migrationNormalized.contains("fk_skill_process_state_operations_option"));
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
        Matcher matcher = Pattern.compile("(?is)DO\\s+(\\$[a-z0-9_]*\\$)(.*?)\\1").matcher(sql);
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
