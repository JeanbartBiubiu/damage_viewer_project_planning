package xyz.game.datamanage.db.skilltrigger;

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
 * Static SQL contract for Stage 7.5 skill trigger rule tables, deferred shape
 * triggers and compatibility migration. Does not connect to a live database.
 */
class ConditionEventDynamicInputManagementDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String TRIGGERS_RELATIVE = "db/game_manage/triggers.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/condition_event_dynamic_input_management_migration.sql";
    private static final String MAPPER_JAVA_RELATIVE =
        "server/data_manage/src/main/java/xyz/game/datamanage/mapper/skilltrigger/SkillTriggerRuleMapper.java";
    private static final String MAPPER_XML_RELATIVE =
        "server/data_manage/src/main/resources/mapper/skilltrigger/SkillTriggerRuleMapper.xml";

    private static final List<String> TARGET_TABLES = List.of(
        "skill_trigger_rules",
        "skill_trigger_rule_process_events",
        "skill_trigger_rule_skill_events",
        "skill_trigger_rule_result_events",
        "skill_trigger_rule_lifecycle_events",
        "skill_trigger_rule_status_events",
        "skill_trigger_rule_health_threshold_events",
        "skill_trigger_rule_internal_state_events",
        "skill_trigger_rule_subject_events",
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

    private static final List<String> OWNERSHIP_CASCADE_FKS = List.of(
        "fk_skill_trigger_process_events_rule",
        "fk_skill_trigger_skill_events_rule",
        "fk_skill_trigger_result_events_rule",
        "fk_skill_trigger_lifecycle_events_rule",
        "fk_skill_trigger_status_events_rule",
        "fk_skill_trigger_health_threshold_events_rule",
        "fk_skill_trigger_istate_events_rule",
        "fk_skill_trigger_subject_events_rule",
        "fk_skill_trigger_condition_groups_rule",
        "fk_skill_trigger_conditions_group",
        "fk_skill_trigger_attr_cond_condition",
        "fk_skill_trigger_status_cond_condition",
        "fk_skill_trigger_istate_cond_condition",
        "fk_skill_trigger_event_value_cond_condition",
        "fk_skill_trigger_actions_rule",
        "fk_skill_trigger_effect_actions_action",
        "fk_skill_trigger_process_actions_action",
        "fk_skill_trigger_runtime_bindings_action",
        "fk_skill_trigger_istate_bind_binding",
        "fk_skill_trigger_combat_status_bind_binding",
        "fk_skill_trigger_event_value_bind_binding",
        "fk_skill_trigger_prior_result_bind_binding",
        "fk_skill_trigger_result_modifiers_action",
        "fk_skill_trigger_per_target_cd_rule",
        "fk_skill_trigger_process_limits_rule"
    );

    private static final List<String> RESTRICT_FKS = List.of(
        "fk_skill_trigger_rules_skill",
        "fk_skill_trigger_process_events_process",
        "fk_skill_trigger_process_events_step",
        "fk_skill_trigger_skill_events_source_skill",
        "fk_skill_trigger_result_events_result",
        "fk_skill_trigger_lifecycle_events_effect",
        "fk_skill_trigger_lifecycle_events_lifecycle",
        "fk_skill_trigger_status_events_status",
        "fk_skill_trigger_health_threshold_events_attribute",
        "fk_skill_trigger_health_threshold_formula",
        "fk_skill_trigger_istate_events_state",
        "fk_skill_trigger_attr_cond_attribute",
        "fk_skill_trigger_attr_cond_formula",
        "fk_skill_trigger_status_cond_status",
        "fk_skill_trigger_status_cond_source_result",
        "fk_skill_trigger_status_cond_formula",
        "fk_skill_trigger_istate_cond_state",
        "fk_skill_trigger_istate_cond_option",
        "fk_skill_trigger_istate_cond_formula",
        "fk_skill_trigger_event_value_cond_formula",
        "fk_skill_trigger_effect_actions_effect",
        "fk_skill_trigger_process_actions_process",
        "fk_skill_trigger_runtime_bindings_parameter",
        "fk_skill_trigger_istate_bind_state",
        "fk_skill_trigger_istate_bind_option",
        "fk_skill_trigger_combat_status_bind_status",
        "fk_skill_trigger_combat_status_bind_result",
        "fk_skill_trigger_result_modifiers_effect_action",
        "fk_skill_trigger_result_modifiers_result",
        "fk_skill_trigger_per_target_cd_formula",
        "fk_skill_trigger_process_limits_process",
        "fk_skill_trigger_process_limit_formula"
    );

    private static final List<String> REVERSE_INDEXES = List.of(
        "ix_skill_trigger_rules_list",
        "ix_skill_trigger_rules_event_type",
        "ix_skill_trigger_process_events_process",
        "ix_skill_trigger_process_events_step",
        "ix_skill_trigger_skill_events_source_skill",
        "ix_skill_trigger_result_events_result",
        "ix_skill_trigger_lifecycle_events_effect",
        "ix_skill_trigger_status_events_status",
        "ix_skill_trigger_health_threshold_events_attribute",
        "ix_skill_trigger_health_threshold_events_formula",
        "ix_skill_trigger_istate_events_state",
        "ix_skill_trigger_condition_groups_list",
        "ix_skill_trigger_conditions_list",
        "ix_skill_trigger_attr_cond_attribute",
        "ix_skill_trigger_attr_cond_formula",
        "ix_skill_trigger_status_cond_status",
        "ix_skill_trigger_status_cond_source_result",
        "ix_skill_trigger_status_cond_formula",
        "ix_skill_trigger_istate_cond_state",
        "ix_skill_trigger_istate_cond_option",
        "ix_skill_trigger_istate_cond_formula",
        "ix_skill_trigger_event_value_cond_formula",
        "ix_skill_trigger_actions_list",
        "ix_skill_trigger_actions_type",
        "ix_skill_trigger_effect_actions_effect",
        "ix_skill_trigger_process_actions_process",
        "ix_skill_trigger_runtime_bindings_parameter",
        "ix_skill_trigger_istate_bind_state",
        "ix_skill_trigger_istate_bind_option",
        "ix_skill_trigger_combat_status_bind_status",
        "ix_skill_trigger_combat_status_bind_source_result",
        "ix_skill_trigger_prior_result_bind_source_action",
        "ix_skill_trigger_prior_result_bind_result",
        "ix_skill_trigger_result_modifiers_result",
        "ix_skill_trigger_per_target_cd_formula",
        "ix_skill_trigger_process_limits_process",
        "ix_skill_trigger_process_limits_formula"
    );

    private static final List<String> EVENT_TYPES = List.of(
        "SKILL_USED",
        "BASIC_ATTACK_START",
        "BASIC_ATTACK_HIT",
        "SKILL_HIT",
        "PROCESS_MOMENT",
        "RESULT_AVAILABLE",
        "LIFECYCLE_MOMENT",
        "DAMAGE_DEALT",
        "DAMAGE_TAKEN",
        "STATUS_CHANGED",
        "HEALTH_THRESHOLD_CROSSED",
        "INTERNAL_STATE_CHANGED",
        "CONTROL_RECEIVED",
        "ENTITY_DIED",
        "ENTITY_UNTARGETABLE",
        "KILL",
        "PROCESS_CANCEL_REQUESTED"
    );

    private static final List<String> DETAIL_TRIGGER_TABLES = TARGET_TABLES.subList(1, TARGET_TABLES.size());

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
    void schemaDefinesTwentySixTablesWithCompositeKeysForeignKeysChecksAndIndexes() {
        assertEquals(26, TARGET_TABLES.size());
        for (String tableName : TARGET_TABLES) {
            assertTrue(
                schemaNormalized.contains("create table public." + tableName),
                () -> "missing CREATE TABLE public." + tableName
            );
            assertFalse(
                schemaNormalized.contains("create table if not exists public." + tableName),
                () -> "fresh schema must not use IF NOT EXISTS for " + tableName
            );
            String table = normalize(extractCreateTable(schemaSql, tableName));
            assertTrue(table.contains("constraint pk_" + tableName) || table.contains("primary key ("));
            assertNoJsonbArraysOrPayload(table, tableName);
        }

        String rules = normalize(extractCreateTable(schemaSql, "skill_trigger_rules"));
        assertTrue(rules.contains("constraint pk_skill_trigger_rules"));
        assertTrue(rules.contains("primary key (game_id, skill_key, rule_key)"));
        assertTrue(rules.contains("constraint fk_skill_trigger_rules_skill"));
        assertFalse(Pattern.compile("(?is)fk_skill_trigger_rules_skill[^,]*on delete cascade")
            .matcher(rules).find());
        for (String eventType : EVENT_TYPES) {
            assertTrue(rules.contains("'" + eventType.toLowerCase() + "'"), () -> "missing event type " + eventType);
        }
        assertEquals(17, EVENT_TYPES.size());
        assertFalse(rules.contains("'value_reached'"));

        String istateEvents = normalize(extractCreateTable(schemaSql, "skill_trigger_rule_internal_state_events"));
        assertTrue(istateEvents.contains("'value_changed', 'option_selected', 'flag_changed', 'cooldown_ready'"));
        assertFalse(istateEvents.contains("'value_reached'"));

        String conditions = normalize(extractCreateTable(schemaSql, "skill_trigger_rule_conditions"));
        assertTrue(conditions.contains(
            "'attribute_compare', 'status_check', 'internal_state_check', 'event_value_compare'"
        ));

        String actions = normalize(extractCreateTable(schemaSql, "skill_trigger_rule_actions"));
        assertTrue(actions.contains("'execute_effect', 'start_process', 'fail_process'"));

        String bindings = normalize(extractCreateTable(schemaSql, "skill_trigger_rule_runtime_input_bindings"));
        assertTrue(bindings.contains(
            "'internal_state', 'combat_status', 'event_value', 'prior_action_result'"
        ));
        assertTrue(bindings.contains("constraint uq_skill_trigger_runtime_bindings_parameter"));

        String effectActions = normalize(extractCreateTable(schemaSql, "skill_trigger_rule_effect_actions"));
        assertTrue(effectActions.contains("constraint uq_skill_trigger_effect_action_effect"));

        String prior = normalize(extractCreateTable(schemaSql, "skill_trigger_rule_prior_result_bindings"));
        assertTrue(prior.contains("deferrable initially deferred"));
        assertTrue(prior.contains("constraint fk_skill_trigger_prior_result_bind_source_action"));
        assertTrue(prior.contains("constraint fk_skill_trigger_prior_result_bind_result"));
        assertTrue(prior.contains("output_kind = 'configured_value'"));

        String modifiers = normalize(extractCreateTable(schemaSql, "skill_trigger_rule_result_modifiers"));
        assertTrue(modifiers.contains("constraint ck_skill_trigger_result_modifiers_present")
            || modifiers.contains("fixed_multiplier is not null"));

        for (String index : REVERSE_INDEXES) {
            assertTrue(schemaNormalized.contains("create index " + index), () -> "missing index " + index);
            assertTrue(migrationNormalized.contains("create index " + index), () -> "migration missing index " + index);
        }
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_trigger_rules_list on public.skill_trigger_rules "
                + "(game_id, skill_key, sort_order, rule_key)"
        ));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_trigger_prior_result_bind_source_action "
                + "on public.skill_trigger_rule_prior_result_bindings "
                + "(game_id, skill_key, rule_key, source_action_key, action_key, binding_key)"
        ));
    }

    @Test
    void ownershipCascadeIsLimitedAndCatalogForeignKeysRestrictDelete() {
        String region = schemaRegion();
        for (String constraint : OWNERSHIP_CASCADE_FKS) {
            assertTrue(
                Pattern.compile(
                    "constraint " + Pattern.quote(constraint)
                        + " foreign key \\([^)]+\\) references [\\w.]+ \\([^)]+\\) on delete cascade"
                ).matcher(region).find(),
                () -> "missing ownership ON DELETE CASCADE on " + constraint
            );
        }
        for (String catalogFk : RESTRICT_FKS) {
            assertFalse(
                Pattern.compile("(?is)" + catalogFk + "[^,;]*on delete cascade").matcher(region).find(),
                () -> catalogFk + " must restrict delete"
            );
        }
    }

    @Test
    void schemaAndMigrationShareFrozenCreateTableBodiesAndRejectValueReached() {
        for (String tableName : TARGET_TABLES) {
            String schemaTable = normalize(extractCreateTable(schemaSql, tableName));
            String migrationTable = normalize(extractCreateTable(migrationSql, tableName));
            assertTrue(schemaTable.contains("constraint pk_" + tableName)
                || schemaTable.contains("primary key (game_id, skill_key, rule_key"));
            assertEquals(
                schemaTable.replace("create table public." + tableName, ""),
                migrationTable.replace("create table public." + tableName, ""),
                () -> tableName + " CREATE TABLE body drifted between schema and migration"
            );
            assertFalse(migrationTable.contains("create table if not exists"));
            assertFalse(schemaTable.contains("'value_reached'"));
            assertFalse(migrationTable.contains("'value_reached'"));
            assertNoJsonbArraysOrPayload(schemaTable, tableName);
            assertNoJsonbArraysOrPayload(migrationTable, tableName);
        }
        assertTrue(migrationNormalized.contains("position('''value_reached'''"));
    }

    @Test
    void deferredTriggersCoverEventConditionActionBindingAndProtectionShapes() {
        assertTrue(triggersNormalized.contains(
            "create or replace function public.trg_skill_trigger_rule_complete_shape()"
        ));
        assertTrue(triggersNormalized.contains(
            "constraint trigger trg_skill_trigger_rules_complete_shape after insert or update "
                + "on public.skill_trigger_rules deferrable initially deferred"
        ));
        List<String> triggerDetailTables = extractDetailTriggerTables(triggersSql);
        List<String> migrationDetailTables = extractDetailTriggerTables(migrationSql);
        List<String> currentDetailTables = new ArrayList<>(DETAIL_TRIGGER_TABLES);
        currentDetailTables.add(8, "skill_trigger_rule_damage_events");
        assertEquals(currentDetailTables, triggerDetailTables);
        assertEquals(DETAIL_TRIGGER_TABLES, migrationDetailTables);
        assertTrue(triggersNormalized.contains("create constraint trigger trg_%i_complete_shape"));
        assertTrue(triggersNormalized.contains(
            "execute function public.trg_skill_trigger_rule_complete_shape()"
        ));
        assertTrue(migrationNormalized.contains("create constraint trigger trg_%i_complete_shape"));
        assertTrue(migrationNormalized.contains(
            "execute function public.trg_skill_trigger_rule_complete_shape()"
        ));
        for (String tableName : DETAIL_TRIGGER_TABLES) {
            assertTrue(
                triggerDetailTables.contains(tableName),
                () -> "missing complete_shape table " + tableName
            );
            assertTrue(
                migrationDetailTables.contains(tableName),
                () -> "migration missing complete_shape table " + tableName
            );
        }

        assertTrue(triggersSql.contains("event detail shape invalid at commit"));
        assertTrue(triggersSql.contains("condition detail shape invalid at commit"));
        assertTrue(triggersSql.contains("action detail shape invalid at commit"));
        assertTrue(triggersSql.contains("binding source detail shape invalid at commit"));
        assertTrue(triggersSql.contains("missing action at commit"));
        assertTrue(triggersSql.contains("empty condition group at commit"));
        assertTrue(triggersSql.contains("FAIL_PROCESS must be last at commit"));
        assertTrue(triggersSql.contains("prior action is not EXECUTE_EFFECT at commit"));
        assertTrue(triggersSql.contains("prior action is not earlier at commit"));
        assertTrue(triggersSql.contains("prior source_effect_key mismatch at commit"));
        assertTrue(triggersSql.contains("prior action result is not immediately available at commit"));
        assertTrue(triggersSql.contains("result modifier target invalid at commit"));
        assertTrue(triggersSql.contains("RESULT_AVAILABLE requires no lifecycle at commit"));
        assertTrue(triggersSql.contains("LIFECYCLE_MOMENT PERSISTENT is not allowed at commit"));
        assertTrue(triggersSql.contains("internal state change_kind does not match state type at commit"));
        assertTrue(triggersSql.contains("process limit requires matching PROCESS_MOMENT at commit"));
        assertTrue(triggersSql.contains("SKILL_HIT must not provide use_kind at commit"));
        assertTrue(triggersSql.contains("STEP_TIMEOUT only references timeout-capable steps at commit"));
        assertFalse(triggersSql.contains("VALUE_REACHED"));
        assertTrue(migrationNormalized.contains("position('''value_reached'''"));
        for (String tableName : TARGET_TABLES) {
            assertFalse(
                normalize(extractCreateTable(migrationSql, tableName)).contains("'value_reached'"),
                () -> tableName + " must not accept VALUE_REACHED"
            );
        }
    }

    @Test
    void compatibilityMigrationPreflightsPrerequisitesAndFailsClosedOnPartialOrDrift() {
        String catalogChecks = normalize(stripLineComments(extractDoBlock(migrationSql)));
        assertTrue(catalogChecks.contains("information_schema.tables"));
        assertTrue(catalogChecks.contains("information_schema.columns"));
        assertTrue(catalogChecks.contains("pg_constraint"));
        assertTrue(catalogChecks.contains("pg_get_constraintdef"));
        assertTrue(catalogChecks.contains("pg_indexes"));
        assertTrue(catalogChecks.contains("raise exception"));
        assertTrue(catalogChecks.contains("prerequisite public.skills is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.skill_formulas is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.skill_effects is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.skill_processes is missing or incompatible")
            || catalogChecks.contains("prerequisite public.skill_effect_lifecycles is missing or incompatible"));
        assertTrue(catalogChecks.contains("existing_count not in (0, 26)"));
        assertTrue(catalogChecks.contains("partial target structure exists"));
        assertTrue(catalogChecks.contains("unexpected column set") || catalogChecks.contains("is incompatible: unexpected column set"));
        assertTrue(catalogChecks.contains("missing or wrong pk/fk/check constraint"));
        assertTrue(catalogChecks.contains("missing reverse index") || catalogChecks.contains("missing reverse"));
        assertTrue(catalogChecks.contains("confdeltype <> 'c'") || catalogChecks.contains("confdeltype<>'c'"));
        assertTrue(catalogChecks.contains("confdeferrable") || catalogChecks.contains("condeferrable"));

        int prereqPos = catalogChecks.indexOf("prerequisite public.skills");
        int partialPos = catalogChecks.indexOf("existing_count not in (0, 26)");
        int createPos = catalogChecks.indexOf("create table public.skill_trigger_rules");
        assertTrue(prereqPos >= 0 && prereqPos < partialPos);
        assertTrue(partialPos >= 0 && partialPos < createPos);
        assertFalse(catalogChecks.contains("create table if not exists"));
        assertFalse(catalogChecks.contains("create index if not exists"));
        for (String tableName : TARGET_TABLES) {
            assertTrue(catalogChecks.contains("create table public." + tableName));
        }
    }

    @Test
    void migrationDoesNotReadLegacyDataSeedDeleteOrDropCascade() {
        assertFalse(migrationNormalized.contains("create table if not exists public.skill_trigger_rules"));
        assertFalse(Pattern.compile("(?is)\\bdelete\\s+from\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)drop\\s+\\w+\\s+.*cascade").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\binsert\\s+into\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?i)\\bability\\b").matcher(migrationNormalized).find());
        assertFalse(migrationNormalized.contains("provider"));
        assertFalse(migrationNormalized.contains("combat-data"));
        assertFalse(migrationNormalized.contains("versions:publish"));
        assertFalse(migrationNormalized.contains("wasm"));
        assertFalse(migrationNormalized.contains("种子"));
        for (String tableName : TARGET_TABLES) {
            assertNoJsonbArraysOrPayload(
                normalize(extractCreateTable(migrationSql, tableName)),
                tableName
            );
        }
    }

    @Test
    void mapperInterfaceAndXmlStatementIdsAreOneToOne() throws IOException {
        String mapperJava = readRelative(MAPPER_JAVA_RELATIVE);
        String mapperXml = readRelative(MAPPER_XML_RELATIVE);
        Set<String> javaIds = extractJavaMapperMethods(mapperJava);
        Set<String> xmlIds = extractXmlStatementIds(mapperXml);
        assertFalse(javaIds.isEmpty());
        assertEquals(javaIds, xmlIds, () -> {
            Set<String> missingXml = new LinkedHashSet<>(javaIds);
            missingXml.removeAll(xmlIds);
            Set<String> extraXml = new LinkedHashSet<>(xmlIds);
            extraXml.removeAll(javaIds);
            return "mapper mismatch missingXml=" + missingXml + " extraXml=" + extraXml;
        });
        assertEquals(110, javaIds.size());
    }

    private static String schemaRegion() {
        int start = schemaNormalized.indexOf("create table public.skill_trigger_rules");
        int end = schemaNormalized.indexOf("create table public.images");
        if (end < 0) {
            end = schemaNormalized.length();
        }
        return schemaNormalized.substring(start, end);
    }

    private static List<String> extractDetailTriggerTables(String sql) {
        Matcher matcher = Pattern.compile(
            "(?is)v_details\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]"
        ).matcher(sql);
        List<String> names = new ArrayList<>();
        while (matcher.find()) {
            List<String> candidate = new ArrayList<>();
            Matcher item = Pattern.compile("'([a-z_]+)'").matcher(matcher.group(1));
            while (item.find()) {
                candidate.add(item.group(1));
            }
            boolean stage75CompleteShape = !candidate.isEmpty()
                && candidate.stream().allMatch(name -> name.startsWith("skill_trigger_rule_"));
            if (stage75CompleteShape) {
                names = candidate;
                break;
            }
        }
        assertFalse(names.isEmpty(), "stage 7.5 skill_trigger_rule_* complete_shape v_details array missing");
        return names;
    }

    private static void assertNoJsonbArraysOrPayload(String table, String tableName) {
        assertFalse(table.contains("jsonb"), () -> tableName + " must not use jsonb");
        assertFalse(table.contains("json "), () -> tableName + " must not use json");
        assertFalse(table.contains("integer[]"), () -> tableName + " must not use arrays");
        assertFalse(table.contains("text[]"), () -> tableName + " must not use arrays");
        assertFalse(table.contains("varchar[]"), () -> tableName + " must not use arrays");
        assertFalse(
            Pattern.compile("\\bpayload\\b").matcher(table).find(),
            () -> tableName + " must not use a generic payload column"
        );
    }

    private static Set<String> extractJavaMapperMethods(String java) {
        Set<String> ids = new LinkedHashSet<>();
        Matcher matcher = Pattern.compile(
            "(?m)^\\s+(?:List<[^>]+>|int|long|void|boolean|String|SkillTrigger[A-Za-z]+)[\\s\\S]*?\\s([a-zA-Z][a-zA-Z0-9]*)\\s*\\("
        ).matcher(java);
        while (matcher.find()) {
            String name = matcher.group(1);
            if (!"SkillTriggerRuleMapper".equals(name)) {
                ids.add(name);
            }
        }
        return ids;
    }

    private static Set<String> extractXmlStatementIds(String xml) {
        Set<String> ids = new LinkedHashSet<>();
        Matcher matcher = Pattern.compile(
            "<(?:select|insert|update|delete)\\s+id=\"([a-zA-Z][a-zA-Z0-9]*)\""
        ).matcher(xml);
        while (matcher.find()) {
            ids.add(matcher.group(1));
        }
        return ids;
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
