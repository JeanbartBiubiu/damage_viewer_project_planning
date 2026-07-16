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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_draven_blood_rush_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericDravenBloodRushSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_draven_blood_rush_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_draven",
        "provider_hero_draven_w_blood_rush",
        "ability_hero_draven_w_blood_rush",
        "blood_rush",
        "cost_hero_draven_w_blood_rush_mana",
        "cooldown_hero_draven_w_blood_rush",
        "listener_hero_draven_w_blood_rush_ability_started",
        "sequence_hero_draven_w_blood_rush_arm",
        "step_hero_draven_w_blood_rush_active_arm",
        "modifier_hero_draven_w_blood_rush_attack_speed",
        "blood_rush_active",
        "blood_rush_active_arm",
        "blood_rush_attack_speed",
        "w_mana_cost",
        "w_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20130, 20160, 20172, 20173, 20181, 20190, 20205,
        20212, 20250);

    private static final String AS_BONUS =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.40},"
            + "{\"op\":\"read\",\"path\":\"provider.state.blood_rush_active\"}]}";

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
            "blood rush seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "blood rush seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "blood rush seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "blood rush seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "blood rush seed must not CREATE TABLE");
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
            Pattern.compile("(?i)single_attacker_dps").matcher(sqlNoLineComments).find(),
            "must not reference single_attacker_dps");
    }

    @Test
    void ensuresSelfContainedHeroAttrsAndManaWithoutOverwritingUnrelatedProviders() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile("(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Draven)");
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
        assertTrue(
            sql.contains("675") && sql.contains("361") && sql.contains("62")
                && sql.contains("0.679") && sql.contains("29") && sql.contains("30")
                && sql.contains("3.75") && sql.contains("8.05"),
            "must seed Draven level-1 panel numbers");
        assertContains("INSERT INTO public.resource_definitions");
        assertContains("INSERT INTO public.entity_resource_values");
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must project resource_definitions.mana");
        assertTrue(
            Pattern.compile("(?s)'hero_draven'\\s*,\\s*'mana'\\s*,\\s*361\\s*,\\s*361")
                .matcher(sql)
                .find(),
            "must seed entity_resource_values mana 361/361");
    }

    @Test
    void mountsIndependentBloodRushProviderCoexistingWithQAndBasicAttack() {
        assertContains("provider_hero_draven_w_blood_rush");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_draven'\\s*,\\s*'provider_hero_draven_w_blood_rush'")
                .matcher(sql)
                .find(),
            "must mount blood rush provider to hero_draven");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_draven_w_blood_rush'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "provider kind must be passive 20120");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once via entity_provider_mounts");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (W only)");
        assertTrue(
            sql.contains("provider_hero_draven_q_spinning_axe")
                && sql.contains("provider_hero_draven_basic_attack"),
            "seed must document coexistence with Q and basic attack providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_draven_q_spinning_axe'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Q Spinning Axe provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_draven_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'ability_hero_draven_q_spinning_axe'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Q ability rows");
    }

    @Test
    void seedsActiveAbilityTwentyManaAndTwelveSecondCooldown() {
        assertContains("ability_hero_draven_w_blood_rush");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_draven_w_blood_rush'\\s*,\\s*"
                        + "'provider_hero_draven_w_blood_rush'\\s*,\\s*"
                        + "'blood_rush'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "W must be active ability with stable key blood_rush");
        assertContains("cost_hero_draven_w_blood_rush_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("w_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":20}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_draven_w_blood_rush_mana'\\s*,\\s*"
                        + "'ability_hero_draven_w_blood_rush'\\s*,\\s*NULL\\s*,\\s*"
                        + "'mana'\\s*,\\s*'w_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "W mana cost must be ability-level 20 via ability_costs");
        assertContains("cooldown_hero_draven_w_blood_rush");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("w_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":12000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_draven_w_blood_rush'\\s*,\\s*"
                        + "'ability_hero_draven_w_blood_rush'\\s*,\\s*"
                        + "'w_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "W cooldown must be 12000ms via ability_cooldowns");
    }

    @Test
    void definesTimedBloodRushActiveAndStateDrivenAttackSpeedPercentAdd() {
        assertTrue(
            Pattern.compile(
                    "(?s)'blood_rush_active'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1"
                        + "[\\s\\S]{0,20}3000[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "blood_rush_active max1 / 3000ms / refresh_duration");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");
        assertContains(AS_BONUS);
        assertContains("\"value\":0.40");
        assertContains("20173");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_draven_w_blood_rush_attack_speed'[\\s\\S]{0,300}"
                        + "'attack_speed'[\\s\\S]{0,120}20173\\s*,\\s*"
                        + "'blood_rush_attack_speed'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "AS modifier must be percent_add with NULL condition_formula_key");
    }

    @Test
    void abilityStartedListenerArmsBloodRushForSameAbilityAndSourceOwner() {
        assertContains("listener_hero_draven_w_blood_rush_ability_started");
        assertContains("sequence_hero_draven_w_blood_rush_arm");
        assertContains("step_hero_draven_w_blood_rush_active_arm");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_w_blood_rush_ability_started'\\s*,\\s*"
                        + "'provider_hero_draven_w_blood_rush'\\s*,\\s*"
                        + "'blood_rush_on_ability_started'\\s*,\\s*20205\\s*,\\s*"
                        + "'ability_hero_draven_w_blood_rush'")
                .matcher(sql)
                .find(),
            "listener must bind ability_started to the same W ability");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_w_blood_rush_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_draven_w_blood_rush_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_w_blood_rush_active_arm'\\s*,\\s*20250\\s*,\\s*"
                        + "'blood_rush_active'\\s*,\\s*'blood_rush_active_arm'\\s*,\\s*"
                        + "20172")
                .matcher(sql)
                .find(),
            "listener sequence must override/set blood_rush_active=1");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            countOccurrences(sql, "'step_hero_draven_w_blood_rush_active_arm'") >= 2,
            "arm step must appear in effect_steps and state_effect_details");
    }

    @Test
    void excludesMoveSpeedDecayAxeCatchRefreshOtherRanksAndDamageSurfaces() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_phases\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_phases");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write damage_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?i)move_speed|移速|ghost|幽灵|衰减|decay|"
                        + "axe.?catch|接住|接斧|cooldown.?reset|refresh.?cooldown|"
                        + "刷新\\s*W|刷新.*cooldown|"
                        + "ability_hero_draven_[qer]|spinning_axe_ready")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded Blood Rush surfaces (MS/decay/axe-catch CD refresh)");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
    }

    @Test
    void citesMerakiDravenJsonAndValidatesStableIds() {
        assertContains("Draven.json");
        assertContains("merakianalytics");
        assertContains("missing reserved_type");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
        assertContains("partial");
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
