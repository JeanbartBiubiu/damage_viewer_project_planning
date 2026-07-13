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
 * Static contract for {@code lol_generic_manamune_awe_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericManamuneAweSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_manamune_awe_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3004_manamune_awe",
        "modifier_item_3004_manamune_awe_ad",
        "manamune_awe_bonus_ad");

    private static final List<Integer> REQUIRED_RESERVED = List.of(20110, 20120, 20170);

    private static final String AWE_AD_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.02},"
            + "{\"op\":\"read\",\"path\":\"source.attr.mana.max\"}]}";

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
            "mount idempotent guard must use change_revision > v_locked_current");
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
            "manamune awe seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "manamune awe seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "manamune awe seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "manamune awe seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "manamune awe seed must not CREATE TABLE");
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
            Pattern.compile("(?is)base_value\\s*=\\s*(35|500|15)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not restate or mutate Batch-C static ad=35 / mana=500 / ability_haste=15");
    }

    @Test
    void validatesPrerequisitesWithoutRecreatingBatchC() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_3004");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'item_3004'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight game_entities item_3004");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight attribute_definitions ad");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'mana'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight attribute_definitions mana");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void mountsOnlyAweProviderOnItem3004() {
        assertContains("provider_item_3004_manamune_awe");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3004'\\s*,\\s*'provider_item_3004_manamune_awe'")
                .matcher(sql)
                .find(),
            "must mount awe provider to item_3004");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3004_manamune_awe'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "provider kind must be passive 20120");
        assertFalse(
            Pattern.compile("(?s)'item_(?!3004')\\w+'\\s*,\\s*'provider_item_3004")
                .matcher(sql)
                .find(),
            "must not mount this provider to entities other than item_3004");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once via entity_provider_mounts");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider");
    }

    @Test
    void sourceBoundAdModifierUsesManaMaxMulAddPolicy() {
        assertContains(AWE_AD_FORMULA);
        assertContains("0.02");
        assertContains("source.attr.mana.max");
        assertContains("\"op\":\"mul\"");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3004_manamune_awe_ad'\\s*,\\s*"
                        + "'provider_item_3004_manamune_awe'\\s*,\\s*"
                        + "'manamune_awe_bonus_ad'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'ad'[\\s\\S]*?"
                        + "20170\\s*,\\s*"
                        + "'manamune_awe_bonus_ad'")
                .matcher(sql)
                .find(),
            "modifier must target ad with selector/self 20110 and value_policy/add 20170");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_formulas"),
            "must define exactly one provider_formulas insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define exactly one provider_modifiers insert");
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
    }

    @Test
    void excludesForbiddenCategoriesManaflowMuramanaAndCombatSurfaces() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_state_fields");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.effect_sequences\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write effect_sequences");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.effect_steps\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write effect_steps");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write damage_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.state_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write state_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_match_types\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write listener_match_types");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_effect_sequences\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write listener_effect_sequences");
        assertFalse(
            Pattern.compile("(?i)manaflow|muramana|充能上限|变形").matcher(sqlNoLineComments).find(),
            "must not implement Manaflow / Muramana / transform / max-cap semantics");
        assertFalse(
            Pattern.compile("(?i)\\brng\\b|random|伪随机|概率").matcher(sqlNoLineComments).find(),
            "must not implement random/RNG semantics");
        assertFalse(
            Pattern.compile("(?i)basic_attack_hit|ability_cast|on_hit|resource")
                .matcher(sqlNoLineComments)
                .find(),
            "must not introduce attack / ability / on-hit / resource combat surfaces");
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
