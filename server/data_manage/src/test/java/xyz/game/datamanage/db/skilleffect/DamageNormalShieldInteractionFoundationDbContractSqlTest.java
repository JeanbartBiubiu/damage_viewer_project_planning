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

/** Static SQL contract for Stage 7.6.1 damage and normal-shield interaction storage. */
class DamageNormalShieldInteractionFoundationDbContractSqlTest {

    private static String schema;
    private static String triggers;
    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schema = read("db/game_manage/schema.sql");
        triggers = read("db/game_manage/triggers.sql");
        migration = read(
            "db/game_manage/migrations/compatibility/damage_normal_shield_interaction_foundation_migration.sql"
        );
    }

    @Test
    void schemaStoresDamageCriticalVampShieldAndDamageEventShapesExplicitly() {
        String damage = normalize(extractCreateTable(schema, "skill_effect_damage_details"));
        String critical = normalize(extractCreateTable(schema, "skill_effect_result_critical_policies"));
        String vamp = normalize(extractCreateTable(schema, "skill_effect_result_vamp_rules"));
        String shield = normalize(extractCreateTable(schema, "skill_effect_result_normal_shield_interactions"));
        String event = normalize(extractCreateTable(schema, "skill_trigger_rule_damage_events"));

        assertTrue(damage.contains("delivery_kind varchar(32) not null"));
        assertTrue(damage.contains("origin_kind varchar(32) not null"));
        assertTrue(damage.contains("delivery_kind in ('skill', 'basic_attack')"));
        assertTrue(damage.contains("origin_kind in ('direct', 'reflected')"));
        assertFalse(damage.contains("delivery_kind varchar(32) not null default"));
        assertFalse(damage.contains("origin_kind varchar(32) not null default"));

        assertTrue(critical.contains("primary key (game_id, skill_key, effect_key, result_key)"));
        assertTrue(critical.contains("critical_mode in ('disallowed', 'source_crit_chance', 'forced')"));
        assertTrue(critical.contains("critical_mode <> 'disallowed' or multiplier_formula_key is null"));
        assertTrue(critical.contains("constraint fk_skill_effect_critical_policies_formula"));

        assertTrue(vamp.contains(
            "primary key (game_id, skill_key, effect_key, result_key, vamp_type)"
        ));
        assertTrue(vamp.contains("'life_steal', 'omnivamp', 'physical_vamp', 'spell_vamp'"));
        assertTrue(vamp.contains("basis_output_kind in ('post_defense_damage', 'actual_hp_loss')"));
        assertTrue(vamp.contains("efficiency_formula_key varchar(64) not null"));

        assertTrue(shield.contains("absorbed_damage_type_key varchar(64)"));
        assertTrue(shield.contains("decay_mode varchar(32) not null"));
        assertTrue(shield.contains("decay_mode in ('none', 'linear_to_zero')"));
        assertFalse(shield.contains("decay_mode varchar(32) not null default"));

        assertTrue(event.contains("damage_type_key varchar(64)"));
        assertTrue(event.contains("delivery_kind in ('any', 'skill', 'basic_attack')"));
        assertTrue(event.contains("origin_kind in ('any', 'direct', 'reflected')"));
    }

    @Test
    void deferredShapeFunctionsCoverAllNewRowsAndLinearShieldLifecycle() {
        String normalized = normalize(triggers);
        assertTrue(normalized.contains("v_critical_count int"));
        assertTrue(normalized.contains("v_vamp_count int"));
        assertTrue(normalized.contains("v_normal_shield_count int"));
        assertTrue(normalized.contains("or v_critical_count <> 1"));
        assertTrue(normalized.contains("or v_vamp_count < 0 or v_vamp_count > 4"));
        assertTrue(normalized.contains("or v_normal_shield_count <> 1"));
        assertTrue(triggers.contains("'skill_effect_result_critical_policies'"));
        assertTrue(triggers.contains("'skill_effect_result_vamp_rules'"));
        assertTrue(triggers.contains("'skill_effect_result_normal_shield_interactions'"));

        assertTrue(normalized.contains("v_normal_shield_decay_mode = 'linear_to_zero'"));
        assertTrue(normalized.contains("v_duration_formula_key is null"));
        assertTrue(normalized.contains("v_expiry_mode is distinct from 'all_at_once'"));
        assertTrue(normalized.contains("v_stack_value_mode is distinct from 'shared'"));

        assertTrue(normalized.contains("v_damage_event_count int"));
        assertTrue(normalized.contains("case when v_damage_event_count = 1"));
        assertTrue(triggers.contains("'skill_trigger_rule_damage_events'"));
    }

    @Test
    void migrationIsAtomicFailClosedBackfillsDefaultsAndReinstallsCurrentTriggers() {
        String normalized = normalize(migration);
        assertTrue(normalized.contains("begin;"));
        assertTrue(normalized.endsWith("commit;"));
        assertTrue(normalized.contains("structure is partial"));
        assertTrue(normalized.contains(
            "existing normal_shield results must be repaired through the effect api before migration"
        ));
        assertTrue(normalized.contains("add column if not exists delivery_kind varchar(32)"));
        assertTrue(normalized.contains("set delivery_kind = 'skill'"));
        assertTrue(normalized.contains("set origin_kind = 'direct'"));
        assertTrue(normalized.contains("insert into public.skill_effect_result_critical_policies"));
        assertTrue(normalized.contains("'disallowed', null"));
        assertTrue(normalized.contains("insert into public.skill_effect_result_normal_shield_interactions"));
        assertTrue(normalized.contains("null, 'none'"));
        assertTrue(normalized.contains("insert into public.skill_trigger_rule_damage_events"));
        assertTrue(normalized.contains("null, 'any', 'any'"));
        assertTrue(normalized.contains("where not exists"));
        assertTrue(normalized.contains("create or replace function public.trg_skill_effect_result_complete_shape()"));
        assertTrue(normalized.contains("create or replace function public.trg_skill_trigger_rule_complete_shape()"));
        assertTrue(normalized.contains("damage and normal shield interaction shape triggers are incomplete"));
        assertTrue(normalized.contains("tr.tgname = required.trigger_name::name"));
        assertFalse(Pattern.compile("(?is)\\bdelete\\s+from\\b").matcher(normalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(normalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+[^;]*\\bcascade\\b").matcher(normalized).find());
    }

    private static String extractCreateTable(String sql, String tableName) {
        var matcher = Pattern.compile(
            "(?is)CREATE\\s+TABLE\\s+public\\." + Pattern.quote(tableName) + "\\s*\\((.*?)\\n\\);"
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
