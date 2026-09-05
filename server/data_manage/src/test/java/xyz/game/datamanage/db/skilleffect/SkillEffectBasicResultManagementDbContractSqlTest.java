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
 * Static SQL contract for skill effect tables, deferred shape triggers and compatibility migration.
 * Does not connect to a live database.
 */
class SkillEffectBasicResultManagementDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String TRIGGERS_RELATIVE = "db/game_manage/triggers.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/skill_effect_basic_result_management_migration.sql";

    private static final List<String> TARGET_TABLES = List.of(
        "skill_effects",
        "skill_effect_results",
        "skill_effect_result_values",
        "skill_effect_damage_details",
        "skill_effect_attribute_change_details",
        "skill_effect_resource_change_details",
        "skill_effect_cooldown_change_details",
        "skill_effect_status_operation_details"
    );

    private static final List<String> INTERNAL_CASCADE_FKS = List.of(
        "fk_skill_effect_results_effect",
        "fk_skill_effect_result_values_result",
        "fk_skill_effect_damage_details_result",
        "fk_skill_effect_attribute_change_details_result",
        "fk_skill_effect_resource_change_details_result",
        "fk_skill_effect_cooldown_change_details_result",
        "fk_skill_effect_status_operation_details_result"
    );

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
    void schemaDefinesCurrentTablesWithCompositeKeysForeignKeysChecksAndIndexes() {
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

        String effects = normalize(extractCreateTable(schemaSql, "skill_effects"));
        assertTrue(effects.contains("constraint pk_skill_effects"));
        assertTrue(effects.contains("primary key (game_id, skill_key, effect_key)"));
        assertTrue(effects.contains("constraint fk_skill_effects_skill"));
        assertTrue(effects.contains(
            "foreign key (game_id, skill_key) references public.skills (game_id, skill_key)"
        ));
        assertFalse(effects.contains("on delete cascade"));
        assertTrue(effects.contains("constraint ck_skill_effects_key"));
        assertTrue(effects.contains("^[a-z][a-z0-9_]{0,63}$"));
        assertTrue(effects.contains("constraint ck_skill_effects_name"));
        assertTrue(effects.contains("btrim(name) <> ''"));
        assertTrue(effects.contains("constraint ck_skill_effects_sort_order"));
        assertTrue(effects.contains("sort_order >= 0"));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effects_list on public.skill_effects "
                + "(game_id, skill_key, sort_order, effect_key)"
        ));

        String results = normalize(extractCreateTable(schemaSql, "skill_effect_results"));
        assertTrue(results.contains("constraint pk_skill_effect_results"));
        assertTrue(results.contains("primary key (game_id, skill_key, effect_key, result_key)"));
        assertTrue(results.contains("constraint fk_skill_effect_results_effect"));
        assertTrue(results.contains(
            "foreign key (game_id, skill_key, effect_key) "
                + "references public.skill_effects (game_id, skill_key, effect_key) "
                + "on delete cascade"
        ));
        assertTrue(results.contains("'damage', 'direct_heal', 'normal_shield', 'attribute_change'"));
        assertTrue(results.contains("'resource_change', 'cooldown_change', 'status_operation'"));
        assertTrue(results.contains("target in ('source', 'target')"));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effect_results_list on public.skill_effect_results "
                + "(game_id, skill_key, effect_key, sort_order, result_key)"
        ));

        String values = normalize(extractCreateTable(schemaSql, "skill_effect_result_values"));
        assertTrue(values.contains("constraint pk_skill_effect_result_values"));
        assertTrue(values.contains("constraint fk_skill_effect_result_values_result"));
        assertTrue(values.contains(
            "references public.skill_effect_results (game_id, skill_key, effect_key, result_key) "
                + "on delete cascade"
        ));
        assertTrue(values.contains("constraint fk_skill_effect_result_values_formula"));
        assertTrue(values.contains(
            "foreign key (game_id, skill_key, formula_key) "
                + "references public.skill_formulas (game_id, skill_key, formula_key)"
        ));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_result_values_formula[^,]*on delete cascade"
        ).matcher(values).find());
        assertTrue(values.contains("fixed_multiplier >= 0"));
        assertTrue(values.contains("fixed_min_value <= fixed_max_value"));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effect_result_values_formula on public.skill_effect_result_values "
                + "(game_id, skill_key, formula_key, effect_key, result_key)"
        ));

        String damage = normalize(extractCreateTable(schemaSql, "skill_effect_damage_details"));
        assertTrue(damage.contains("constraint fk_skill_effect_damage_details_result"));
        assertTrue(damage.contains("on delete cascade"));
        assertTrue(damage.contains("constraint fk_skill_effect_damage_details_damage_type"));
        assertTrue(damage.contains(
            "foreign key (game_id, damage_type_key) "
                + "references public.damage_types (game_id, damage_type_key)"
        ));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_damage_details_damage_type[^,]*on delete cascade"
        ).matcher(damage).find());
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effect_damage_details_type on public.skill_effect_damage_details "
                + "(game_id, damage_type_key, skill_key, effect_key, result_key)"
        ));

        String attributes = normalize(extractCreateTable(schemaSql, "skill_effect_attribute_change_details"));
        assertTrue(attributes.contains("constraint fk_skill_effect_attribute_change_details_attribute"));
        assertTrue(attributes.contains(
            "foreign key (game_id, attribute_key) references public.attributes (game_id, attribute_key)"
        ));
        assertTrue(attributes.contains("operation in ('increase', 'decrease', 'set')"));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_attribute_change_details_attribute[^,]*on delete cascade"
        ).matcher(attributes).find());
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effect_attribute_change_details_attribute "
                + "on public.skill_effect_attribute_change_details "
                + "(game_id, attribute_key, skill_key, effect_key, result_key)"
        ));

        String resources = normalize(extractCreateTable(schemaSql, "skill_effect_resource_change_details"));
        assertTrue(resources.contains("constraint fk_skill_effect_resource_change_details_attribute"));
        assertTrue(resources.contains("operation in ('restore', 'consume', 'refund')"));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_resource_change_details_attribute[^,]*on delete cascade"
        ).matcher(resources).find());
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effect_resource_change_details_attribute "
                + "on public.skill_effect_resource_change_details "
                + "(game_id, attribute_key, skill_key, effect_key, result_key)"
        ));

        String cooldowns = normalize(extractCreateTable(schemaSql, "skill_effect_cooldown_change_details"));
        assertFalse(cooldowns.contains("affected_skill_key"));
        assertTrue(cooldowns.contains("operation in ('reduce', 'increase', 'reset')"));

        String statuses = normalize(extractCreateTable(schemaSql, "skill_effect_status_operation_details"));
        assertTrue(statuses.contains("constraint fk_skill_effect_status_operation_details_status"));
        assertTrue(statuses.contains(
            "foreign key (game_id, status_key) references public.statuses (game_id, status_key)"
        ));
        assertTrue(statuses.contains("operation in ('apply', 'remove')"));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_status_operation_details_status[^,]*on delete cascade"
        ).matcher(statuses).find());
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_effect_status_operation_details_status "
                + "on public.skill_effect_status_operation_details "
                + "(game_id, status_key, skill_key, effect_key, result_key)"
        ));
    }

    @Test
    void deferredTriggersCoverSevenResultShapesAndParentDeleteShortCircuit() {
        assertTrue(triggersNormalized.contains(
            "create or replace function public.trg_skill_effect_result_complete_shape()"
        ));
        assertTrue(triggersNormalized.contains("constraint trigger trg_skill_effect_results_complete_shape"));
        assertTrue(triggersNormalized.contains("deferrable initially deferred"));
        assertTrue(triggersNormalized.contains("if not found then"));
        assertTrue(triggersNormalized.contains("return coalesce(new, old)"));

        assertTrue(triggersSql.contains("DAMAGE shape invalid at commit"));
        assertTrue(triggersSql.contains("ATTRIBUTE_CHANGE shape invalid at commit"));
        assertTrue(triggersSql.contains("RESOURCE_CHANGE shape invalid at commit"));
        assertTrue(triggersSql.contains("COOLDOWN_CHANGE shape invalid at commit"));
        assertTrue(triggersSql.contains("COOLDOWN_CHANGE % requires value rule at commit"));
        assertTrue(triggersSql.contains("COOLDOWN_CHANGE RESET must not have value rule at commit"));
        assertTrue(triggersSql.contains("STATUS_OPERATION shape invalid at commit"));
        assertTrue(Pattern.compile(
            "(?s)v_result_type = 'DIRECT_HEAL'.*?% shape invalid at commit"
        ).matcher(triggersSql).find());
        assertTrue(triggersSql.contains("NORMAL_SHIELD shape invalid at commit"));

        for (String detailTable : List.of(
            "skill_effect_result_values",
            "skill_effect_damage_details",
            "skill_effect_attribute_change_details",
            "skill_effect_resource_change_details",
            "skill_effect_cooldown_change_details",
            "skill_effect_status_operation_details"
        )) {
            assertTrue(
                triggersSql.contains("'" + detailTable + "'"),
                () -> "deferred trigger list missing " + detailTable
            );
        }
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
            assertFalse(table.contains("process"), () -> tableName + " must not add process columns");
            if ("skill_effect_results".equals(tableName)) {
                assertFalse(table.contains("lifecycle_enabled"),
                    () -> tableName + " must not add lifecycle columns");
                assertFalse(table.contains("duration_formula"),
                    () -> tableName + " must not add lifecycle columns");
            } else {
                assertFalse(table.contains("lifecycle"), () -> tableName + " must not add lifecycle columns");
            }
            assertFalse(table.contains("condition"), () -> tableName + " must not add condition columns");
            assertFalse(table.contains("event_"), () -> tableName + " must not add event columns");
            assertFalse(table.contains("crit"), () -> tableName + " must not add crit columns");
            assertFalse(table.contains("lifesteal"), () -> tableName + " must not add lifesteal columns");
            if (!"skill_effect_results".equals(tableName)) {
                assertFalse(table.contains("execute"), () -> tableName + " must not add execute columns");
            }
            if (!"skill_effect_damage_details".equals(tableName)) {
                assertFalse(table.contains("reflect"), () -> tableName + " must not add reflect columns");
            } else {
                assertFalse(table.contains("reflect_"), () -> tableName + " must not add dedicated reflect columns");
            }
            assertFalse(table.contains("previous_result"), () -> tableName + " must not add previous-result columns");
            assertFalse(table.contains("wasm"), () -> tableName + " must not add wasm columns");
            assertFalse(table.contains("publish"), () -> tableName + " must not add publish columns");
            assertFalse(table.contains("revision"), () -> tableName + " must not add revision columns");
        }
        assertFalse(schemaNormalized.contains("create table public.skill_effect_execute ("));
        assertFalse(schemaNormalized.contains("create table public.skill_effect_reflect"));
    }

    @Test
    void internalCascadeIsLimitedToOwnershipForeignKeys() {
        String effectsRegion = schemaNormalized.substring(
            schemaNormalized.indexOf("create table public.skill_effects"),
            schemaNormalized.indexOf("create table public.images")
        );
        int seen = 0;
        for (String constraint : INTERNAL_CASCADE_FKS) {
            assertTrue(
                Pattern.compile(
                    "constraint " + Pattern.quote(constraint)
                        + " foreign key \\([^)]+\\) references [\\w.]+ \\([^)]+\\) on delete cascade"
                ).matcher(effectsRegion).find(),
                () -> "missing ownership ON DELETE CASCADE on " + constraint
            );
            seen++;
        }
        assertEquals(INTERNAL_CASCADE_FKS.size(), seen);

        for (String catalogFk : List.of(
            "fk_skill_effects_skill",
            "fk_skill_effect_result_values_formula",
            "fk_skill_effect_damage_details_damage_type",
            "fk_skill_effect_attribute_change_details_attribute",
            "fk_skill_effect_resource_change_details_attribute",
            "fk_skill_effect_status_operation_details_status"
        )) {
            assertFalse(
                Pattern.compile("(?is)" + catalogFk + "[^,]*on delete cascade")
                    .matcher(effectsRegion)
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
        assertTrue(catalogChecks.contains("pg_index"));
        assertTrue(catalogChecks.contains("raise exception"));

        assertTrue(catalogChecks.contains("prerequisite public.skills is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.skill_formulas is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.damage_types is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.attributes is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.statuses is missing or incompatible"));
        assertTrue(catalogChecks.contains("pk_skills"));
        assertTrue(catalogChecks.contains("pk_skill_formulas"));
        assertTrue(catalogChecks.contains("pk_damage_types"));
        assertTrue(catalogChecks.contains("pk_attributes"));
        assertTrue(catalogChecks.contains("pk_statuses"));

        assertTrue(catalogChecks.contains("existing_count not in (0, 8)"));
        assertTrue(catalogChecks.contains("partial target structure exists"));
        assertTrue(catalogChecks.contains("confdeltype <> 'c'") || catalogChecks.contains("confdeltype<>'c'"));
        assertTrue(catalogChecks.contains("confdeltype = 'c'") || catalogChecks.contains("confdeltype='c'"));

        int prereqPos = catalogChecks.indexOf("prerequisite public.skills");
        int partialPos = catalogChecks.indexOf("existing_count not in (0, 8)");
        int createPos = catalogChecks.indexOf("create table public.skill_effects");
        assertTrue(prereqPos >= 0 && prereqPos < partialPos);
        assertTrue(partialPos >= 0 && partialPos < createPos);

        assertFalse(catalogChecks.contains("create table if not exists"));
        assertFalse(catalogChecks.contains("create index if not exists"));
        for (String tableName : TARGET_TABLES) {
            assertTrue(catalogChecks.contains("create table public." + tableName));
        }
    }

    @Test
    void compatibilityMigrationNormalizesNumericCastsWhenCheckingMultiplierConstraint() {
        String catalogChecks = stripLineComments(extractDoBlock(migrationSql));
        int start = catalogChecks.indexOf("ck_skill_effect_result_values_multiplier");
        assertTrue(start >= 0, "multiplier constraint check missing");
        int end = catalogChecks.indexOf("ck_skill_effect_result_values_bounds", start);
        assertTrue(end > start, "bounds constraint check missing after multiplier check");
        String multiplierCheck = catalogChecks.substring(start, end);

        assertTrue(multiplierCheck.contains("pg_get_constraintdef"));
        assertTrue(multiplierCheck.contains("regexp_replace"));
        assertTrue(
            Pattern.compile("fixed_multiplier\\s*>=\\s*0").matcher(multiplierCheck).find(),
            "must still require expression fixed_multiplier >= 0"
        );
        assertTrue(
            multiplierCheck.contains("(0)::numeric"),
            "must normalize PostgreSQL numeric constant casts such as (0)::numeric"
        );
        assertTrue(
            Pattern.compile("\\[\\(\\)\\]").matcher(multiplierCheck).find(),
            "must strip unsemantic parentheses after numeric-cast normalization"
        );
        assertFalse(
            Pattern.compile("fixed_multiplier\\s*>\\s*0").matcher(multiplierCheck).find(),
            "must not treat fixed_multiplier > 0 as compatible"
        );
        assertFalse(
            Pattern.compile("fixed_multiplier\\s*>=\\s*1").matcher(multiplierCheck).find(),
            "must not treat fixed_multiplier >= 1 as compatible"
        );
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
        String schemaResults = normalize(extractCreateTable(schemaSql, "skill_effect_results"));
        String migrationResults = normalize(extractCreateTable(migrationSql, "skill_effect_results"));
        assertTrue(schemaResults.contains("on delete cascade"));
        assertTrue(migrationResults.contains("on delete cascade"));
        assertTrue(migrationResults.contains("'damage', 'direct_heal', 'normal_shield'"));
    }

    @Test
    void migrationDoesNotReadLegacyDataSeedDeleteOrDropCascade() {
        assertFalse(migrationNormalized.contains("create table if not exists public.skill_effects"));
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
        assertFalse(migrationNormalized.contains("old_effect"));
        assertFalse(migrationNormalized.contains("legacy_effect"));

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
