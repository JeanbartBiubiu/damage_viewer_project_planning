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
 * Static contract for {@code lol_generic_xayah_deadly_plumage_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericXayahDeadlyPlumageSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_xayah",
        "provider_hero_xayah_w_deadly_plumage",
        "ability_hero_xayah_w_deadly_plumage",
        "deadly_plumage",
        "cost_hero_xayah_w_deadly_plumage_mana",
        "cooldown_hero_xayah_w_deadly_plumage",
        "listener_hero_xayah_w_deadly_plumage_ability_started",
        "sequence_hero_xayah_w_deadly_plumage_arm",
        "step_hero_xayah_w_deadly_plumage_active_arm",
        "modifier_hero_xayah_w_deadly_plumage_attack_speed",
        "deadly_plumage_active",
        "deadly_plumage_active_arm",
        "deadly_plumage_attack_speed",
        "w_mana_cost",
        "w_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20130, 20160, 20172, 20173, 20181, 20190, 20205,
        20212, 20250);

    private static final String AS_BONUS =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.55},"
            + "{\"op\":\"read\",\"path\":\"provider.state.deadly_plumage_active\"}]}";

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
            "deadly plumage seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "deadly plumage seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "deadly plumage seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "deadly plumage seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "deadly plumage seed must not CREATE TABLE");
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
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Xayah)");
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
            sql.contains("630") && sql.contains("340") && sql.contains("60")
                && sql.contains("0.658") && sql.contains("25") && sql.contains("30")
                && sql.contains("3.25") && sql.contains("8.25"),
            "must seed Xayah level-1 panel numbers");
        assertContains("INSERT INTO public.resource_definitions");
        assertContains("INSERT INTO public.entity_resource_values");
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must project resource_definitions.mana");
        assertTrue(
            Pattern.compile("(?s)'hero_xayah'\\s*,\\s*'mana'\\s*,\\s*340\\s*,\\s*340")
                .matcher(sql)
                .find(),
            "must seed entity_resource_values mana 340/340");
    }

    @Test
    void mountsIndependentDeadlyPlumageProviderCoexistingWithFutureBasicAttackAndFeathers() {
        assertContains("provider_hero_xayah_w_deadly_plumage");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_xayah'\\s*,\\s*'provider_hero_xayah_w_deadly_plumage'")
                .matcher(sql)
                .find(),
            "must mount deadly plumage provider to hero_xayah");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_xayah_w_deadly_plumage'[\\s\\S]{0,80}20120")
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
            sql.contains("provider_hero_xayah_basic_attack")
                && (sql.contains("feather") || sql.contains("羽刃")),
            "seed must document coexistence with future basic attack / feather providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_xayah_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_xayah_.*feather'|ability_hero_xayah_[qer]")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write feather / QER provider identity rows");
    }

    @Test
    void seedsActiveAbilityFortyManaAndFourteenSecondCooldown() {
        assertContains("ability_hero_xayah_w_deadly_plumage");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_xayah_w_deadly_plumage'\\s*,\\s*"
                        + "'provider_hero_xayah_w_deadly_plumage'\\s*,\\s*"
                        + "'deadly_plumage'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "W must be active ability with stable key deadly_plumage");
        assertContains("cost_hero_xayah_w_deadly_plumage_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("w_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":40}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_xayah_w_deadly_plumage_mana'\\s*,\\s*"
                        + "'ability_hero_xayah_w_deadly_plumage'\\s*,\\s*NULL\\s*,\\s*"
                        + "'mana'\\s*,\\s*'w_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "W mana cost must be ability-level 40 via ability_costs");
        assertContains("cooldown_hero_xayah_w_deadly_plumage");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("w_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":14000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_xayah_w_deadly_plumage'\\s*,\\s*"
                        + "'ability_hero_xayah_w_deadly_plumage'\\s*,\\s*"
                        + "'w_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "W cooldown must be 14000ms via ability_cooldowns");
    }

    @Test
    void definesTimedDeadlyPlumageActiveAndStateDrivenAttackSpeedPercentAdd() {
        assertTrue(
            Pattern.compile(
                    "(?s)'deadly_plumage_active'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1"
                        + "[\\s\\S]{0,20}4000[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "deadly_plumage_active max1 / 4000ms / refresh_duration");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");
        assertContains(AS_BONUS);
        assertContains("\"value\":0.55");
        assertContains("20173");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_xayah_w_deadly_plumage_attack_speed'[\\s\\S]{0,300}"
                        + "'attack_speed'[\\s\\S]{0,120}20173\\s*,\\s*"
                        + "'deadly_plumage_attack_speed'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "AS modifier must be percent_add with NULL condition_formula_key");
    }

    @Test
    void abilityStartedListenerArmsDeadlyPlumageViaAbilityTypeMatcherNotAbilityRef() {
        assertContains("listener_hero_xayah_w_deadly_plumage_ability_started");
        assertContains("sequence_hero_xayah_w_deadly_plumage_arm");
        assertContains("step_hero_xayah_w_deadly_plumage_active_arm");
        assertContains("62012");
        assertContains("ability/xayah_deadly_plumage");
        assertTrue(
            Pattern.compile("(?i)type_id=62012 already bound").matcher(sql).find(),
            "must dual-unique fail-closed guard ability/xayah_deadly_plumage 62012");
        assertTrue(
            Pattern.compile("(?i)type_key=ability/xayah_deadly_plumage already bound")
                .matcher(sql)
                .find(),
            "must dual-unique fail-closed guard ability/xayah_deadly_plumage type_key");
        assertTrue(
            Pattern.compile(
                    "(?is)type_id\\s*=\\s*62012[\\s\\S]{0,400}"
                        + "reserved_type_id\\s+IS\\s+NOT\\s+NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "62012 type-id fail-closed guard must treat non-null reserved_type_id as conflict");
        assertTrue(
            Pattern.compile(
                    "(?s)62012\\s*,\\s*'ability/xayah_deadly_plumage'[\\s\\S]{0,400}NULL")
                .matcher(sql)
                .find(),
            "62012 must bind with reserved_type_id=NULL");
        assertTrue(
            Pattern.compile(
                    "(?s)62012\\s*,\\s*'ability'\\s*,\\s*"
                        + "'ability_hero_xayah_w_deadly_plumage'")
                .matcher(sql)
                .find(),
            "must type_relations 62012 → ability_hero_xayah_w_deadly_plumage");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_xayah_w_deadly_plumage_ability_started'\\s*,\\s*"
                        + "'provider_hero_xayah_w_deadly_plumage'\\s*,\\s*"
                        + "'deadly_plumage_on_ability_started'\\s*,\\s*20205\\s*,\\s*"
                        + "NULL")
                .matcher(sql)
                .find(),
            "listener ability_id must be NULL (AbilityRef is not an event filter)");
        assertFalse(
            Pattern.compile(
                    "(?s)'listener_hero_xayah_w_deadly_plumage_ability_started'[\\s\\S]{0,220}"
                        + "'ability_hero_xayah_w_deadly_plumage'")
                .matcher(sqlNoLineComments)
                .find(),
            "executable listener row must not bind ability_id to W ability");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_xayah_w_deadly_plumage_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_xayah_w_deadly_plumage_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_xayah_w_deadly_plumage_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*62012")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 62012 ability/xayah_deadly_plumage");
        assertEquals(
            3,
            countOccurrences(
                sqlNoLineComments,
                "'listener_hero_xayah_w_deadly_plumage_ability_started', 20181,"),
            "W listener must declare exactly three ALL match types");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_w_deadly_plumage_active_arm'\\s*,\\s*20250\\s*,\\s*"
                        + "'deadly_plumage_active'\\s*,\\s*'deadly_plumage_active_arm'\\s*,\\s*"
                        + "20172")
                .matcher(sql)
                .find(),
            "listener sequence must override/set deadly_plumage_active=1");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            countOccurrences(sql, "'step_hero_xayah_w_deadly_plumage_active_arm'") >= 2,
            "arm step must appear in effect_steps and state_effect_details");
        assertTrue(
            sql.contains("{\"op\":\"const\",\"value\":40}")
                && sql.contains("{\"op\":\"const\",\"value\":14000}")
                && sql.contains(AS_BONUS),
            "W mana/CD/AS formulas must remain preserved");
        assertTrue(
            Pattern.compile(
                    "(?s)'deadly_plumage_active'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1"
                        + "[\\s\\S]{0,20}4000[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "W timed state max1/4000ms/refresh must remain preserved");
        assertTrue(
            sql.contains("AbilityRef") || sql.contains("castAbilityAt")
                || sql.contains("不是事件过滤"),
            "seed must document why listener.ability_id must stay NULL");
    }

    @Test
    void excludesSecondaryFeatherTwentyPercentCopyMoveSpeedRakanAndOtherRanks() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_phases\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_phases");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write damage_effect_details (no forged secondary feather 20% OAD)");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?i)0\\.20|\"value\"\\s*:\\s*20|bonusdamagepercent|"
                        + "secondary.?feather|次级羽刃|original.?attack.?damage|"
                        + "on.?hit|phantom|"
                        + "move_speed|移速|rakan|洛|"
                        + "ability_hero_xayah_[qer]")
                .matcher(sqlNoLineComments)
                .find(),
            "must not forge secondary feather 20% OAD / MS / Rakan; remaining gap documented in comments only");
        assertTrue(
            Pattern.compile("(?i)remaining\\s+gap|次级羽刃").matcher(sql).find()
                && Pattern.compile("(?i)20%|0\\.20|original\\s+attack\\s+damage")
                    .matcher(sql)
                    .find(),
            "seed comments must document remaining gap: 20% settled BA copy excluding on-hit/phantom");
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
    void citesMerakiXayahJsonAndValidatesStableIds() {
        assertContains("Xayah.json");
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
