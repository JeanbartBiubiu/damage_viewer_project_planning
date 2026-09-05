package xyz.game.datamanage.db.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;

/** Static SQL contract for Stage 7.6.4 execute / hit / attack linkage. */
class ExecuteHitAttackLinkageDbContractSqlTest {

    private static String schema;
    private static String triggers;
    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schema = read("db/game_manage/schema.sql");
        triggers = read("db/game_manage/triggers.sql");
        migration = read(
            "db/game_manage/migrations/compatibility/execute_hit_attack_linkage_migration.sql"
        );
    }

    @Test
    void schemaStoresExecuteDetailAndSharedLinkEventWithoutEmptyResultTables() {
        String execute = normalize(extractCreateTable(schema, "skill_effect_execute_details"));
        String link = normalize(extractCreateTable(schema, "skill_trigger_rule_link_events"));

        assertTrue(execute.contains("primary key (game_id, skill_key, effect_key, result_key)"));
        assertTrue(execute.contains("constraint fk_skill_effect_execute_details_result"));
        assertTrue(execute.contains("on delete cascade"));
        assertTrue(execute.contains("constraint fk_skill_effect_execute_details_attribute"));
        assertTrue(execute.contains("on delete restrict"));
        assertTrue(normalize(schema).contains(
            "create index ix_skill_effect_execute_details_attribute"
        ));

        assertTrue(link.contains("primary key (game_id, skill_key, rule_key)"));
        assertTrue(link.contains("source_skill_key varchar(64)"));
        assertFalse(link.contains("source_skill_key varchar(64) not null"));
        assertTrue(link.contains("constraint fk_skill_trigger_link_events_rule"));
        assertTrue(link.contains("on delete cascade"));
        assertTrue(link.contains("constraint fk_skill_trigger_link_events_source_skill"));
        assertTrue(link.contains("match simple"));
        assertTrue(link.contains("on delete restrict"));
        assertTrue(normalize(schema).contains(
            "create index ix_skill_trigger_link_events_source_skill"
        ));
        assertFalse((execute + link).contains("json"));

        String normalizedSchema = normalize(schema);
        assertFalse(normalizedSchema.contains("create table public.skill_effect_hit_link"));
        assertFalse(normalizedSchema.contains("create table public.skill_effect_attack_link"));
        assertTrue(normalizedSchema.contains("result_type varchar(32) not null"));
        assertTrue(normalizedSchema.contains("'spell_shield', 'execute', 'hit_link_application', 'attack_link_application'"));
        assertTrue(normalizedSchema.contains("'spell_shield_blocked', 'hit_link_applied', 'attack_link_applied'"));
        String priorBindings = normalize(extractCreateTable(schema, "skill_trigger_rule_prior_result_bindings"));
        assertTrue(priorBindings.contains(
            "constraint ck_skill_trigger_prior_result_bind_output check (output_kind in ( "
                + "'configured_value', 'raw_damage', 'post_defense_damage', "
                + "'shield_absorbed', 'actual_hp_loss', 'actual_healing', "
                + "'blocked', 'immune', 'status_applied', 'killed' ))"
        ));
        assertTrue(priorBindings.contains("'configured_value'"));
        assertTrue(normalizedSchema.contains("'application_snapshot', 'moment_evaluation'"));
        assertTrue(normalizedSchema.contains("create table public.modifier_zones"));
        assertFalse(normalizedSchema.contains("create table public.skill_effect_cooldown_change_targets"));
        assertTrue(normalize(migration).contains("skill_effect_cooldown_change_targets"));
        assertEquals(21, SkillTriggerEventType.values().length);
    }

    @Test
    void deferredFunctionsCoverSixteenResultsTwentyOneEventsAndSpellShieldWhitelist() {
        String normalized = normalize(triggers);
        assertTrue(normalized.contains("v_result_type varchar(32)"));
        assertTrue(normalized.contains("v_execute_count int"));
        assertTrue(normalized.contains("v_link_event_count int"));
        assertTrue(normalized.contains("v_event_type varchar(32)"));
        assertTrue(normalized.contains("v_result_type = 'execute'"));
        assertTrue(normalized.contains("v_result_type in ('hit_link_application', 'attack_link_application')"));
        assertTrue(normalized.contains("v_event_type in ('hit_link_applied', 'attack_link_applied')"));
        assertTrue(normalized.contains("'execute', 'hit_link_application', 'attack_link_application'"));
        assertTrue(normalized.contains("v_spell_shield_block_scope = 'damage_instance'"));
        assertTrue(normalized.contains("and v_result_type <> 'damage'"));
        assertTrue(triggers.contains("'skill_effect_execute_details'"));
        assertTrue(triggers.contains("'skill_trigger_rule_link_events'"));

        List<String> resultDetails = extractNamedArray(
            triggers,
            name -> name.startsWith("skill_effect_") && !name.equals("skill_effects")
        );
        assertEquals(20, resultDetails.size());
        assertTrue(resultDetails.contains("skill_effect_execute_details"));

        List<String> triggerRuleTables = extractNamedArray(
            triggers,
            name -> name.startsWith("skill_trigger_rule_")
        );
        List<String> eventDetails = triggerRuleTables.stream()
            .filter(name -> name.endsWith("_events"))
            .toList();
        assertEquals(11, eventDetails.size());
        assertTrue(eventDetails.contains("skill_trigger_rule_link_events"));
    }

    @Test
    void migrationIsAtomicFailClosedIdempotentAndReplacesShapeFunctions() {
        String normalized = normalize(migration);
        assertTrue(normalized.startsWith("-- 阶段 7.6.4"));
        assertTrue(normalized.contains("begin;"));
        assertTrue(normalized.endsWith("commit;"));
        assertEquals(1, count(normalized, "begin;"));
        assertEquals(1, count(normalized, "commit;"));
        assertTrue(normalized.contains("v_existing_count not in (0, 2)"));
        assertTrue(normalized.contains("structure is partial"));
        assertTrue(normalized.contains("column width drifted"));
        assertTrue(normalized.contains("constraint drifted"));
        assertTrue(normalized.contains("function drifted"));
        assertTrue(normalized.contains(
            "create table if not exists public.skill_effect_execute_details"
        ));
        assertTrue(normalized.contains(
            "create table if not exists public.skill_trigger_rule_link_events"
        ));
        assertTrue(normalized.contains("alter column result_type type varchar(32)"));
        assertTrue(normalized.contains("drop constraint if exists ck_skill_effect_results_type"));
        assertTrue(normalized.contains("drop constraint if exists ck_skill_trigger_rules_event_type"));
        assertTrue(normalized.contains(
            "create or replace function public.trg_skill_effect_result_complete_shape()"
        ));
        assertTrue(normalized.contains(
            "create or replace function public.trg_skill_trigger_rule_complete_shape()"
        ));
        assertTrue(migration.contains("'skill_effect_execute_details'"));
        assertTrue(migration.contains("'skill_trigger_rule_link_events'"));
        assertTrue(normalized.contains("v_result_type varchar(32)"));
        assertTrue(normalized.contains("v_execute_count int"));
        assertTrue(normalized.contains("v_link_event_count int"));
        assertTrue(normalized.contains("output_kind = 'configured_value'")
            || !normalized.contains("output_kind"));
        assertFalse(normalized.contains("insert into public."));
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+[^;]*\\bcascade\\b").matcher(migration).find());
        assertFalse(normalized.contains("jsonb"));
        assertFalse(normalized.contains("link_index"));
        assertFalse(normalized.contains("link_count"));
        assertFalse(normalized.contains("killed"));

        String schemaExecute = normalize(extractCreateTable(schema, "skill_effect_execute_details"))
            .replace("create table public.skill_effect_execute_details", "");
        String migrationExecute = normalize(extractCreateTable(migration, "skill_effect_execute_details"))
            .replace("create table if not exists public.skill_effect_execute_details", "");
        assertEquals(schemaExecute, migrationExecute);

        String schemaLink = normalize(extractCreateTable(schema, "skill_trigger_rule_link_events"));
        String migrationLink = normalize(extractCreateTable(migration, "skill_trigger_rule_link_events"));
        assertEquals(
            schemaLink.replace("create table public.skill_trigger_rule_link_events", ""),
            migrationLink.replace("create table if not exists public.skill_trigger_rule_link_events", "")
        );
    }

    @Test
    void mapperCountsLinkAndSkillSourceReferencesExcludingSelf() throws IOException {
        String mapperXml = read(
            "server/data_manage/src/main/resources/mapper/skilltrigger/SkillTriggerRuleMapper.xml"
        );
        String select = mapperXml.substring(
            mapperXml.indexOf("<select id=\"countSourceSkillReferences\""),
            mapperXml.indexOf("</select>", mapperXml.indexOf("<select id=\"countSourceSkillReferences\""))
        );
        assertTrue(select.contains("skill_trigger_rule_skill_events"));
        assertTrue(select.contains("skill_trigger_rule_link_events"));
        assertEquals(2, select.split("skill_key &lt;&gt; #\\{sourceSkillKey\\}", -1).length - 1);
    }

    private static List<String> extractNamedArray(String sql, java.util.function.Predicate<String> matcher) {
        Matcher block = Pattern.compile(
            "(?is)v_details\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]"
        ).matcher(sql);
        while (block.find()) {
            List<String> names = new ArrayList<>();
            Matcher item = Pattern.compile("'([a-z0-9_]+)'").matcher(block.group(1));
            while (item.find()) {
                names.add(item.group(1));
            }
            if (!names.isEmpty() && names.stream().allMatch(matcher)) {
                return names;
            }
        }
        throw new AssertionError("matching v_details array missing");
    }

    private static List<String> extractCreateTableNames(String sql) {
        Matcher matcher = Pattern.compile("(?m)^CREATE TABLE public\\.([a-z0-9_]+)").matcher(sql);
        List<String> names = new ArrayList<>();
        while (matcher.find()) {
            names.add(matcher.group(1));
        }
        return names;
    }

    private static String extractCreateTable(String sql, String tableName) {
        var matcher = Pattern.compile(
            "(?is)CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\." + Pattern.quote(tableName)
                + "\\s*\\((.*?)\\n\\);"
        ).matcher(sql);
        if (!matcher.find()) {
            throw new AssertionError("missing CREATE TABLE public." + tableName);
        }
        return matcher.group();
    }

    private static int count(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int at = haystack.indexOf(needle, from);
            if (at < 0) {
                return count;
            }
            count++;
            from = at + needle.length();
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
