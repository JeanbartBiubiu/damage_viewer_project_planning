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
class PersistentModifierPreDamageProtectionDbContractSqlTest {

    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        migration = read(
            "db/game_manage/migrations/compatibility/"
                + "persistent_modifier_pre_damage_protection_migration.sql"
        );
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
