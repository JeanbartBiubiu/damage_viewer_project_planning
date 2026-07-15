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
 * Static contract for {@code lol_generic_yun_tal_practice_makes_lethal_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericYunTalPracticeMakesLethalSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_yun_tal_practice_makes_lethal_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3032_yun_tal_practice_makes_lethal",
        "listener_item_3032_yun_tal_practice_makes_lethal",
        "sequence_item_3032_yun_tal_practice_makes_lethal",
        "step_item_3032_yun_tal_practice_makes_lethal_stack_add",
        "modifier_item_3032_yun_tal_practice_makes_lethal_crit_chance",
        "practice_crit_stacks",
        "practice_crit_stacks_add",
        "practice_crit_chance");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20160, 20170, 20181, 20211, 20212, 20250);

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
            "yun tal seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "yun tal seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "yun tal seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "yun tal seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "yun tal seed must not CREATE TABLE");
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
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values[\\s\\S]*"
                        + "item_3032[\\s\\S]*crit_chance")
                .matcher(sqlNoLineComments)
                .find(),
            "must not add static crit_chance to item_3032");
    }

    @Test
    void validatesPrerequisitesWithoutRecreatingBatchC() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_3032");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'item_3032'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight game_entities item_3032");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'crit_chance'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight attribute_definitions crit_chance");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void mountsOnlyPracticeMakesLethalProviderOnItem3032() {
        assertContains("provider_item_3032_yun_tal_practice_makes_lethal");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3032'\\s*,\\s*'provider_item_3032_yun_tal_practice_makes_lethal'")
                .matcher(sql)
                .find(),
            "must mount practice makes lethal provider to item_3032");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3032_yun_tal_practice_makes_lethal'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "provider kind must be passive 20120");
        assertFalse(
            Pattern.compile("(?s)'item_(?!3032')\\w+'\\s*,\\s*'provider_item_3032")
                .matcher(sql)
                .find(),
            "must not mount this provider to entities other than item_3032");
        assertEqualsOneMount();
    }

    @Test
    void singleSourceOwnerBasicAttackHitListenerWithCappedStackAdd() {
        assertContains("listener_item_3032_yun_tal_practice_makes_lethal");
        assertContains("sequence_item_3032_yun_tal_practice_makes_lethal");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3032_yun_tal_practice_makes_lethal'[\\s\\S]{0,200}"
                        + "20211[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "listener must be basic_attack_hit 20211 with max_triggers_per_event=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3032_yun_tal_practice_makes_lethal'\\s*,\\s*"
                        + "20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3032_yun_tal_practice_makes_lethal'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3032_yun_tal_practice_makes_lethal_stack_add'\\s*,\\s*"
                        + "'sequence_item_3032_yun_tal_practice_makes_lethal'\\s*,\\s*0\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "exactly one capped state add step order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3032_yun_tal_practice_makes_lethal_stack_add'\\s*,\\s*"
                        + "20250\\s*,\\s*'practice_crit_stacks'\\s*,\\s*"
                        + "'practice_crit_stacks_add'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "state add detail must use provider scope + add policy");
        assertContains("{\"op\":\"const\",\"value\":1}");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_steps"),
            "must define exactly one effect_steps insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.state_effect_details"),
            "must define exactly one state_effect_details insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_listeners"),
            "must define exactly one provider listener");
    }

    @Test
    void practiceCritStacksStateIsMaxSixtyThreeAndUntimed() {
        assertTrue(
            Pattern.compile(
                    "(?s)'practice_crit_stacks'[\\s\\S]{0,120}20100[\\s\\S]{0,40}63"
                        + "[\\s\\S]{0,40}NULL[\\s\\S]{0,40}NULL")
                .matcher(sql)
                .find(),
            "practice_crit_stacks must be number / max 63 / untimed (NULL duration + NULL refresh)");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");
        assertFalse(
            Pattern.compile("(?is)\\b20190\\b").matcher(sqlNoLineComments).find(),
            "untimed state must not use refresh_duration 20190");
    }

    @Test
    void critChanceModifierUsesMinCapAndStackMultiplyAddPolicy() {
        String critFormula =
            "{\"op\":\"min\",\"args\":[{\"op\":\"const\",\"value\":0.25},"
                + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.004},"
                + "{\"op\":\"read\",\"path\":\"provider.state.practice_crit_stacks\"}]}]}";
        assertContains(critFormula);
        assertContains("0.25");
        assertContains("0.004");
        assertContains("provider.state.practice_crit_stacks");
        assertContains("\"op\":\"min\"");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3032_yun_tal_practice_makes_lethal_crit_chance'\\s*,\\s*"
                        + "'provider_item_3032_yun_tal_practice_makes_lethal'\\s*,\\s*"
                        + "'practice_crit_chance'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'crit_chance'[\\s\\S]*?"
                        + "20170\\s*,\\s*"
                        + "'practice_crit_chance'")
                .matcher(sql)
                .find(),
            "modifier must target crit_chance with selector 20110 and add policy 20170");
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
    }

    @Test
    void excludesFlurryAttackSpeedBasicAttackStartedAndRandomCritSemantics() {
        assertFalse(
            Pattern.compile("(?i)flurry|疾风骤雨").matcher(sqlNoLineComments).find(),
            "must not model Flurry / 疾风骤雨 as implemented ids or formulas");
        assertFalse(
            Pattern.compile("(?i)basic_attack_started").matcher(sqlNoLineComments).find(),
            "must not introduce event/basic_attack_started");
        assertFalse(
            Pattern.compile("(?is)target_attr_key[\\s\\S]{0,40}'attack_speed'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write attack_speed provider modifier");
        assertFalse(
            Pattern.compile("(?is)'attack_speed'").matcher(sqlNoLineComments).find(),
            "seed body must not reference attack_speed formula/modifier targets");
        assertFalse(
            Pattern.compile("(?i)random\\s*crit|crit_roll|crit_event|暴击事件")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model random crit event semantics");
        assertFalse(
            Pattern.compile(
                    "(?s)'practice_crit_stacks'[\\s\\S]{0,160}20100[\\s\\S]{0,40}63"
                        + "[\\s\\S]{0,40}(?!NULL)\\d+")
                .matcher(sql)
                .find(),
            "practice_crit_stacks must not use a numeric duration_ms");
        assertFalse(
            Pattern.compile("(?i)\\bcooldown\\b|冷却").matcher(sqlNoLineComments).find(),
            "must not model cooldown state for Flurry exclusions");
    }

    private static void assertEqualsOneMount() {
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once via entity_provider_mounts");
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
