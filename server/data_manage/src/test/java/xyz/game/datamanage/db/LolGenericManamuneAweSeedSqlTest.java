package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_manamune_awe_seed.sql}.
 * Awe + Manaflow direct-max-state Phase-A (FROZEN_PLAN_REV
 * manamune-manaflow-direct-max-state-phase-a-v2).
 * Wiki Module:ItemData/data revid 4030984 / content SHA
 * e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d.
 * Completed boundary: always-on mana.resolved += 360; Awe reads
 * source.attr.mana.resolved (not .max / not resource). Does not connect
 * to a live database.
 */
class LolGenericManamuneAweSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_manamune_awe_seed.sql";

    private static final String AWE_PROVIDER = "provider_item_3004_manamune_awe";
    private static final String AWE_MODIFIER = "modifier_item_3004_manamune_awe_ad";
    private static final String AWE_FORMULA_KEY = "manamune_awe_bonus_ad";

    private static final String MANAFLOW_PROVIDER =
        "provider_item_3004_manamune_manaflow_max_state";
    private static final String MANAFLOW_MODIFIER =
        "modifier_item_3004_manamune_manaflow_max_state_mana";
    private static final String MANAFLOW_FORMULA_KEY =
        "manamune_manaflow_max_state_mana";

    private static final List<String> STABLE_IDS = List.of(
        AWE_PROVIDER,
        AWE_MODIFIER,
        AWE_FORMULA_KEY,
        MANAFLOW_PROVIDER,
        MANAFLOW_MODIFIER,
        MANAFLOW_FORMULA_KEY);

    private static final List<Integer> REQUIRED_RESERVED = List.of(20110, 20120, 20170);

    private static final String AWE_AD_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.02},"
            + "{\"op\":\"read\",\"path\":\"source.attr.mana.resolved\"}]}";

    private static final String MANAFLOW_MANA_FORMULA =
        "{\"op\":\"const\",\"value\":360}";

    private static final String WIKI_REVID = "4030984";
    private static final String WIKI_SHA =
        "e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d";

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
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, "change_revision > v_locked_current"),
            "both mounts must use change_revision > v_locked_current guard");
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
            "manamune seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "manamune seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "manamune seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "manamune seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "manamune seed must not CREATE TABLE");
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
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.attribute_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write attribute_definitions (check-only prerequisite)");
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
        assertContains(WIKI_REVID);
        assertContains(WIKI_SHA);
        assertTrue(
            sql.contains("direct-max-state") || sql.contains("direct max-state"),
            "must identify Manaflow direct-max-state Phase-A boundary");
        assertTrue(
            sql.contains("two-pass") || sql.contains("two pass"),
            "must state two-pass runtime dependency caveat");
    }

    @Test
    void mountsExactlyTwoIsolatedProvidersOnItem3004Only() {
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3004'\\s*,\\s*'" + AWE_PROVIDER + "'")
                .matcher(sql)
                .find(),
            "must mount awe provider to item_3004");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3004'\\s*,\\s*'" + MANAFLOW_PROVIDER + "'")
                .matcher(sql)
                .find(),
            "must mount manaflow max-state provider to item_3004");
        assertTrue(
            Pattern.compile(
                    "(?s)'" + AWE_PROVIDER + "'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "awe provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'" + MANAFLOW_PROVIDER + "'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "manaflow provider kind must be passive 20120");
        assertFalse(
            Pattern.compile("(?s)'item_(?!3004')\\w+'\\s*,\\s*'provider_item_3004")
                .matcher(sql)
                .find(),
            "must not mount these providers to entities other than item_3004");
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly two providers via entity_provider_mounts");
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly two providers");
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_formulas"),
            "must define exactly two provider_formulas inserts");
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define exactly two provider_modifiers inserts");
        assertTrue(
            Pattern.compile(
                    "(?s)'" + AWE_PROVIDER + "'\\s*,\\s*'" + AWE_FORMULA_KEY + "'")
                .matcher(sql)
                .find(),
            "awe formula must bind only to awe provider");
        assertTrue(
            Pattern.compile(
                    "(?s)'" + MANAFLOW_PROVIDER + "'\\s*,\\s*'" + MANAFLOW_FORMULA_KEY + "'")
                .matcher(sql)
                .find(),
            "manaflow formula must bind only to manaflow provider");
        assertFalse(
            sqlNoLineComments.contains(
                "'" + AWE_PROVIDER + "', '" + MANAFLOW_FORMULA_KEY + "'"),
            "awe provider must not bind manaflow formula key");
        assertFalse(
            sqlNoLineComments.contains(
                "'" + MANAFLOW_PROVIDER + "', '" + AWE_FORMULA_KEY + "'"),
            "manaflow provider must not bind awe formula key");
        assertFalse(
            Pattern.compile(
                    "(?s)'" + AWE_MODIFIER + "'[\\s\\S]{0,120}'" + MANAFLOW_PROVIDER + "'")
                .matcher(sql)
                .find(),
            "awe modifier must stay isolated on awe provider");
        assertFalse(
            Pattern.compile(
                    "(?s)'" + MANAFLOW_MODIFIER + "'[\\s\\S]{0,120}'" + AWE_PROVIDER + "'")
                .matcher(sql)
                .find(),
            "manaflow modifier must stay isolated on manaflow provider");
    }

    @Test
    void aweReadsManaResolvedNeverMaxAndManaflowIsConst360WithNoReads() {
        assertContains(AWE_AD_FORMULA);
        assertContains(MANAFLOW_MANA_FORMULA);
        assertContains("source.attr.mana.resolved");
        assertFalse(
            sqlNoLineComments.contains("source.attr.mana.max"),
            "Awe must read source.attr.mana.resolved, never source.attr.mana.max");
        assertFalse(
            Pattern.compile("(?i)source\\.attr\\.mana\\.max")
                .matcher(sqlNoLineComments)
                .find(),
            "executable SQL must not read mana.max");
        assertTrue(
            Pattern.compile(
                    "(?s)'" + AWE_MODIFIER + "'\\s*,\\s*"
                        + "'" + AWE_PROVIDER + "'\\s*,\\s*"
                        + "'" + AWE_FORMULA_KEY + "'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'ad'[\\s\\S]*?"
                        + "20170\\s*,\\s*"
                        + "'" + AWE_FORMULA_KEY + "'")
                .matcher(sql)
                .find(),
            "awe modifier must target ad with selector/self 20110 and value_policy/add 20170");
        assertTrue(
            Pattern.compile(
                    "(?s)'" + MANAFLOW_MODIFIER + "'\\s*,\\s*"
                        + "'" + MANAFLOW_PROVIDER + "'\\s*,\\s*"
                        + "'" + MANAFLOW_FORMULA_KEY + "'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'mana'[\\s\\S]*?"
                        + "20170\\s*,\\s*"
                        + "'" + MANAFLOW_FORMULA_KEY + "'")
                .matcher(sql)
                .find(),
            "manaflow modifier must target mana with selector/self 20110 and value_policy/add 20170");
        // Manaflow const360 expression must contain no read paths.
        Matcher manaflowFormulaMatcher =
            Pattern.compile(
                    "(?s)'" + MANAFLOW_PROVIDER + "'\\s*,\\s*'"
                        + MANAFLOW_FORMULA_KEY + "'\\s*,\\s*'(\\{.*?\\})'\\s*::\\s*jsonb")
                .matcher(sqlNoLineComments);
        assertTrue(manaflowFormulaMatcher.find(), "must locate manaflow formula expression");
        String manaflowExpr = manaflowFormulaMatcher.group(1).replace("\\\"", "\"");
        assertEquals(MANAFLOW_MANA_FORMULA, manaflowExpr, "manaflow formula must be exact const 360");
        assertFalse(
            manaflowExpr.contains("\"op\":\"read\"") || manaflowExpr.contains("read"),
            "manaflow const360 formula must have no reads");
    }

    @Test
    void excludesMuramanaTransformProgressionCombatAndRuntimeSurfaces() {
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
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_lifecycles\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_lifecycles");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_tick_sequences\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_tick_sequences");
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
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_definitions");
        assertFalse(
            Pattern.compile("(?i)\\bmuramana\\b").matcher(sqlNoLineComments).find(),
            "must not implement Muramana identity / transform writes");
        assertFalse(
            Pattern.compile("(?i)\\btransform\\b|变形").matcher(sqlNoLineComments).find(),
            "must not implement transform / identity replacement");
        assertFalse(
            Pattern.compile("(?i)basic_attack_hit|ability_cast|on_hit|per_cast_throttle")
                .matcher(sqlNoLineComments)
                .find(),
            "must not introduce on-hit / ability-trigger / per-cast combat surfaces");
        assertFalse(
            Pattern.compile("(?i)\\brng\\b|random|伪随机|概率").matcher(sqlNoLineComments).find(),
            "must not implement random/RNG semantics");
        // Approved approximation IDs may contain "manaflow"; only reject out-of-boundary
        // progression tokens that are not part of the stable max-state identifiers.
        assertFalse(
            Pattern.compile("(?i)charge_queue|four.charge|\\+3\\b|\\+6\\b|8000\\s*ms|8s\\s*charg")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode Manaflow charge progression / timer / increment fidelity");
        assertTrue(
            sqlNoLineComments.contains(MANAFLOW_PROVIDER),
            "approved manaflow max-state provider id must be present");
        assertTrue(
            sqlNoLineComments.contains(MANAFLOW_FORMULA_KEY),
            "approved manaflow max-state formula key must be present");
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
