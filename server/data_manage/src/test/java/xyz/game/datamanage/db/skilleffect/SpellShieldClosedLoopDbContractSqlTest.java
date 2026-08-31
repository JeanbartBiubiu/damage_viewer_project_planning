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

/** Static SQL contract for Stage 7.6.3 spell-shield authoring. */
class SpellShieldClosedLoopDbContractSqlTest {

    private static String schema;
    private static String triggers;
    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schema = read("db/game_manage/schema.sql");
        triggers = read("db/game_manage/triggers.sql");
        migration = read(
            "db/game_manage/migrations/compatibility/spell_shield_closed_loop_migration.sql"
        );
    }

    @Test
    void schemaStoresBlockPolicyAndBlockedEventAsRelations() {
        String policy = normalize(extractCreateTable(
            schema,
            "skill_effect_result_spell_shield_policies"
        ));
        String event = normalize(extractCreateTable(
            schema,
            "skill_trigger_rule_spell_shield_blocked_events"
        ));

        assertTrue(policy.contains("block_scope varchar(24) not null"));
        assertTrue(policy.contains("'skill', 'effect', 'damage_instance', 'result'"));
        assertTrue(policy.contains("on delete cascade"));
        assertTrue(event.contains("shield_effect_key varchar(64) not null"));
        assertTrue(event.contains("on delete restrict"));
        assertFalse((policy + event).contains("json"));

        String normalizedSchema = normalize(schema);
        assertTrue(normalizedSchema.contains("'damage_immunity', 'health_floor', 'spell_shield'"));
        assertTrue(normalizedSchema.contains("'process_cancel_requested', 'spell_shield_blocked'"));
    }

    @Test
    void deferredFunctionsProtectResultPolicyEventAndReverseReference() {
        String normalized = normalize(triggers);
        assertTrue(normalized.contains("v_spell_shield_policy_count int"));
        assertTrue(normalized.contains("v_result_type = 'spell_shield'"));
        assertTrue(normalized.contains("v_spell_shield_event_count int"));
        assertTrue(normalized.contains("v_event_type = 'spell_shield_blocked'"));
        assertTrue(normalized.contains("referenced spell shield result missing"));
        assertTrue(triggers.contains("'skill_effect_result_spell_shield_policies'"));
        assertTrue(triggers.contains("'skill_trigger_rule_spell_shield_blocked_events'"));
    }

    @Test
    void migrationIsAtomicFailClosedIdempotentAndWritesNoBusinessRows() {
        String normalized = normalize(migration);
        assertTrue(normalized.startsWith("begin;"));
        assertTrue(normalized.endsWith("commit;"));
        assertTrue(normalized.contains("v_existing_count not in (0, 2)"));
        assertTrue(normalized.contains("structure is partial"));
        assertTrue(normalized.contains("constraint drifted"));
        assertTrue(normalized.contains(
            "create table if not exists public.skill_effect_result_spell_shield_policies"
        ));
        assertTrue(normalized.contains(
            "create table if not exists public.skill_trigger_rule_spell_shield_blocked_events"
        ));
        assertTrue(normalized.contains("drop constraint if exists ck_skill_effect_results_type"));
        assertTrue(normalized.contains("drop constraint if exists ck_skill_trigger_rules_event_type"));
        assertFalse(Pattern.compile(
            "(?is)insert\\s+into\\s+public\\.(?!skill_effect_|skill_trigger_)"
        ).matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+[^;]*\\bcascade\\b").matcher(migration).find());
    }

    private static String extractCreateTable(String sql, String tableName) {
        var matcher = Pattern.compile(
            "(?is)CREATE\\s+TABLE\\s+public\\." + Pattern.quote(tableName)
                + "\\s*\\((.*?)\\n\\);"
        ).matcher(sql);
        if (!matcher.find()) {
            throw new AssertionError("missing CREATE TABLE public." + tableName);
        }
        return matcher.group();
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
