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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_twisted_fate_wild_cards_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_twisted_fate_wild_cards_primary_hit_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_twistedfate",
        "provider_hero_twistedfate_q_wild_cards_primary_hit",
        "ability_hero_twistedfate_q_wild_cards_primary_hit",
        "wild_cards",
        "phase_hero_twistedfate_q_wild_cards_primary_hit_impact",
        "sequence_hero_twistedfate_q_wild_cards_primary_hit_impact",
        "step_hero_twistedfate_q_wild_cards_primary_hit_damage",
        "cooldown_hero_twistedfate_q_wild_cards_primary_hit",
        "wild_cards_damage",
        "q_mana_cost",
        "q_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp", "mana", "ad", "ap", "attack_speed", "armor", "magic_resist",
        "hp_regen", "mana_regen");

    private static final String WILD_CARDS_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":240},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.50},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.85},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_target_single_hit; immediate_impact_scaffold; "
            + "magic_240_plus_0_50_bonus_ad_plus_0_85_ap; "
            + "no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget";

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
    void documentsSourceIdentityRevisionHashAndFrozenBoundary() {
        assertContains("hero_skill|hero_twistedfate|Q|万能牌");
        assertContains("twisted-fate-q-wild-cards-primary-hit-phase-a-v2");
        assertContains("Template:Data Twisted Fate/Q");
        assertContains("Template:Data Twisted Fate/Wild Cards");
        assertContains("1309741");
        assertContains("3950864");
        assertContains("2025-08-31T01:31:17Z");
        assertContains("1237");
        assertContains("9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597");
        assertContains("normalized/generic/twistedfate-q.json");
        assertContains(FROZEN_BOUNDARY);
        assertTrue(
            Pattern.compile("(?i)magic|魔法").matcher(sql).find()
                && (sql.contains("240 + 50% bonus AD + 85% AP")
                    || sql.contains("240 + 0.50")
                    || sql.contains("magic 240")),
            "seed comments must document source magic wording and rank5 240 +50% bAD +85% AP");
        assertTrue(
            sql.contains("bonus AD") || sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD via sub(resolved,base)");
        assertTrue(
            Pattern.compile("(?i)无截图|无.*OCR|screenshot|OCR").matcher(sql).find()
                && Pattern.compile("(?i)无截图|不含截图|无.*OCR|不.*OCR|without.*screenshot|"
                    + "no screenshot|无截图 / OCR")
                    .matcher(sql)
                    .find(),
            "seed comments must explicitly disclaim screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)screenshot|ocr|截图识别|光学字符")
                .matcher(sqlNoLineComments)
                .find(),
            "executable SQL must not cite screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon").matcher(sqlNoLineComments).find(),
            "must not add DDragon provenance in executable SQL");
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
            "wild cards primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "wild cards primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "wild cards primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "wild cards primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "wild cards primary-hit seed must not CREATE TABLE");
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
    void validatesExactlyNineAttrPreflightIncludingApAndProjectsReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        assertEquals(9, REQUIRED_ATTRS.size(), "contract expects exactly nine attrs");
        Matcher attrsArray = Pattern.compile(
                "(?is)v_required_attrs\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]")
            .matcher(sqlNoLineComments);
        assertTrue(attrsArray.find(), "must declare v_required_attrs array");
        String attrsBlock = attrsArray.group(1);
        for (String attr : REQUIRED_ATTRS) {
            assertTrue(
                attrsBlock.contains("'" + attr + "'"),
                "attr preflight must include exactly-nine key: " + attr);
        }
        assertTrue(
            Pattern.compile("(?i)'ap'").matcher(attrsBlock).find(),
            "attr preflight must require AP");
        assertEquals(
            9,
            countOccurrences(attrsBlock, "'") / 2,
            "attr preflight array must list exactly nine keys");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void ensuresSelfContainedHeroWithNineAttrsMana333WithoutTouchingStackedDeckGraph() {
        assertContains("hero_twistedfate");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (preserve Stacked Deck description)");
        assertTrue(
            sql.contains("604") && sql.contains("333") && sql.contains("52")
                && sql.contains("0.625") && sql.contains("24") && sql.contains("30")
                && sql.contains("1.1") && sql.contains("1.6"),
            "must seed Twisted Fate nine-attr bootstrap panel");
        assertTrue(
            Pattern.compile("(?s)'hero_twistedfate'\\s*,\\s*'hp'\\s*,\\s*604")
                .matcher(sql)
                .find(),
            "must preserve Stacked Deck hp=604");
        assertTrue(
            Pattern.compile("(?s)'hero_twistedfate'\\s*,\\s*'ad'\\s*,\\s*52")
                .matcher(sql)
                .find(),
            "must preserve Stacked Deck ad=52");
        assertTrue(
            Pattern.compile("(?s)'hero_twistedfate'\\s*,\\s*'ap'\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must seed ap base 0");
        assertTrue(
            Pattern.compile("(?s)'hero_twistedfate'\\s*,\\s*'attack_speed'\\s*,\\s*0\\.625")
                .matcher(sql)
                .find(),
            "must preserve Stacked Deck attack_speed=0.625");
        assertTrue(
            Pattern.compile("(?s)'hero_twistedfate'\\s*,\\s*'armor'\\s*,\\s*24")
                .matcher(sql)
                .find(),
            "must preserve Stacked Deck armor=24");
        assertTrue(
            Pattern.compile("(?s)'hero_twistedfate'\\s*,\\s*'magic_resist'\\s*,\\s*30")
                .matcher(sql)
                .find(),
            "must preserve Stacked Deck magic_resist=30");
        assertTrue(
            Pattern.compile("(?s)'hero_twistedfate'\\s*,\\s*'mana'\\s*,\\s*333")
                .matcher(sql)
                .find(),
            "must seed mana attr 333");
        assertTrue(
            Pattern.compile("(?s)'hero_twistedfate'\\s*,\\s*'hp_regen'\\s*,\\s*1\\.1")
                .matcher(sql)
                .find(),
            "must seed hp_regen 1.1");
        assertTrue(
            Pattern.compile("(?s)'hero_twistedfate'\\s*,\\s*'mana_regen'\\s*,\\s*1\\.6")
                .matcher(sql)
                .find(),
            "must seed mana_regen 1.6");
        assertFalse(
            Pattern.compile("(?is)'attack_range'|'move_speed'|'crit_chance'|'crit_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not overwrite unrelated Batch-B attributes");
        assertTrue(
            sql.contains("provider_hero_twistedfate_basic_attack")
                && sql.contains("provider_hero_twistedfate_stacked_deck"),
            "seed must document coexistence with basic and Stacked Deck providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_twistedfate_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_twistedfate_stacked_deck'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Stacked Deck provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_twistedfate_basic_attack'|"
                        + "'listener_hero_twistedfate_stacked_deck'|"
                        + "'step_hero_twistedfate_stacked_deck_proc_damage'|"
                        + "'modifier_hero_twistedfate_stacked_deck_attack_speed'|"
                        + "'sequence_hero_twistedfate_stacked_deck'|"
                        + "'step_hero_twistedfate_basic_attack_damage'|"
                        + "'step_hero_twistedfate_basic_attack_emit_hit'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write basic/Stacked Deck ability/listener/effect/modifier rows");
        assertFalse(
            Pattern.compile(
                    "(?is)missing game_entities hero_twistedfate|"
                        + "missing provider_hero_twistedfate_basic_attack|"
                        + "missing provider_hero_twistedfate_stacked_deck|"
                        + "Batch-B prerequisite|"
                        + "stacked_deck.*prerequisite")
                .matcher(sqlNoLineComments)
                .find(),
            "must not depend on prior basic/Stacked Deck provider publication");
        assertFalse(
            Pattern.compile("(?is)stacked_deck_hits")
                .matcher(sqlNoLineComments)
                .find(),
            "must not read/write Stacked Deck state in executable SQL");
    }

    @Test
    void mountsDedicatedWildCardsPrimaryHitProviderToHeroTwistedFate() {
        assertContains("provider_hero_twistedfate_q_wild_cards_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_twistedfate_q_wild_cards_primary_hit'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Wild Cards primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_twistedfate'\\s*,\\s*"
                        + "'provider_hero_twistedfate_q_wild_cards_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Wild Cards primary-hit provider to hero_twistedfate");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Wild Cards primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Wild Cards primary-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    @Test
    void seedsActiveWildCardsWithMana100AndCooldown5000Ms() {
        assertContains("ability_hero_twistedfate_q_wild_cards_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_twistedfate_q_wild_cards_primary_hit'\\s*,\\s*"
                        + "'provider_hero_twistedfate_q_wild_cards_primary_hit'\\s*,\\s*"
                        + "'wild_cards'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key wild_cards");
        assertContains("q_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_twistedfate_q_wild_cards_primary_hit");
        assertContains("q_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":5000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_twistedfate_q_wild_cards_primary_hit'\\s*,\\s*"
                        + "'ability_hero_twistedfate_q_wild_cards_primary_hit'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 5000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndMagicBonusAdApDamage() {
        assertContains(WILD_CARDS_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":240");
        assertContains("\"value\":0.50");
        assertContains("\"value\":0.85");
        assertContains("\"op\":\"sub\"");
        assertFalse(
            Pattern.compile("(?is)\\b20220\\b").matcher(sqlNoLineComments).find(),
            "executable SQL must not use physical damage type 20220");
        assertContains("phase_hero_twistedfate_q_wild_cards_primary_hit_impact");
        assertContains("sequence_hero_twistedfate_q_wild_cards_primary_hit_impact");
        assertContains("step_hero_twistedfate_q_wild_cards_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_twistedfate_q_wild_cards_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_twistedfate_q_wild_cards_primary_hit'\\s*,\\s*0\\s*,\\s*"
                        + "20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_twistedfate_q_wild_cards_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_twistedfate_q_wild_cards_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_q_wild_cards_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_twistedfate_q_wild_cards_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Wild Cards damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_q_wild_cards_primary_hit_damage'\\s*,\\s*"
                        + "'wild_cards_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Wild Cards damage must be magic 20221 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_twistedfate_q_wild_cards_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Wild Cards primary-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesCastDelayFanConeProjectileGeometryCollisionMultitargetAndCoupling() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_state_fields");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.state_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write state_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write modifier_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write modifier_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_modifiers");
        assertFalse(
            Pattern.compile(
                    "(?i)cast.?duration|cast.?delay|cast.?time|"
                        + "phase_hero_twistedfate_q_wild_cards_primary_hit_cast|"
                        + "projectile|missile|travel|collision|geometry|"
                        + "target.?location|spellshield|cone|fan.?of|"
                        + "three.?card|三张牌|"
                        + "multi.?target|多目标|all.?enemies|\\brepeat\\b|"
                        + "basic_attack_hit|emit_event|equipment|loadout|"
                        + "aoe|area.?of.?effect")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded cast-delay/fan/cone/projectile/geometry/"
                + "collision/multitarget/equipment surfaces");
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
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "must not destructively replace existing Twisted Fate providers");
        assertTrue(
            sql.contains("cast delay") || sql.contains("cast-delay")
                || sql.contains("Wiki cast"),
            "seed comments must document exclusion of cast delay");
        assertTrue(
            sql.contains("projectile") || sql.contains("geometry") || sql.contains("cone")
                || sql.contains("fan"),
            "seed comments must document exclusion of fan/cone/projectile/geometry");
        assertTrue(
            sql.contains("collision") || sql.contains("pass") || sql.contains("once-per-pass"),
            "seed comments must document exclusion of collision/pass fidelity");
        assertTrue(
            sql.contains("multi-target") || sql.contains("multitarget")
                || sql.contains("AOE") || sql.contains("all-enemies"),
            "seed comments must document exclusion of AOE/multitarget");
        assertTrue(
            sql.contains("Stacked Deck") || sql.contains("stacked_deck"),
            "seed comments must document exclusion of Stacked Deck coupling");
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
