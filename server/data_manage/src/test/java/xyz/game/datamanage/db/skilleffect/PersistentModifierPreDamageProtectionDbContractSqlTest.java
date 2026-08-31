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

/** Static SQL contract for Stage 7.6.2 persistent modifiers and pre-damage protection. */
class PersistentModifierPreDamageProtectionDbContractSqlTest {

    private static String schema;
    private static String triggers;
    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schema = read("db/game_manage/schema.sql");
        triggers = read("db/game_manage/triggers.sql");
        migration = read(
            "db/game_manage/migrations/compatibility/"
                + "persistent_modifier_pre_damage_protection_migration.sql"
        );
    }

    @Test
    void schemaStoresFourFixedResultDetailsWithoutJsonOrFutureMechanisms() {
        String damageModifier = normalize(extractCreateTable(
            schema,
            "skill_effect_damage_modifier_details"
        ));
        String healingModifier = normalize(extractCreateTable(
            schema,
            "skill_effect_healing_modifier_details"
        ));
        String immunity = normalize(extractCreateTable(
            schema,
            "skill_effect_damage_immunity_details"
        ));
        String healthFloor = normalize(extractCreateTable(
            schema,
            "skill_effect_health_floor_details"
        ));

        assertTrue(damageModifier.contains("direction in ('dealt', 'taken')"));
        assertTrue(damageModifier.contains("operation in ('increase', 'decrease')"));
        assertTrue(damageModifier.contains("'any', 'skill', 'basic_attack'"));
        assertTrue(damageModifier.contains("'any', 'critical_only', 'non_critical_only'"));
        assertTrue(healingModifier.contains("direction in ('done', 'received')"));
        assertTrue(healingModifier.contains("healing_kind in ('any', 'direct', 'vamp')"));
        assertTrue(immunity.contains("damage_type_key varchar(64)"));
        assertTrue(healthFloor.contains("attribute_key varchar(64) not null"));
        assertTrue(healthFloor.contains("constraint fk_skill_effect_health_floor_attribute"));
        assertFalse((damageModifier + healingModifier + immunity + healthFloor).contains("json"));

        String normalizedSchema = normalize(schema);
        assertTrue(normalizedSchema.contains("'damage_modifier', 'healing_modifier'"));
        assertTrue(normalizedSchema.contains("'damage_immunity', 'health_floor'"));
        assertTrue(normalizedSchema.contains("'damage_pending', 'damage_dealt', 'damage_taken'"));
        assertTrue(normalizedSchema.contains("'raw_damage', 'post_defense_damage'"));
        assertTrue(normalizedSchema.contains("'health_before', 'projected_health_after'"));
    }

    @Test
    void deferredFunctionsCoverNewResultRowsLifecycleAndPendingDamageEvent() {
        String normalized = normalize(triggers);
        assertTrue(normalized.contains("v_damage_modifier_count int"));
        assertTrue(normalized.contains("v_healing_modifier_count int"));
        assertTrue(normalized.contains("v_damage_immunity_count int"));
        assertTrue(normalized.contains("v_health_floor_count int"));
        assertTrue(triggers.contains("'skill_effect_damage_modifier_details'"));
        assertTrue(triggers.contains("'skill_effect_healing_modifier_details'"));
        assertTrue(triggers.contains("'skill_effect_damage_immunity_details'"));
        assertTrue(triggers.contains("'skill_effect_health_floor_details'"));
        assertTrue(normalized.contains("v_result_type = 'damage_modifier'"));
        assertTrue(normalized.contains("v_result_type = 'damage_immunity'"));
        assertTrue(normalized.contains("v_result.result_type = 'health_floor'"));
        assertTrue(normalized.contains(
            "when v_event_type in ('damage_pending', 'damage_dealt', 'damage_taken')"
        ));
    }

    @Test
    void migrationIsAtomicFailClosedIdempotentAndWritesNoBusinessRows() {
        String normalized = normalize(migration);
        assertTrue(normalized.startsWith("begin;"));
        assertTrue(normalized.endsWith("commit;"));
        assertTrue(normalized.contains("v_existing_count not in (0, 4)"));
        assertTrue(normalized.contains("structure is partial"));
        assertTrue(normalized.contains("constraint drifted"));
        assertTrue(normalized.contains(
            "create table if not exists public.skill_effect_damage_modifier_details"
        ));
        assertTrue(normalized.contains(
            "create table if not exists public.skill_effect_health_floor_details"
        ));
        assertTrue(normalized.contains("drop constraint if exists ck_skill_effect_results_type"));
        assertTrue(normalized.contains("drop constraint if exists ck_skill_trigger_rules_event_type"));
        assertTrue(normalized.contains("'raw_damage', 'post_defense_damage'"));
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
