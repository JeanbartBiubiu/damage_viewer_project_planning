package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * Static contract for {@code lol_generic_malzahar_malefic_visions_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericMalzaharMaleficVisionsSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_malzahar_malefic_visions_seed.sql";

    private static final String SIDECAR_RELATIVE =
        "数据参考/lol-wiki-extra-mechanisms/normalized/generic/malzahar-e.json";

    private static final String EXPECTED_CANDIDATE =
        "hero_skill|hero_malzahar|E|恶咒降临";

    private static final String EXPECTED_SHA =
        "9098ee2fbe7dfb33d1ca375bbce0c68788fd60378780aa4ddab8afc46736ba84";

    private static final List<String> STABLE_IDS = List.of(
        "hero_malzahar",
        "provider_hero_malzahar_malefic_visions",
        "malefic_visions_active",
        "ability_hero_malzahar_e_malefic_visions",
        "malefic_visions",
        "cost_hero_malzahar_e_malefic_visions_mana",
        "cooldown_hero_malzahar_e_malefic_visions",
        "phase_hero_malzahar_e_malefic_visions_impact",
        "sequence_hero_malzahar_e_malefic_visions_impact",
        "step_hero_malzahar_e_malefic_visions_apply",
        "sequence_hero_malzahar_malefic_visions_tick",
        "step_hero_malzahar_malefic_visions_tick_damage",
        "e_mana_cost",
        "e_cooldown_ms",
        "malefic_visions_arm",
        "malefic_visions_tick_damage");

    private static final String TICK_DAMAGE_FORMULA =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":13.75},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.05},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.ap.resolved\"}]}]}";

    private static String sql;
    private static String sqlNoLineComments;
    private static JsonNode sidecar;

    @BeforeAll
    static void loadSeedSqlAndSidecar() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        String raw = Files.readString(seedPath, StandardCharsets.UTF_8);
        sql = normalizeNewlines(raw);
        sqlNoLineComments = stripLineComments(sql);

        Path sidecarPath = resolveRelative(SIDECAR_RELATIVE);
        assertTrue(Files.isRegularFile(sidecarPath), "sidecar missing: " + sidecarPath);
        sidecar = new ObjectMapper().readTree(sidecarPath.toFile());
    }

    @Test
    void parsesLocalSidecarAuthorityFields() {
        assertEquals(EXPECTED_CANDIDATE, sidecar.path("candidateKey").asText());
        assertEquals("hero_malzahar", sidecar.path("ownerId").asText());
        assertEquals("E", sidecar.path("skillKey").asText());
        assertEquals("Template:Data Malzahar/E", sidecar.path("requestTitle").asText());
        assertEquals(
            "Template:Data Malzahar/Malefic Visions",
            sidecar.path("resolvedTitle").asText());
        assertEquals(1308233, sidecar.path("wikiPageId").asInt());
        assertEquals(4015185, sidecar.path("revisionId").asInt());
        assertEquals("2026-05-03T16:59:57Z", sidecar.path("revisionTimestamp").asText());
        assertEquals(2228, sidecar.path("rawByteSize").asInt());
        assertEquals(EXPECTED_SHA, sidecar.path("contentSha256").asText());
        assertEquals("恶咒降临", sidecar.path("zhDisplayName").asText());
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
            "mount/link idempotent guard must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+(TABLE|COLUMN|CONSTRAINT)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not DROP");
        assertFalse(sqlNoLineComments.toLowerCase().contains("cascade"), "seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "seed must not ALTER TABLE");
    }

    @Test
    void documentsWikiAuthorityPhaseAAndExclusions() {
        assertContains(EXPECTED_CANDIDATE);
        assertContains("Template:Data Malzahar/E");
        assertContains("Template:Data Malzahar/Malefic Visions");
        assertContains("1308233");
        assertContains("4015185");
        assertContains("2026-05-03T16:59:57Z");
        assertContains("2228");
        assertContains(EXPECTED_SHA);
        assertContains(SIDECAR_RELATIVE);
        assertTrue(sql.contains("Malefic Visions") || sql.contains("恶咒降临"));
        assertTrue(sql.contains("13.75") && sql.contains("0.05") && sql.contains("220"));
        assertTrue(
            sql.contains("Q/R") || sql.contains("死亡扩散") || sql.contains("弹跳"),
            "must document excluded refresh/spread branches");
        assertTrue(
            sql.contains("Batch-J") || sql.contains("5.6"),
            "must mention Batch-J historical exclusion in comments");
        assertFalse(
            sqlNoLineComments.contains("skill_malzahar_e"),
            "must not touch legacy skill_malzahar_e");
        assertFalse(
            Pattern.compile("(?i)schedule_tick").matcher(sqlNoLineComments).find(),
            "must not model schedule_tick");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.status").matcher(sqlNoLineComments).find(),
            "must not write status tables");
    }

    @Test
    void ensuresStableIdsMountProviderAndStateContract() {
        for (String id : STABLE_IDS) {
            assertTrue(sqlNoLineComments.contains(id), "missing stable id: " + id);
        }
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_malzahar'\\s*,\\s*'provider_hero_malzahar_malefic_visions'")
                .matcher(sqlNoLineComments)
                .find(),
            "must mount exactly provider_hero_malzahar_malefic_visions on hero_malzahar");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_malzahar_malefic_visions'\\s*,\\s*"
                        + "'malefic_visions_active'\\s*,\\s*"
                        + "20100\\s*,\\s*"
                        + "1\\s*,\\s*"
                        + "4000\\s*,\\s*"
                        + "20190")
                .matcher(sqlNoLineComments)
                .find(),
            "state must be max1 / 4000ms / refresh_on_write 20190");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "hero_malzahar entity must not overwrite metadata");
    }

    @Test
    void seedsActiveRank5ManaCdWithExactlyOneStateChangeAndZeroCastDamage() {
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_malzahar_e_malefic_visions'\\s*,\\s*"
                        + "'provider_hero_malzahar_malefic_visions'\\s*,\\s*"
                        + "'malefic_visions'\\s*,\\s*20130")
                .matcher(sqlNoLineComments)
                .find(),
            "active ability malefic_visions kind 20130");
        assertTrue(
            sqlNoLineComments.contains("\"value\":100")
                && sqlNoLineComments.contains("'e_mana_cost'"),
            "mana cost formula must be 100");
        assertTrue(
            sqlNoLineComments.contains("\"value\":7000")
                && sqlNoLineComments.contains("'e_cooldown_ms'"),
            "cooldown formula must be 7000ms");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_malzahar_e_malefic_visions_apply'\\s*,\\s*"
                        + "'sequence_hero_malzahar_e_malefic_visions_impact'\\s*,\\s*"
                        + "0\\s*,\\s*"
                        + "20160\\s*,\\s*"
                        + "20110")
                .matcher(sqlNoLineComments)
                .find(),
            "cast impact must be single state_change on source/owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_malzahar_e_malefic_visions_apply'\\s*,\\s*"
                        + "20252\\s*,\\s*"
                        + "'malefic_visions_active'\\s*,\\s*"
                        + "'malefic_visions_arm'\\s*,\\s*"
                        + "20172")
                .matcher(sqlNoLineComments)
                .find(),
            "state detail must override provider_target malefic_visions_active to 1");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.state_effect_details"),
            "exactly one state_effect_details insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "exactly one damage_effect_details insert (tick only)");
        assertFalse(
            Pattern.compile(
                    "(?s)sequence_hero_malzahar_e_malefic_visions_impact[\\s\\S]{0,800}"
                        + "INSERT INTO public\\.damage_effect_details")
                .matcher(sqlNoLineComments)
                .find(),
            "cast impact sequence must not own a damage_effect_details insert");
        assertFalse(
            sqlNoLineComments.contains("step_hero_malzahar_e_malefic_visions_damage"),
            "must not define cast direct-damage step");
    }

    @Test
    void mountsAnchoredLifecycleAndExactTickDamage() {
        assertContains("tick_interval_ms");
        assertContains("start_delay_ms");
        assertContains("tick_anchor_scope_type_id");
        assertContains("tick_anchor_state_key");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_malzahar_malefic_visions'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "1\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "250\\s*,\\s*"
                        + "0\\s*,\\s*"
                        + "20252\\s*,\\s*"
                        + "'malefic_visions_active'")
                .matcher(sqlNoLineComments)
                .find(),
            "lifecycle must be 250/0 with anchor provider_target + malefic_visions_active");
        assertContains("provider_tick_sequences");
        assertContains("sequence_hero_malzahar_malefic_visions_tick");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_tick_sequences"),
            "exactly one tick sequence attachment");
        assertContains(TICK_DAMAGE_FORMULA);
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_malzahar_malefic_visions_tick_damage'\\s*,\\s*"
                        + "'malefic_visions_tick_damage'\\s*,\\s*"
                        + "20221\\s*,\\s*"
                        + "20170\\s*,\\s*"
                        + "false\\s*,\\s*"
                        + "false")
                .matcher(sqlNoLineComments)
                .find(),
            "tick damage must be magic non-copyable non-crit");
        assertContains("damage_trait/dot");
        assertContains("62004");
        assertFalse(sql.contains("damage_trait/indirect"), "must not invent indirect trait");
        assertFalse(sql.contains("damage_trait/spell"), "must not invent spell-effect trait");
    }

    @Test
    void rejectsLegacyBatchJAndExcludedExecutableBranches() {
        assertFalse(sqlNoLineComments.contains("skill_malzahar_e"));
        assertFalse(sqlNoLineComments.contains("status_malzahar_e_dot"));
        assertFalse(
            Pattern.compile("(?i)schedule_tick").matcher(sqlNoLineComments).find());
        assertFalse(
            Pattern.compile("(?i)V2-Batch-J|batch_j_status").matcher(sqlNoLineComments).find());
        assertFalse(
            Pattern.compile("(?i)\"tick_damage\"\\s*:\\s*5\\.6|tick_damage\\s*=\\s*5\\.6")
                .matcher(sqlNoLineComments)
                .find(),
            "must not copy Batch-J historical tick_damage 5.6");
        assertFalse(
            Pattern.compile(
                    "(?i)call_of_the_void|nether_grasp|death_spread|bounce_radius|"
                        + "closest_enemy|minion_execute|mana_restore_2pct|"
                        + "ability_hero_malzahar_[qr]_")
                .matcher(sqlNoLineComments)
                .find(),
            "must not introduce executable ids for excluded branches");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "Phase-A must not write Q/R refresh listeners");
    }

    private static String normalizeNewlines(String raw) {
        return raw.replace("\r\n", "\n").replace("\r", "\n");
    }

    private static String stripLineComments(String raw) {
        StringBuilder out = new StringBuilder(raw.length());
        for (String line : raw.split("\n", -1)) {
            int idx = line.indexOf("--");
            out.append(idx >= 0 ? line.substring(0, idx) : line).append('\n');
        }
        return out.toString();
    }

    private static void assertContains(String needle) {
        assertTrue(
            sqlNoLineComments.contains(needle) || sql.contains(needle),
            "missing: " + needle);
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
