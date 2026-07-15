package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_wits_end_fray_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericWitsEndFraySeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_wits_end_fray_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3091_wits_end_fray",
        "listener_item_3091_wits_end_fray",
        "sequence_item_3091_wits_end_fray",
        "step_item_3091_wits_end_fray_damage",
        "wits_end_fray_on_hit_damage",
        "wits_end_fray_on_basic_attack_hit",
        "wits_end_fray_on_hit");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20150, 20170, 20181, 20211, 20212, 20221);

    private static String sql;
    private static String sqlNoLineComments;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
    }

    @Test
    void usesTransactionLockCandidateAndIdempotentRevisionGuard() {
        assertTrue(sql.trim().startsWith("BEGIN;") || sql.contains("\nBEGIN;\n"), "must BEGIN");
        assertTrue(
            sql.trim().endsWith("COMMIT;")
                || sql.contains("\nCOMMIT;\n")
                || sql.endsWith("COMMIT;\n"),
            "must COMMIT");
        assertContains("DO $$");
        assertContains("ensure_game_partitions");
        assertContains("FOR UPDATE");
        assertContains("game_data_state");
        assertTrue(
            Pattern.compile("v_candidate\\s*:=\\s*v_locked_current\\s*\\+\\s*1")
                .matcher(sqlNoLineComments)
                .find(),
            "candidate must be locked current_revision + 1");
        assertTrue(
            Pattern.compile("(?is)IF\\s+v_changed\\s+THEN").matcher(sqlNoLineComments).find(),
            "must guard current_revision bump with v_changed");
        assertTrue(
            Pattern.compile("current_revision\\s*=\\s*v_candidate")
                .matcher(sqlNoLineComments)
                .find(),
            "must advance current_revision to candidate when changed");
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
        assertTrue(
            Pattern.compile("change_revision\\s*>\\s*v_locked_current")
                .matcher(sqlNoLineComments)
                .find(),
            "match/link/mount idempotent guards must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoLineComments).find(),
            "seed must not call publish API markers");
        assertFalse(
            Pattern.compile("(?is)\\bcurrent_revision\\s*=\\s*\\d+")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not hardcode revision numbers");
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "wits end fray seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "wits end fray seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "wits end fray seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "wits end fray seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "wits end fray seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoLineComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoLineComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.(heroes|items|skills)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write legacy heroes/items/skills tables");
    }

    @Test
    void doesNotWriteBatchCStaticEntityOrAttributeRows() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entities\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write game_entities (Batch-C static rows stay untouched)");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write entity_attribute_values (Batch-C static attrs stay untouched)");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entity_attributes\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write game_entity_attributes");
        assertFalse(
            Pattern.compile("(?is)UPDATE\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not UPDATE entity_attribute_values");
        assertFalse(
            Pattern.compile("(?is)'attack_speed'|'magic_resist'|'tenacity'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not mutate Batch-C static attack_speed / magic_resist / tenacity");
    }

    @Test
    void validatesPrerequisitesWithoutRecreatingBatchC() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_3091");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'item_3091'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight game_entities item_3091");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void mountsOnlyFrayProviderOnItem3091() {
        assertContains("provider_item_3091_wits_end_fray");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3091'\\s*,\\s*'provider_item_3091_wits_end_fray'")
                .matcher(sql)
                .find(),
            "must mount fray provider to item_3091");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3091_wits_end_fray'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "provider kind must be passive 20120");
        assertFalse(
            Pattern.compile("(?s)'item_(?!3091')\\w+'\\s*,\\s*'provider_item_3091")
                .matcher(sql)
                .find(),
            "must not mount this provider to entities other than item_3091");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once via entity_provider_mounts");
    }

    @Test
    void singleSourceOwnerBasicAttackHitListenerWithConstMagicCopyableDamage() {
        assertContains("listener_item_3091_wits_end_fray");
        assertContains("sequence_item_3091_wits_end_fray");
        assertContains("{\"op\":\"const\",\"value\":45}");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3091_wits_end_fray'[\\s\\S]{0,200}"
                        + "20211[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "listener must be basic_attack_hit 20211 with max_triggers_per_event=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3091_wits_end_fray'\\s*,\\s*"
                        + "20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3091_wits_end_fray'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3091_wits_end_fray_damage'\\s*,\\s*"
                        + "'sequence_item_3091_wits_end_fray'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "exactly one opponent-target damage step order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3091_wits_end_fray_damage'\\s*,\\s*"
                        + "'wits_end_fray_on_hit_damage'\\s*,\\s*"
                        + "20221\\s*,\\s*20170\\s*,\\s*"
                        + "true")
                .matcher(sql)
                .find(),
            "damage detail must be magic 20221 / add 20170 / copyable_on_hit true");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_steps"),
            "must define exactly one effect_steps insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must define exactly one damage_effect_details insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_listeners"),
            "must define exactly one provider listener");
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
    }

    @Test
    void excludesHealingLifestealEnergizedSpellbladeAndRng() {
        assertFalse(
            Pattern.compile(
                    "(?i)lifesteal|life_steal|OnHitAppliesLifeSteal|吸血|heal|healing|治疗")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement healing/lifesteal from metadata tag");
        assertFalse(
            Pattern.compile("(?i)energized|静电|statikk").matcher(sqlNoLineComments).find(),
            "must not implement Energized");
        assertFalse(
            Pattern.compile("(?i)spellblade|三相|lich_bane|essence_reaver")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement Spellblade");
        assertFalse(
            Pattern.compile("(?i)\\brng\\b|random|伪随机|概率").matcher(sqlNoLineComments).find(),
            "must not implement random/RNG semantics");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "Fray scope must not introduce provider state fields");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "Fray scope must not introduce provider modifiers");
    }

    private static void assertEquals(int expected, int actual, String message) {
        org.junit.jupiter.api.Assertions.assertEquals(expected, actual, message);
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int idx = haystack.indexOf(needle, from);
            if (idx < 0) {
                return count;
            }
            count++;
            from = idx + needle.length();
        }
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "seed sql must contain: " + needle);
    }

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        List<Path> candidates = List.of(
            cwd.resolve("../../" + relative).normalize(),
            cwd.resolve("../" + relative).normalize(),
            cwd.resolve(relative).normalize());
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        fail("unable to resolve " + relative + " from cwd=" + cwd);
        return null;
    }
}
