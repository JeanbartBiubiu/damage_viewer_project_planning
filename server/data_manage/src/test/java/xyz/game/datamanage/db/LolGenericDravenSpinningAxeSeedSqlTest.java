package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_draven_spinning_axe_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericDravenSpinningAxeSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_draven_spinning_axe_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_draven",
        "provider_hero_draven_basic_attack",
        "ability_hero_draven_basic_attack",
        "phase_hero_draven_basic_attack_impact",
        "sequence_hero_draven_basic_attack_damage",
        "step_hero_draven_basic_attack_damage",
        "step_hero_draven_basic_attack_emit_hit",
        "event_ref_hero_draven_basic_attack_hit",
        "provider_hero_draven_q_spinning_axe",
        "provider_hero_draven_q_spinning_axe_flight",
        "ability_hero_draven_q_spinning_axe",
        "cost_hero_draven_q_spinning_axe_mana",
        "cooldown_hero_draven_q_spinning_axe",
        "listener_hero_draven_q_spinning_axe_ability_started",
        "listener_hero_draven_q_spinning_axe_basic_attack_hit",
        "listener_hero_draven_q_spinning_axe_caught",
        "sequence_hero_draven_q_spinning_axe_arm",
        "sequence_hero_draven_q_spinning_axe_proc",
        "sequence_hero_draven_q_spinning_axe_flight_tick",
        "step_hero_draven_q_spinning_axe_ready_arm",
        "step_hero_draven_q_spinning_axe_damage",
        "step_hero_draven_q_spinning_axe_apply_flight",
        "step_hero_draven_q_spinning_axe_ready_consume",
        "step_hero_draven_q_spinning_axe_flight_emit_caught",
        "event_ref_hero_draven_q_spinning_axe_caught",
        "spinning_axe_ready",
        "spinning_axe_ready_arm",
        "spinning_axe_ready_room",
        "spinning_axe_ready_armed",
        "spinning_axe_proc_damage",
        "spinning_axe_ready_consume",
        "flight_duration_ms",
        "q_mana_cost",
        "q_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20121, 20130, 20142, 20150, 20155, 20158,
        20160, 20170, 20172, 20181, 20190, 20205, 20211, 20212, 20216, 20220,
        20230, 20250, 20260);

    private static final String READY_ROOM =
        "{\"op\":\"lt\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.spinning_axe_ready\"},"
            + "{\"op\":\"const\",\"value\":2}]}";

    private static final String READY_ARMED =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.spinning_axe_ready\"},"
            + "{\"op\":\"const\",\"value\":1}]}";

    private static final String PROC_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":60},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.15},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.base\"}]}]}]}";

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
            "spinning axe seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "spinning axe seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "spinning axe seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "spinning axe seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "spinning axe seed must not CREATE TABLE");
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
    void validatesPrerequisitesAndProjectsRequiredReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        for (String attr : List.of(
            "hp", "mana", "ad", "attack_speed", "armor", "magic_resist",
            "hp_regen", "mana_regen")) {
            assertTrue(
                Pattern.compile("(?is)attr_key\\s*=\\s*'" + attr + "'")
                    .matcher(sqlNoLineComments)
                    .find()
                    || sql.contains("'" + attr + "'"),
                "must preflight or write attr_key=" + attr);
        }
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void seedsSelfContainedHeroAndBasicAttackGraphWithEmit() {
        assertContains("hero_draven");
        assertContains("provider_hero_draven_basic_attack");
        assertContains("ability_hero_draven_basic_attack");
        assertContains("phase_hero_draven_basic_attack_impact");
        assertContains("sequence_hero_draven_basic_attack_damage");
        assertContains("step_hero_draven_basic_attack_damage");
        assertContains("step_hero_draven_basic_attack_emit_hit");
        assertContains("event_ref_hero_draven_basic_attack_hit");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertContains("INSERT INTO public.ability_definitions");
        assertContains("INSERT INTO public.ability_phases");
        assertContains("INSERT INTO public.ability_phase_effect_sequences");
        assertContains("event_effect_details");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_basic_attack_damage'\\s*,\\s*"
                        + "'sequence_hero_draven_basic_attack_damage'\\s*,\\s*0\\s*,\\s*20150")
                .matcher(sql)
                .find(),
            "BA damage step must be order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_basic_attack_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_draven_basic_attack_damage'\\s*,\\s*1\\s*,\\s*20158")
                .matcher(sql)
                .find(),
            "emit_event step must be order 1 after damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_basic_attack_emit_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "'event_ref_hero_draven_basic_attack_hit'")
                .matcher(sql)
                .find(),
            "emit detail must use event/basic_attack_hit and stable event_ref");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_draven'\\s*,\\s*'provider_hero_draven_basic_attack'")
                .matcher(sql)
                .find(),
            "must mount BA provider to hero_draven");
        assertTrue(
            sql.contains("675") && sql.contains("361") && sql.contains("62")
                && sql.contains("0.679") && sql.contains("29") && sql.contains("30")
                && sql.contains("3.75") && sql.contains("8.05"),
            "must seed Draven level-1 panel numbers");
    }

    @Test
    void seedsActiveSpinningAxeWithManaCostAndCooldown() {
        assertContains("ability_hero_draven_q_spinning_axe");
        assertContains("provider_hero_draven_q_spinning_axe");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_draven_q_spinning_axe'\\s*,\\s*"
                        + "'provider_hero_draven_q_spinning_axe'\\s*,\\s*"
                        + "'spinning_axe'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q ability must be active 20130 with key spinning_axe");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_draven_q_spinning_axe'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Spinning Axe provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_draven'\\s*,\\s*'provider_hero_draven_q_spinning_axe'")
                .matcher(sql)
                .find(),
            "must mount Q provider to hero_draven");
        assertFalse(
            Pattern.compile(
                    "(?s)'hero_draven'\\s*,\\s*'provider_hero_draven_q_spinning_axe_flight'")
                .matcher(sql)
                .find(),
            "flight provider must not be permanently mounted");
        assertFalse(
            Pattern.compile(
                    "(?s)'step_hero_draven_basic_attack_emit_hit'[\\s\\S]{0,200}20205")
                .matcher(sql)
                .find(),
            "basic attack must not emit event/ability_started");
        assertContains("INSERT INTO public.ability_costs");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_draven_q_spinning_axe_mana'\\s*,\\s*"
                        + "'ability_hero_draven_q_spinning_axe'\\s*,\\s*NULL\\s*,\\s*"
                        + "'mana'\\s*,\\s*'q_mana_cost'")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 45 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_draven_q_spinning_axe'\\s*,\\s*"
                        + "'ability_hero_draven_q_spinning_axe'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 8000ms via ability_cooldowns");
        assertContains("\"value\":45");
        assertContains("\"value\":8000");
    }

    @Test
    void definesTimedReadyStateMaxTwoDuration5800RefreshDuration() {
        assertContains("spinning_axe_ready");
        assertContains("5800");
        assertContains("20190");
        assertTrue(
            Pattern.compile(
                    "(?s)'spinning_axe_ready'[\\s\\S]{0,120}20100[\\s\\S]{0,40}2"
                        + "[\\s\\S]{0,40}5800[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "ready state must be max 2 / duration 5800 / refresh 20190");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");
        assertContains("20250");
        assertContains(READY_ROOM);
    }

    @Test
    void abilityStartedAndAxeCaughtSourceOwnerListenersArmReadyCappedAtTwo() {
        assertContains("listener_hero_draven_q_spinning_axe_ability_started");
        assertContains("listener_hero_draven_q_spinning_axe_caught");
        assertContains("sequence_hero_draven_q_spinning_axe_arm");
        assertContains("step_hero_draven_q_spinning_axe_ready_arm");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_q_spinning_axe_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_q_spinning_axe_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_q_spinning_axe_caught'\\s*,\\s*"
                        + "20181\\s*,\\s*20216")
                .matcher(sql)
                .find(),
            "axe_caught listener must ALL-match 20216");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_q_spinning_axe_caught'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "axe_caught listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_ready_arm'\\s*,\\s*"
                        + "'sequence_hero_draven_q_spinning_axe_arm'\\s*,\\s*0\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*'spinning_axe_ready_room'")
                .matcher(sql)
                .find(),
            "ready arm must be order 0 state_change self gated by ready_room");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_ready_arm'\\s*,\\s*20250\\s*,\\s*"
                        + "'spinning_axe_ready'\\s*,\\s*'spinning_axe_ready_arm'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "ready arm detail must add +1 spinning_axe_ready via provider scope");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_q_spinning_axe_caught'[\\s\\S]{0,400}"
                        + "'sequence_hero_draven_q_spinning_axe_arm'")
                .matcher(sql)
                .find(),
            "axe_caught listener must reuse arm sequence");
    }

    @Test
    void basicAttackHitDamagesAppliesFlightThenConsumesReady() {
        assertContains("listener_hero_draven_q_spinning_axe_basic_attack_hit");
        assertContains("sequence_hero_draven_q_spinning_axe_proc");
        assertContains(READY_ARMED);
        assertContains(PROC_DAMAGE);
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_q_spinning_axe_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_q_spinning_axe_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_damage'\\s*,\\s*"
                        + "'sequence_hero_draven_q_spinning_axe_proc'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*'spinning_axe_ready_armed'")
                .matcher(sql)
                .find(),
            "damage must be order 0 to opponent with ready_armed condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_apply_flight'\\s*,\\s*"
                        + "'sequence_hero_draven_q_spinning_axe_proc'\\s*,\\s*1\\s*,\\s*"
                        + "20155\\s*,\\s*20110\\s*,\\s*'spinning_axe_ready_armed'")
                .matcher(sql)
                .find(),
            "apply_flight must be order 1 before consume");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_ready_consume'\\s*,\\s*"
                        + "'sequence_hero_draven_q_spinning_axe_proc'\\s*,\\s*2\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*'spinning_axe_ready_armed'")
                .matcher(sql)
                .find(),
            "ready consume must be order 2 state_change after apply_flight");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_damage'\\s*,\\s*"
                        + "'spinning_axe_proc_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "proc damage must be physical 20220 add policy copyable_on_hit=false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_ready_consume'\\s*,\\s*20250\\s*,\\s*"
                        + "'spinning_axe_ready'\\s*,\\s*'spinning_axe_ready_consume'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "ready consume detail must add -1 ready");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_apply_flight'\\s*,\\s*20230\\s*,\\s*"
                        + "'provider_hero_draven_q_spinning_axe_flight'")
                .matcher(sql)
                .find(),
            "apply_flight detail must apply flight provider via provider_action/apply");
        assertContains("\"value\":-1");
        assertContains("event.entry_source.attr.ad.resolved");
        assertContains("event.entry_source.attr.ad.base");
        assertContains("\"value\":60");
        assertContains("\"value\":1.15");
    }

    @Test
    void flightLifecycleIs1400TickAnd1401DurationEmittingAxeCaught() {
        assertContains("provider_hero_draven_q_spinning_axe_flight");
        assertContains("provider_lifecycles");
        assertContains("provider_tick_sequences");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_draven_q_spinning_axe_flight'[\\s\\S]{0,80}20121")
                .matcher(sql)
                .find(),
            "flight provider kind must be status 20121");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_draven_q_spinning_axe_flight'\\s*,\\s*"
                        + "'flight_duration_ms'\\s*,\\s*1\\s*,\\s*NULL\\s*,\\s*1400\\s*,\\s*1400")
                .matcher(sql)
                .find(),
            "flight lifecycle must be duration formula + tick/startDelay 1400");
        assertContains("\"value\":1401");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_flight_emit_caught'\\s*,\\s*"
                        + "'sequence_hero_draven_q_spinning_axe_flight_tick'\\s*,\\s*0\\s*,\\s*"
                        + "20158\\s*,\\s*20110")
                .matcher(sql)
                .find(),
            "flight tick must emit_event to self at order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_q_spinning_axe_flight_emit_caught'\\s*,\\s*20216\\s*,\\s*"
                        + "'event_ref_hero_draven_q_spinning_axe_caught'")
                .matcher(sql)
                .find(),
            "flight tick must emit event/axe_caught");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_draven_q_spinning_axe_flight'\\s*,\\s*"
                        + "'sequence_hero_draven_q_spinning_axe_flight_tick'")
                .matcher(sql)
                .find(),
            "flight must bind tick sequence");
    }

    @Test
    void preservesExactlyOneDetailLayoutByConstruction() {
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            countOccurrences(sql, "'step_hero_draven_q_spinning_axe_ready_arm'") >= 2,
            "ready_arm must appear in effect_steps and state_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_draven_q_spinning_axe_damage'") >= 2,
            "damage must appear in effect_steps and damage_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_draven_q_spinning_axe_ready_consume'") >= 2,
            "ready_consume must appear in effect_steps and state_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_draven_q_spinning_axe_apply_flight'") >= 2,
            "apply_flight must appear in effect_steps and provider_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_draven_q_spinning_axe_flight_emit_caught'") >= 2,
            "flight emit must appear in effect_steps and event_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_draven_basic_attack_emit_hit'") >= 2,
            "emit_hit must appear in effect_steps and event_effect_details");
        assertFalse(sql.contains("heal_effect_details"), "must not mix unrelated detail families");
    }

    @Test
    void excludesLandingWResetOtherRanksAndMigration() {
        assertFalse(
            Pattern.compile("(?i)ricochet|落地|落点|landing|cooldown_effect|blood_rush")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model landing position or W cooldown reset");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)ability_hero_draven_[wer]|spinning_axe_w|血色冲刺|清盘动作")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement W/E/R");
        assertFalse(
            Pattern.compile("(?i)migration|ALTER\\s+TABLE|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
    }

    @Test
    void citesWikiContractAndValidatesStableIds() {
        assertTrue(
            sql.contains("1400") && sql.contains("1401") && sql.contains("max 2"),
            "header/contract must cite 1400/1401 auto-catch and max 2");
        assertContains("missing reserved_type");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
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
