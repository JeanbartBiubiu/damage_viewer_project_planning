package xyz.game.datamanage.db.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;

/** 验证当前根 JSON 的真实 MyBatis 映射；另保留历史迁移的安全边界，不冻结已移除的细表布局。 */
class ConditionEventDynamicInputManagementDbContractSqlTest {
    private static final String RESOURCE = "mapper/skilltrigger/SkillTriggerRuleMapper.xml";
    private static final String NAMESPACE = SkillTriggerRuleMapper.class.getName() + ".";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/condition_event_dynamic_input_management_migration.sql";

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

    private static String migrationSql;
    private static String migrationNormalized;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        migrationSql = readRelative(MIGRATION_RELATIVE);
        migrationNormalized = normalize(stripLineComments(migrationSql));
    }

    @Test
    void buildsRootJsonWriteMappingsWithAllParametersAndNoUnmappedInterfaceMethods() throws Exception {
        Configuration configuration = new Configuration();
        String shared = "mapper/authoring/AuthoringReadModel.xml";
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(shared)) {
            new XMLMapperBuilder(input, configuration, shared, configuration.getSqlFragments()).parse();
        }
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(RESOURCE)) {
            new XMLMapperBuilder(input, configuration, RESOURCE, configuration.getSqlFragments()).parse();
        }
        Set<String> mapped = configuration.getMappedStatementNames().stream()
            .filter(name -> name.startsWith(NAMESPACE)).map(name -> name.substring(NAMESPACE.length()))
            .collect(Collectors.toSet());
        assertEquals(Arrays.stream(SkillTriggerRuleMapper.class.getDeclaredMethods()).map(method -> method.getName())
            .collect(Collectors.toSet()), mapped);

        Map<String, Object> parameters = new HashMap<>();
        parameters.put("gameId", "game");
        parameters.put("skillKey", "skill");
        parameters.put("ruleKey", "rule");
        parameters.put("name", "规则");
        parameters.put("description", null);
        parameters.put("sortOrder", 0);
        parameters.put("eventType", "BASIC_ATTACK_HIT");
        parameters.put("eventSourceJson", "{\"eventType\":\"BASIC_ATTACK_HIT\",\"detail\":{}}");
        parameters.put("conditionGroupsJson", "[]");
        parameters.put("actionsJson", "[]");
        parameters.put("limitsJson", "{\"perTargetCooldown\":null,\"maxTriggersPerProcess\":null}");
        for (String id : Set.of("insertRule", "updateRule")) {
            var bound = configuration.getMappedStatement(NAMESPACE + id).getBoundSql(parameters);
            assertEquals(parameters.keySet(), bound.getParameterMappings().stream()
                .map(parameter -> parameter.getProperty()).collect(Collectors.toSet()));
            assertTrue(bound.getSql().contains("public.skill_trigger_rules"));
            assertEquals(4, bound.getSql().split("AS jsonb", -1).length - 1);
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
