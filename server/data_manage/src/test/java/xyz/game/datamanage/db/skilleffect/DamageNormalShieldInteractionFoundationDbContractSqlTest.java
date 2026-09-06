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

/** 历史兼容迁移的安全边界；当前聚合业务行为由 SkillEffectServiceTest 覆盖。 */
class DamageNormalShieldInteractionFoundationDbContractSqlTest {

    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        migration = read(
            "db/game_manage/migrations/compatibility/damage_normal_shield_interaction_foundation_migration.sql"
        );
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
