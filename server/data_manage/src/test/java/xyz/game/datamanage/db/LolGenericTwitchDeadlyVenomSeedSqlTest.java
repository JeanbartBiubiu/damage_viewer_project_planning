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
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_twitch_deadly_venom_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericTwitchDeadlyVenomSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_twitch_deadly_venom_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_twitch",
        "provider_hero_twitch_basic_attack",
        "ability_hero_twitch_basic_attack",
        "phase_hero_twitch_basic_attack_impact",
        "sequence_hero_twitch_basic_attack_damage",
        "step_hero_twitch_basic_attack_damage",
        "step_hero_twitch_basic_attack_emit_hit",
        "event_ref_hero_twitch_basic_attack_hit",
        "provider_hero_twitch_deadly_venom",
        "deadly_venom_stacks",
        "listener_hero_twitch_deadly_venom",
        "sequence_hero_twitch_deadly_venom_on_hit",
        "step_hero_twitch_deadly_venom_stacks_add",
        "sequence_hero_twitch_deadly_venom_tick",
        "step_hero_twitch_deadly_venom_tick_l1_4",
        "step_hero_twitch_deadly_venom_tick_l5_8",
        "step_hero_twitch_deadly_venom_tick_l9_12",
        "step_hero_twitch_deadly_venom_tick_l13_16",
        "step_hero_twitch_deadly_venom_tick_l17_18",
        "deadly_venom_stacks_add",
        "deadly_venom_level_band_1_4",
        "deadly_venom_level_band_5_8",
        "deadly_venom_level_band_9_12",
        "deadly_venom_level_band_13_16",
        "deadly_venom_level_band_17_18",
        "deadly_venom_tick_damage_flat1",
        "deadly_venom_tick_damage_flat2",
        "deadly_venom_tick_damage_flat3",
        "deadly_venom_tick_damage_flat4",
        "deadly_venom_tick_damage_flat5",
        "champion_level");

    private static final String FLAT1_DAMAGE =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.03},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.ap.resolved\"}]}]},"
            + "{\"op\":\"read\",\"path\":\"provider.target_state.deadly_venom_stacks\"}]}";

    private static final String BAND_1_4 =
        "{\"op\":\"min\",\"args\":[{\"op\":\"gte\",\"args\":[{\"op\":\"read\","
            + "\"path\":\"$owner.attr.champion_level\"},{\"op\":\"const\",\"value\":1}]},"
            + "{\"op\":\"lte\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
            + "{\"op\":\"const\",\"value\":4}]}]}";

    private static String sql;
    private static String sqlNoLineComments;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        // Normalize CRLF / lone CR to LF so LF-literal contract checks are portable.
        sql = Files.readString(seedPath, StandardCharsets.UTF_8)
            .replace("\r\n", "\n")
            .replace("\r", "\n");
        sqlNoLineComments = stripLineComments(sql);
    }

    @Test
    void usesTransactionLockCandidateAndIdempotentRevisionGuard() {
        assertTrue(sql.trim().startsWith("BEGIN;") || sql.contains("\nBEGIN;\n"), "must BEGIN");
        assertTrue(sql.trim().endsWith("COMMIT;") || sql.contains("\nCOMMIT;\n"), "must COMMIT");
        assertContains("FOR UPDATE");
        assertContains("v_candidate := v_locked_current + 1");
        assertContains("IF v_changed THEN");
        assertContains("current_revision = v_candidate");
        assertContains("IS DISTINCT FROM");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+(TABLE|COLUMN|CONSTRAINT)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not DROP");
        assertFalse(sqlNoLineComments.toLowerCase().contains("cascade"), "seed must not CASCADE");
    }

    @Test
    void documentsWikiAuthorityAndExclusions() {
        assertTrue(sql.contains("4013286"), "must cite Wiki revision 4013286");
        assertTrue(
            sql.contains("1567c0efec7f9e9021f6dc02410f92262dfa30128acc457c531199dbc9121b44"),
            "must cite Wiki content SHA");
        assertTrue(sql.contains("Deadly Venom") || sql.contains("死亡毒液"));
        assertTrue(sql.contains("Expunge") || sql.contains("不改 legacy"));
        assertTrue(sql.contains("Runaan") || sql.contains("多目标"));
        assertFalse(sql.contains("skill_twitch_p_deadly_venom"), "must not edit legacy DPS ids");
    }

    @Test
    void ensuresStableIdsAndExactlyOneBasicAttackHitEmit() {
        for (String id : STABLE_IDS) {
            assertTrue(sqlNoLineComments.contains(id), "missing stable id: " + id);
        }
        assertContains("event/basic_attack_hit");
        assertContains("20211");
        assertContains("event_ref_hero_twitch_basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twitch_basic_attack_emit_hit'.{0,160}20158")
                .matcher(sqlNoLineComments)
                .find(),
            "emit step must be operation/emit_event (20158)");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.event_effect_details"),
            "exactly one event_effect_details insert (single basic_attack_hit emit)");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "'event_ref_hero_twitch_basic_attack_hit'"),
            "exactly one basic_attack_hit event_ref");
        assertFalse(
            Pattern.compile("(?i)\\bexpunge\\b|\\brunaan\\b").matcher(sqlNoLineComments).find(),
            "must not model Expunge/Runaan in executable SQL");
    }

    @Test
    void mountsPassiveWithStacksListenerAndAnchoredLifecycle() {
        assertContains("provider_hero_twitch_deadly_venom");
        assertContains("'deadly_venom_stacks'");
        assertTrue(
            sqlNoLineComments.contains("6")
                && sqlNoLineComments.contains("6000")
                && sqlNoLineComments.contains("20190"),
            "stacks must be max6 / 6000ms / refresh_on_write(20190)");
        assertContains("20252");
        assertContains("listener_hero_twitch_deadly_venom");
        assertContains("20212");
        assertContains("max_triggers_per_event");
        assertTrue(
            Pattern.compile("max_triggers_per_event[^;]{0,80}\\b1\\b")
                .matcher(sqlNoLineComments)
                .find()
                || sqlNoLineComments.contains("1,\n        NULL,\n        v_candidate"),
            "listener max_triggers_per_event must be 1");
        assertContains("20170");
        assertContains("deadly_venom_stacks_add");
        assertContains("tick_interval_ms");
        assertContains("start_delay_ms");
        assertTrue(
            sqlNoLineComments.contains("1000") && sqlNoLineComments.contains("0,"),
            "lifecycle tick 1000ms / start_delay 0");
        assertContains("tick_anchor_scope_type_id");
        assertContains("tick_anchor_state_key");
        assertTrue(
            sqlNoLineComments.contains("20252")
                && sqlNoLineComments.contains("'deadly_venom_stacks'"),
            "tick_anchor must resolve to provider_target + deadly_venom_stacks");
        assertContains("provider_tick_sequences");
        assertContains("sequence_hero_twitch_deadly_venom_tick");
    }

    @Test
    void definesFiveExclusiveLevelBandsAndTrueNonCritNonCopyableFormulas() {
        assertContains(BAND_1_4);
        assertContains("deadly_venom_level_band_5_8");
        assertContains("deadly_venom_level_band_9_12");
        assertContains("deadly_venom_level_band_13_16");
        assertContains("deadly_venom_level_band_17_18");
        assertContains(FLAT1_DAMAGE);
        assertContains("deadly_venom_tick_damage_flat2");
        assertContains("deadly_venom_tick_damage_flat3");
        assertContains("deadly_venom_tick_damage_flat4");
        assertContains("deadly_venom_tick_damage_flat5");
        assertTrue(
            sqlNoLineComments.contains("\"value\":2")
                && sqlNoLineComments.contains("\"value\":3")
                && sqlNoLineComments.contains("\"value\":4")
                && sqlNoLineComments.contains("\"value\":5"),
            "flat bands 2..5 must appear in formulas");
        assertContains("20222");
        assertTrue(
            Pattern.compile("copyable_on_hit[^,]*,\\s*crit_eligible")
                    .matcher(sqlNoLineComments)
                    .find()
                || (sqlNoLineComments.contains("false,\n            false,")
                    && sqlNoLineComments.contains("20222")),
            "tick damage must be non-copyable and non-crit");
        assertContains("damage_trait/dot");
        assertContains("damage_trait/proc");
        assertContains("62004");
        assertContains("62009");
        assertFalse(sql.contains("damage_trait/poison"), "must not invent poison trait");
        assertFalse(sql.contains("damage_trait/persistent"), "must not invent persistent trait");
    }

    @Test
    void championLevelIsSelfContainedWithoutOverwrite() {
        assertContains("champion_level");
        assertContains("generate_series(1, 18)");
        assertTrue(
            sqlNoLineComments.contains("ON CONFLICT (game_id, entity_id, attr_key, stage) DO NOTHING")
                || sqlNoLineComments.contains(
                    "ON CONFLICT (game_id, entity_id, attr_key, stage) DO NOTHING"),
            "champion_level stages must DO NOTHING when present");
        assertTrue(
            sqlNoLineComments.contains("ON CONFLICT (game_id, entity_id) DO NOTHING"),
            "hero_twitch entity must not overwrite metadata");
    }

    @Test
    void coexistWithBasicAttackAndNoLegacyDpsEdits() {
        assertContains("provider_hero_twitch_basic_attack");
        assertContains("provider_hero_twitch_deadly_venom");
        assertFalse(sql.contains("twitchDeadlyVenomPassive"), "must not touch legacy helper");
        assertFalse(sql.contains("trueDamagePerStackPerTick"), "must not rewrite Batch-B JSON");
        assertFalse(
            Pattern.compile("(?i)ALTER\\s+TABLE").matcher(sqlNoLineComments).find(),
            "seed must not DDL");
    }

    private static void assertContains(String needle) {
        assertTrue(sqlNoLineComments.contains(needle) || sql.contains(needle), "missing: " + needle);
    }

    private static String stripLineComments(String raw) {
        StringBuilder out = new StringBuilder(raw.length());
        for (String line : raw.split("\n", -1)) {
            int idx = line.indexOf("--");
            out.append(idx >= 0 ? line.substring(0, idx) : line).append('\n');
        }
        return out.toString();
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int at = haystack.indexOf(needle, from);
            if (at < 0) {
                return count;
            }
            count++;
            from = at + needle.length();
        }
    }

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath();
        Path direct = cwd.resolve(relative);
        if (Files.isRegularFile(direct)) {
            return direct;
        }
        Path fromModule = cwd.resolve("../..").resolve(relative).normalize();
        if (Files.isRegularFile(fromModule)) {
            return fromModule;
        }
        fail("cannot resolve " + relative + " from " + cwd);
        return direct;
    }
}
