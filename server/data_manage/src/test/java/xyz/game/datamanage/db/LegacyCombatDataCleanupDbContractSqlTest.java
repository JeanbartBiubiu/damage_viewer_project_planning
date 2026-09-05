package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for the legacy combat-data cleanup. Does not connect to a live database.
 */
class LegacyCombatDataCleanupDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String TRIGGERS_RELATIVE = "db/game_manage/triggers.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/breaking/drop_legacy_combat_data_chain.sql";

    static final List<String> KEEP_PARENTS = List.of(
        "games",
        "attributes",
        "game_level_configs",
        "characters",
        "character_attributes",
        "equipment",
        "equipment_attributes",
        "skill_categories",
        "skills",
        "skill_category_relations",
        "skill_parameters",
        "skill_formulas",
        "skill_formula_nodes",
        "damage_types",
        "modifier_zones",
        "statuses",
        "skill_effects",
        "skill_effect_results",
        "skill_effect_result_values",
        "skill_effect_result_spell_shield_policies",
        "skill_effect_damage_details",
        "skill_effect_result_critical_policies",
        "skill_effect_result_vamp_rules",
        "skill_effect_result_normal_shield_interactions",
        "skill_effect_damage_modifier_details",
        "skill_effect_healing_modifier_details",
        "skill_effect_damage_immunity_details",
        "skill_effect_health_floor_details",
        "skill_effect_execute_details",
        "skill_effect_attribute_change_details",
        "skill_effect_resource_change_details",
        "skill_effect_cooldown_change_details",
        "skill_effect_result_skill_scopes",
        "skill_effect_result_skill_targets",
        "skill_effect_result_skill_category_targets",
        "skill_effect_haste_modifier_details",
        "skill_effect_status_operation_details",
        "skill_effect_lifecycles",
        "skill_effect_result_lifecycle_behaviors",
        "skill_effect_lifecycle_operation_details",
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
        "skill_process_state_operations",
        "images"
    );

    static final List<String> STAGE_7_5_PARENTS = List.of(
        "skill_trigger_rules",
        "skill_trigger_rule_process_events",
        "skill_trigger_rule_skill_events",
        "skill_trigger_rule_result_events",
        "skill_trigger_rule_lifecycle_events",
        "skill_trigger_rule_status_events",
        "skill_trigger_rule_health_threshold_events",
        "skill_trigger_rule_internal_state_events",
        "skill_trigger_rule_subject_events",
        "skill_trigger_rule_damage_events",
        "skill_trigger_rule_spell_shield_blocked_events",
        "skill_trigger_rule_link_events",
        "skill_trigger_rule_condition_groups",
        "skill_trigger_rule_conditions",
        "skill_trigger_rule_attribute_conditions",
        "skill_trigger_rule_status_conditions",
        "skill_trigger_rule_internal_state_conditions",
        "skill_trigger_rule_event_value_conditions",
        "skill_trigger_rule_actions",
        "skill_trigger_rule_effect_actions",
        "skill_trigger_rule_process_actions",
        "skill_trigger_rule_runtime_input_bindings",
        "skill_trigger_rule_internal_state_bindings",
        "skill_trigger_rule_combat_status_bindings",
        "skill_trigger_rule_event_value_bindings",
        "skill_trigger_rule_prior_result_bindings",
        "skill_trigger_rule_result_modifiers",
        "skill_trigger_rule_per_target_cooldowns",
        "skill_trigger_rule_process_limits"
    );

    static final List<String> DROP_PARENTS = List.of(
        "game_data_state",
        "game_versions",
        "game_progression_schema",
        "game_progression_schema_log",
        "attribute_definitions",
        "attribute_definitions_log",
        "reserved_type",
        "reserved_type_relation",
        "types",
        "types_log",
        "type_relations",
        "type_relations_log",
        "game_entities",
        "game_entities_log",
        "entity_attribute_values",
        "entity_attribute_values_log",
        "entity_attribute_stage_values",
        "entity_attribute_stage_values_log",
        "provider_definitions",
        "provider_definitions_log",
        "provider_formulas",
        "provider_formulas_log",
        "provider_lifecycles",
        "provider_lifecycles_log",
        "entity_provider_mounts",
        "entity_provider_mounts_log",
        "provider_state_fields",
        "provider_state_fields_log",
        "ability_definitions",
        "ability_definitions_log",
        "ability_parameters",
        "ability_parameters_log",
        "ability_state_fields",
        "ability_state_fields_log",
        "ability_phases",
        "ability_phases_log",
        "ability_cooldowns",
        "ability_cooldowns_log",
        "provider_modifiers",
        "provider_modifiers_log",
        "provider_listeners",
        "provider_listeners_log",
        "listener_match_types",
        "listener_match_types_log",
        "effect_sequences",
        "effect_sequences_log",
        "effect_steps",
        "effect_steps_log",
        "ability_phase_effect_sequences",
        "ability_phase_effect_sequences_log",
        "listener_effect_sequences",
        "listener_effect_sequences_log",
        "provider_tick_sequences",
        "provider_tick_sequences_log",
        "damage_effect_details",
        "damage_effect_details_log",
        "heal_effect_details",
        "heal_effect_details_log",
        "attribute_effect_details",
        "attribute_effect_details_log",
        "shield_effect_details",
        "shield_effect_details_log",
        "provider_effect_details",
        "provider_effect_details_log",
        "event_effect_details",
        "event_effect_details_log",
        "ability_control_effect_details",
        "ability_control_effect_details_log",
        "state_effect_details",
        "state_effect_details_log",
        "repeat_effect_details",
        "repeat_effect_details_log",
        "execute_effect_details",
        "execute_effect_details_log"
    );

    static final List<String> LEGACY_TRIGGERS = List.of(
        "trg_effect_steps_exactly_one_detail",
        "trg_damage_effect_details_exactly_one_detail",
        "trg_heal_effect_details_exactly_one_detail",
        "trg_attribute_effect_details_exactly_one_detail",
        "trg_shield_effect_details_exactly_one_detail",
        "trg_provider_effect_details_exactly_one_detail",
        "trg_event_effect_details_exactly_one_detail",
        "trg_ability_control_effect_details_exactly_one_detail",
        "trg_state_effect_details_exactly_one_detail",
        "trg_repeat_effect_details_exactly_one_detail",
        "trg_execute_effect_details_exactly_one_detail"
    );

    static final List<String> CURRENT_TRIGGER_FUNCTIONS = List.of(
        "trg_skill_effect_result_complete_shape",
        "trg_skill_effect_lifecycle_aggregate_shape",
        "trg_skill_effect_lifecycle_refresh_target_duration",
        "trg_skill_internal_state_complete_shape",
        "trg_skill_process_step_complete_shape",
        "trg_skill_process_complete_shape"
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
    void schemaDefinesExactlyTheCurrentParentTables() {
        List<String> expected = currentParentTables();
        List<String> created = extractCreateTableNames(schemaSql);
        assertEquals(59, KEEP_PARENTS.size());
        assertEquals("images", KEEP_PARENTS.get(KEEP_PARENTS.size() - 1));
        assertEquals(29, STAGE_7_5_PARENTS.size());
        assertEquals(88, expected.size());
        assertEquals(expected, created);
        assertEquals(88, created.size());
        for (String table : DROP_PARENTS) {
            assertFalse(
                schemaNormalized.contains("create table public." + table + " "),
                () -> "schema.sql must not define dropped parent " + table
            );
        }
        for (String table : STAGE_7_5_PARENTS) {
            assertFalse(DROP_PARENTS.contains(table), () -> "stage 7.5 table must not be in cleanup drop set: " + table);
            assertFalse(KEEP_PARENTS.contains(table), () -> "stage 7.5 table must not be required in cleanup keep set: " + table);
        }
        assertTrue(schemaNormalized.contains("create table public.images ("));
        assertTrue(schemaNormalized.contains("partition by list (game_id)"));
        int imagesIdx = schemaNormalized.indexOf("create table public.images");
        int partitionIdx = schemaNormalized.indexOf("partition by list (game_id)", imagesIdx);
        assertTrue(partitionIdx > imagesIdx, "images must keep PARTITION BY LIST (game_id)");
    }

    @Test
    void triggersKeepImagePartitionsAndCurrentSkillConstraints() {
        assertTrue(triggersNormalized.contains("create or replace function public.ensure_game_partitions(p_game_id varchar)"));
        assertTrue(triggersNormalized.contains("v_parents text[] := array[ 'images' ]")
            || triggersNormalized.contains("v_parents text[] := array['images']"));
        assertFalse(triggersNormalized.contains("attribute_definitions"));
        assertFalse(triggersNormalized.contains("effect_steps"));
        assertFalse(triggersNormalized.contains("ensure_game_data_state"));
        assertFalse(triggersNormalized.contains("count_effect_step_details"));
        assertFalse(triggersNormalized.contains("trg_effect_step_exactly_one_detail"));
        for (String triggerName : LEGACY_TRIGGERS) {
            assertFalse(triggersSql.contains(triggerName), () -> "legacy trigger remains: " + triggerName);
        }
        assertTrue(triggersSql.contains("trg_games_after_insert_create_partitions"));
        assertTrue(triggersNormalized.contains("perform public.ensure_game_partitions(new.game_id)"));
        assertFalse(triggersNormalized.contains("perform public.ensure_game_data_state"));
        for (String functionName : CURRENT_TRIGGER_FUNCTIONS) {
            assertTrue(
                triggersSql.contains("FUNCTION public." + functionName)
                    || triggersSql.contains("function public." + functionName),
                () -> "current trigger function missing: " + functionName
            );
        }
        assertTrue(triggersSql.contains("CREATE TRIGGER trg_games_after_insert_create_partitions"));
        assertTrue(triggersSql.contains("trg_skill_effect_results_complete_shape")
            || triggersSql.contains("trg_skill_effect_result_complete_shape"));
    }

    @Test
    void breakingMigrationCoversExactDropSetWithoutCascade() {
        List<String> historicalKeepParents = KEEP_PARENTS.stream()
            .filter(table -> !Set.of(
                "skill_effect_result_skill_scopes",
                "skill_effect_result_skill_targets",
                "skill_effect_result_skill_category_targets",
                "skill_effect_haste_modifier_details",
                "skill_effect_result_critical_policies",
                "skill_effect_result_vamp_rules",
                "skill_effect_result_normal_shield_interactions",
                "skill_effect_result_spell_shield_policies",
                "skill_effect_damage_modifier_details",
                "skill_effect_healing_modifier_details",
                "skill_effect_damage_immunity_details",
                "skill_effect_health_floor_details",
                "skill_effect_execute_details",
                "modifier_zones"
            ).contains(table))
            .toList();
        assertEquals(45, historicalKeepParents.size());
        assertEquals(74, DROP_PARENTS.size());
        assertEquals(11, LEGACY_TRIGGERS.size());
        for (String table : historicalKeepParents) {
            assertTrue(migrationSql.contains("'" + table + "'"), () -> "keep parent missing from migration: " + table);
        }
        for (String table : DROP_PARENTS) {
            assertTrue(migrationSql.contains("'" + table + "'"), () -> "drop parent missing from migration: " + table);
        }
        for (String table : STAGE_7_5_PARENTS) {
            assertFalse(DROP_PARENTS.contains(table), () -> "stage 7.5 table must not be in cleanup drop set: " + table);
        }
        for (String triggerName : LEGACY_TRIGGERS) {
            assertTrue(migrationSql.contains("'" + triggerName + "'"), () -> "legacy trigger missing: " + triggerName);
        }
        assertTrue(migrationNormalized.contains("drop function if exists public.ensure_game_data_state(varchar)"));
        assertTrue(migrationNormalized.contains("drop function if exists public.trg_effect_step_exactly_one_detail()"));
        assertTrue(migrationNormalized.contains(
            "drop function if exists public.count_effect_step_details(varchar, varchar)"
        ));
        assertTrue(migrationNormalized.contains("drop table if exists public.%i"));
        assertTrue(migrationNormalized.contains("pg_depend"));
        assertTrue(migrationNormalized.contains("pg_rewrite"));
        assertTrue(migrationNormalized.contains("pg_inherits"));
        assertFalse(Pattern.compile("(?is)\\bcascade\\b").matcher(migrationSql).find());
        assertTrue(migrationNormalized.contains("begin"));
        assertTrue(migrationNormalized.contains("commit"));
        assertTrue(migrationNormalized.contains("partition by list (game_id)")
            || migrationNormalized.contains("list (game_id)"));
        assertTrue(migrationNormalized.contains("ensure_game_partitions"));
        assertTrue(migrationNormalized.contains("trg_games_after_insert_create_partitions"));
    }

    @Test
    void breakingMigrationUsesCatalogQualifiedClosureIdentity() {
        assertTrue(migrationNormalized.contains("create temp table tmp_legacy_closure ("));
        assertTrue(migrationNormalized.contains("classid oid not null"));
        assertTrue(migrationNormalized.contains("objid oid not null"));
        assertTrue(migrationNormalized.contains("primary key (classid, objid)"));
        assertFalse(migrationNormalized.contains("obj_oid"));
        assertFalse(migrationNormalized.contains("tmp_legacy_closure_oids"));
        assertFalse(
            Pattern.compile("(?is)d\\.refobjid\\s+in\\s*\\(\\s*select\\s+obj_oid").matcher(migrationSql).find()
        );
        assertFalse(
            Pattern.compile("(?is)d\\.objid\\s+not\\s+in\\s*\\(\\s*select\\s+obj_oid").matcher(migrationSql).find()
        );

        assertTrue(migrationNormalized.contains("select 'pg_class'::regclass, c.oid"));
        assertTrue(migrationNormalized.contains("select 'pg_class'::regclass, oid from parts"));
        assertTrue(migrationNormalized.contains("select 'pg_class'::regclass, c.reltoastrelid"));
        assertTrue(migrationNormalized.contains("select 'pg_class'::regclass, i.indexrelid"));
        assertTrue(migrationNormalized.contains("select 'pg_class'::regclass, s.oid"));
        assertTrue(migrationNormalized.contains("select 'pg_type'::regclass, t.oid"));
        assertTrue(migrationNormalized.contains("select 'pg_constraint'::regclass, c.oid"));
        assertTrue(migrationNormalized.contains("select 'pg_trigger'::regclass, tg.oid"));
        assertTrue(migrationNormalized.contains("select 'pg_proc'::regclass, p.oid"));

        assertTrue(migrationNormalized.contains("p.classid = 'pg_class'::regclass"));
        assertTrue(migrationNormalized.contains("p.objid = i.inhparent"));
        assertTrue(migrationNormalized.contains("o.classid = 'pg_class'::regclass"));
        assertTrue(migrationNormalized.contains("o.classid = d.refclassid"));
        assertTrue(migrationNormalized.contains("o.objid = d.refobjid"));

        assertTrue(migrationNormalized.contains("ref.classid = d.refclassid"));
        assertTrue(migrationNormalized.contains("ref.objid = d.refobjid"));
        assertTrue(migrationNormalized.contains("obj.classid = d.classid"));
        assertTrue(migrationNormalized.contains("obj.objid = d.objid"));

        assertTrue(migrationNormalized.contains("tgt_c.classid = 'pg_class'::regclass"));
        assertTrue(migrationNormalized.contains("tgt_c.objid = tgt.oid"));
        assertTrue(migrationNormalized.contains("src_c.classid = 'pg_class'::regclass"));
        assertTrue(migrationNormalized.contains("src_c.objid = src.oid"));

        assertFalse(Pattern.compile("(?is)\\bcascade\\b").matcher(migrationSql).find());
        assertFalse(Pattern.compile("(?is)\\bcascade\\b").matcher(migrationNormalized).find());
    }

    @Test
    void breakingMigrationIncludesRelationAndConstraintTriggersInClosure() {
        Pattern triggerOnClosureRelation = Pattern.compile(
            "(?is)INSERT\\s+INTO\\s+tmp_legacy_closure\\s*\\(\\s*classid\\s*,\\s*objid\\s*\\)\\s*"
                + "SELECT\\s+'pg_trigger'::regclass\\s*,\\s*tg\\.oid\\s+"
                + "FROM\\s+pg_trigger\\s+tg\\s+"
                + "JOIN\\s+tmp_legacy_closure\\s+\\w+\\s+"
                + "ON\\s+\\w+\\.classid\\s*=\\s*'pg_class'::regclass\\s+"
                + "AND\\s+(?:\\w+\\.objid\\s*=\\s*tg\\.tgrelid|tg\\.tgrelid\\s*=\\s*\\w+\\.objid)"
        );
        Pattern triggerOnClosureConstraint = Pattern.compile(
            "(?is)INSERT\\s+INTO\\s+tmp_legacy_closure\\s*\\(\\s*classid\\s*,\\s*objid\\s*\\)\\s*"
                + "SELECT\\s+'pg_trigger'::regclass\\s*,\\s*tg\\.oid\\s+"
                + "FROM\\s+pg_trigger\\s+tg\\s+"
                + "JOIN\\s+tmp_legacy_closure\\s+\\w+\\s+"
                + "ON\\s+\\w+\\.classid\\s*=\\s*'pg_constraint'::regclass\\s+"
                + "AND\\s+(?:\\w+\\.objid\\s*=\\s*tg\\.tgconstraint|tg\\.tgconstraint\\s*=\\s*\\w+\\.objid)"
        );
        assertTrue(
            triggerOnClosureRelation.matcher(migrationSql).find(),
            "closure must include triggers attached to closure relations via tgrelid"
        );
        assertTrue(
            triggerOnClosureConstraint.matcher(migrationSql).find(),
            "closure must include FK internal triggers via tgconstraint even when attached elsewhere"
        );
        assertTrue(migrationNormalized.contains("o.objid = tg.tgrelid")
            || migrationNormalized.contains("tg.tgrelid = o.objid"));
        assertTrue(migrationNormalized.contains("o.objid = tg.tgconstraint")
            || migrationNormalized.contains("tg.tgconstraint = o.objid"));
        assertFalse(
            Pattern.compile("(?is)FROM\\s+pg_trigger\\s+tg\\s+ON CONFLICT").matcher(migrationSql).find(),
            "must not admit every pg_trigger row unconditionally"
        );
        assertTrue(
            migrationNormalized.contains("foreign key from outside the drop set"),
            "retained-table FKs onto the drop set must remain independently blocked"
        );
        assertFalse(Pattern.compile("(?is)\\bcascade\\b").matcher(migrationSql).find());
    }

    private static List<String> currentParentTables() {
        List<String> current = new ArrayList<>(KEEP_PARENTS.size() + STAGE_7_5_PARENTS.size());
        current.addAll(KEEP_PARENTS.subList(0, KEEP_PARENTS.size() - 1));
        current.addAll(STAGE_7_5_PARENTS);
        current.add(KEEP_PARENTS.get(KEEP_PARENTS.size() - 1));
        return current;
    }

    private static List<String> extractCreateTableNames(String sql) {
        Matcher matcher = Pattern.compile("(?m)^CREATE TABLE public\\.([a-z0-9_]+)").matcher(sql);
        Set<String> names = new LinkedHashSet<>();
        while (matcher.find()) {
            names.add(matcher.group(1));
        }
        return new ArrayList<>(names);
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
