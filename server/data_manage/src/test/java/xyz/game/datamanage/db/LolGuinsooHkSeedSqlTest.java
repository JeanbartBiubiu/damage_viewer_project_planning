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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_guinsoo_hk_seed.sql}.
 * Does not connect to a live database.
 */
class LolGuinsooHkSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_guinsoo_hk_seed.sql";

    private static final List<String> COPYABLE_ALLOWLIST = List.of(
        "step_item_3124_guinsoos_damage",
        "step_item_3153_ruined_king_damage",
        "step_item_3115_nashors_damage",
        "step_item_3302_terminus_damage");

    private static final List<String> FORBIDDEN_COPYABLE_STEPS = List.of(
        "step_item_6672_kraken_proc_damage",
        "step_hero_vayne_silver_bolts_proc_damage",
        "step_item_3181_hullbreaker_proc_damage");

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
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoLineComments).find(),
            "seed must not call publish API markers");
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "guinsoo hk seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "guinsoo hk seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "guinsoo hk seed must not CASCADE");
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
        assertFalse(
            Pattern.compile("(?is)\\bUPDATE\\s+public\\.(heroes|items|skills)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not update legacy heroes/items/skills tables");
        assertFalse(
            Pattern.compile("(?i)public\\.heroes").matcher(sqlNoLineComments).find(),
            "must not reference public.heroes");
        assertFalse(
            Pattern.compile("(?i)public\\.items\\b").matcher(sqlNoLineComments).find(),
            "must not reference public.items");
        assertFalse(
            Pattern.compile("(?i)public\\.skills\\b").matcher(sqlNoLineComments).find(),
            "must not reference public.skills");
        assertFalse(
            Pattern.compile("(?i)owner_categories").matcher(sqlNoLineComments).find(),
            "must not reference owner_categories");
        assertFalse(
            Pattern.compile("(?i)single_attacker_dps").matcher(sqlNoLineComments).find(),
            "must not reference single_attacker_dps");
    }

    @Test
    void validatesPrerequisitesForGameReservedAttrAndGuinsooBaseline() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("attr_key=attack_speed");
        assertContains("provider_item_3124_guinsoos");
        assertContains("listener_item_3124_guinsoos");
        assertContains("sequence_item_3124_guinsoos");
        assertContains("step_item_3124_guinsoos_damage");
        assertContains("missing copyable source damage_effect_details");
        assertTrue(
            Pattern.compile(
                    "(?is)IF\\s+NOT\\s+EXISTS\\s*\\(.*?FROM\\s+public\\.games\\b.*?game_id")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard missing game_id in public.games");
        assertTrue(
            Pattern.compile(
                    "(?is)attr_key\\s*=\\s*'attack_speed'")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard attack_speed attribute_definitions");
        assertTrue(
            Pattern.compile(
                    "(?s)st\\.step_id\\s*=\\s*'step_item_3124_guinsoos_damage'\\s*"
                        + "AND\\s+st\\.sequence_id\\s*=\\s*'sequence_item_3124_guinsoos'\\s*"
                        + "AND\\s+st\\.step_order\\s*=\\s*0\\s*"
                        + "AND\\s+st\\.operation_type_id\\s*=\\s*20150")
                .matcher(sqlNoLineComments)
                .find(),
            "must require existing Guinsoo damage step order 0 / operation 20150");
        for (String stepId : COPYABLE_ALLOWLIST) {
            assertTrue(
                sqlNoLineComments.contains("'" + stepId + "'"),
                "prerequisite/copyable allowlist must mention " + stepId);
        }
        for (int typeId : List.of(
            20100, 20110, 20150, 20160, 20161, 20170, 20173, 20190, 20250, 20263)) {
            assertContains(Integer.toString(typeId));
        }
        assertContains("INSERT INTO public.types");
    }

    @Test
    void seedsStableSeethingStrikeStateContract() {
        assertContains("provider_state_fields");
        assertContains("guinsoos_seething_strike");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3124_guinsoos'\\s*,\\s*"
                        + "'guinsoos_seething_strike'\\s*,\\s*"
                        + "20100\\s*,\\s*"
                        + "4\\s*,\\s*"
                        + "3000\\s*,\\s*"
                        + "20190")
                .matcher(sqlNoLineComments)
                .find(),
            "state must be provider_item_3124_guinsoos / guinsoos_seething_strike "
                + "with number 20100, max 4, duration 3000, refresh 20190");
    }

    @Test
    void formulasAndModifierGrantEightPercentAttackSpeedPerStack() {
        assertContains("provider.state.guinsoos_seething_strike");
        assertContains("0.08");
        assertContains("guinsoos_seething_strike_attack_speed");
        assertContains("guinsoos_seething_strike_add");
        assertTrue(
            Pattern.compile(
                    "(?s)\\{\"op\"\\s*:\\s*\"mul\"\\s*,\\s*\"args\"\\s*:\\s*\\["
                        + "\\{\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*0\\.08\\}"
                        + "\\s*,\\s*"
                        + "\\{\"op\"\\s*:\\s*\"read\"\\s*,\\s*\"path\"\\s*:\\s*"
                        + "\"provider\\.state\\.guinsoos_seething_strike\"\\}"
                        + "\\]\\}")
                .matcher(sqlNoLineComments)
                .find(),
            "attack_speed formula must mul const 0.08 by provider.state.guinsoos_seething_strike");
        assertTrue(
            Pattern.compile("(?s)\\{\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*1\\}")
                .matcher(sqlNoLineComments)
                .find(),
            "stack-add formula must be const 1");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3124_guinsoos_seething_strike_attack_speed'\\s*,\\s*"
                        + "'provider_item_3124_guinsoos'\\s*,\\s*"
                        + "'guinsoos_seething_strike_attack_speed'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'attack_speed'[\\s\\S]*?"
                        + "20173\\s*,\\s*"
                        + "'guinsoos_seething_strike_attack_speed'")
                .matcher(sqlNoLineComments)
                .find(),
            "modifier must target attack_speed with selector 20110 and percent_add 20173");
    }

    @Test
    void deterministicStepsAreDamageThenStateChangeThenRepeat() {
        assertContains("step_item_3124_guinsoos_seething_strike_add");
        assertContains("step_item_3124_guinsoos_phantom_hit");
        assertContains("state_effect_details");
        assertContains("repeat_effect_details");
        assertContains("phantom_hit");

        // Existing damage stays order 0 (prerequisite); upgrade authors order 1 + 2.
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3124_guinsoos_seething_strike_add'\\s*,\\s*"
                        + "'sequence_item_3124_guinsoos'\\s*,\\s*1\\s*,\\s*20160")
                .matcher(sqlNoLineComments)
                .find(),
            "state_change step must be order 1 / operation 20160");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3124_guinsoos_phantom_hit'\\s*,\\s*"
                        + "'sequence_item_3124_guinsoos'\\s*,\\s*2\\s*,\\s*20161")
                .matcher(sqlNoLineComments)
                .find(),
            "repeat step must be order 2 / operation 20161");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3124_guinsoos_seething_strike_add'\\s*,\\s*"
                        + "20250\\s*,\\s*"
                        + "'guinsoos_seething_strike'\\s*,\\s*"
                        + "'guinsoos_seething_strike_add'\\s*,\\s*"
                        + "20170")
                .matcher(sqlNoLineComments)
                .find(),
            "state detail must use provider scope 20250 and add policy 20170");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3124_guinsoos_phantom_hit'\\s*,\\s*"
                        + "20263\\s*,\\s*"
                        + "1\\s*,\\s*"
                        + "'phantom_hit'\\s*,\\s*"
                        + "'guinsoos_seething_strike'\\s*,\\s*"
                        + "4")
                .matcher(sqlNoLineComments)
                .find(),
            "repeat detail must be 20263 / count 1 / tag phantom_hit / trigger state / threshold 4");
        assertTrue(
            sqlNoLineComments.indexOf("INSERT INTO public.effect_steps")
                < sqlNoLineComments.indexOf("INSERT INTO public.state_effect_details"),
            "state details must follow effect_steps insert");
        assertTrue(
            sqlNoLineComments.indexOf("INSERT INTO public.effect_steps")
                < sqlNoLineComments.indexOf("INSERT INTO public.repeat_effect_details"),
            "repeat details must follow effect_steps insert");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void copyableOnHitAllowlistIsExactAndExcludesForbiddenSteps() {
        String copyableUpdate = extractDamageCopyableUpdateBlock();
        assertFalse(copyableUpdate.isBlank(), "must contain damage_effect_details copyable update");

        Set<String> authored = extractQuotedStepIdsInInClause(copyableUpdate);
        assertEquals(
            new LinkedHashSet<>(COPYABLE_ALLOWLIST),
            authored,
            "copyable UPDATE allowlist must be exactly the four pure on-hit damage steps");

        for (String forbidden : FORBIDDEN_COPYABLE_STEPS) {
            assertFalse(
                copyableUpdate.contains("'" + forbidden + "'"),
                "copyable update scope must not mention " + forbidden);
            assertFalse(
                Pattern.compile(
                        "(?is)'" + Pattern.quote(forbidden) + "'[\\s\\S]{0,200}"
                            + "copyable_on_hit\\s*=\\s*true")
                    .matcher(sqlNoLineComments)
                    .find(),
                "must not set copyable_on_hit true for " + forbidden);
        }

        // No broad UPDATE that could mark arbitrary damage rows copyable.
        assertFalse(
            Pattern.compile(
                    "(?is)UPDATE\\s+public\\.damage_effect_details\\b(?![\\s\\S]*?\\bstep_id\\s+IN\\s*\\()")
                .matcher(sqlNoLineComments)
                .find(),
            "copyable UPDATE must constrain step_id IN (...); no broad damage update");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "UPDATE public.damage_effect_details"),
            "seed may contain only one damage_effect_details UPDATE");
        assertTrue(
            Pattern.compile("copyable_on_hit\\s+IS\\s+DISTINCT\\s+FROM\\s+true")
                .matcher(copyableUpdate)
                .find(),
            "copyable UPDATE must be idempotent via IS DISTINCT FROM true");
    }

    private static String extractDamageCopyableUpdateBlock() {
        Matcher m =
            Pattern.compile(
                    "(?is)UPDATE\\s+public\\.damage_effect_details\\b[\\s\\S]*?;")
                .matcher(sqlNoLineComments);
        if (!m.find()) {
            return "";
        }
        return m.group();
    }

    private static Set<String> extractQuotedStepIdsInInClause(String updateBlock) {
        Matcher inClause =
            Pattern.compile("(?is)\\bstep_id\\s+IN\\s*\\(([^)]*)\\)").matcher(updateBlock);
        assertTrue(inClause.find(), "copyable UPDATE must use step_id IN (...)");
        Matcher quoted = Pattern.compile("'([^']+)'").matcher(inClause.group(1));
        Set<String> ids = new LinkedHashSet<>();
        while (quoted.find()) {
            ids.add(quoted.group(1));
        }
        return ids;
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
