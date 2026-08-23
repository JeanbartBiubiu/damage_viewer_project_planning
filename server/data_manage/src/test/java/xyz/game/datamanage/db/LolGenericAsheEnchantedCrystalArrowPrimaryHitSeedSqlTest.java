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
 * Static contract for {@code lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericAsheEnchantedCrystalArrowPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_ashe",
        "provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit",
        "ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit",
        "enchanted_crystal_arrow",
        "phase_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact",
        "sequence_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact",
        "step_hero_ashe_r_enchanted_crystal_arrow_primary_hit_damage",
        "cooldown_hero_ashe_r_enchanted_crystal_arrow_primary_hit",
        "enchanted_crystal_arrow_damage",
        "r_mana_cost",
        "r_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp", "mana", "ad", "ap", "attack_speed", "armor", "magic_resist",
        "hp_regen", "mana_regen");

    private static final String ENCHANTED_CRYSTAL_ARROW_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":600},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.20},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank3_primary_target_single_hit; immediate_impact_scaffold; "
            + "magic_600_plus_1_20_ap; "
            + "no_cast_delay_projectile_travel_collision_geometry_distance_"
            + "stun_aoe_frost_or_sight";

    private static final String CANONICAL_SHA =
        "1d9ccefa98a41e57a088e76aaca16f7a78141e7373616520e2d6ba13f450664f";

    private static final String LOCAL_MATERIALIZATION_SHA =
        "2bce161be04aa2cbe770a7402651929cfb3a7781d7a7ca828b93d1de68d4bb28";

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
        assertContains("hero_skill|hero_ashe|R|魔法水晶箭");
        assertContains("ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1");
        assertContains("Template:Data Ashe/R");
        assertContains("Template:Data Ashe/Enchanted Crystal Arrow");
        assertContains("1306811");
        assertContains("4026934");
        assertContains("2026-06-10T19:09:50Z");
        assertContains("2394");
        assertContains(CANONICAL_SHA);
        assertContains("2393");
        assertContains(LOCAL_MATERIALIZATION_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("既不裁剪其末端 LF") || sql.contains("neither trimming")
                || sql.contains("末端 LF"),
            "seed comments must record that trimming terminal LF does not reproduce canonical");
        assertTrue(
            sql.contains("也不插入 CR") || sql.contains("inserting CR")
                || sql.contains("插入 CR"),
            "seed comments must record that inserting CR does not reproduce canonical");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertContains("normalized/generic/ashe-r.json");
        assertContains(FROZEN_BOUNDARY);
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
            Pattern.compile("(?i)ddragon|data.?dragon|meraki")
                .matcher(sqlNoLineComments)
                .find(),
            "must not add DDragon/Meraki provenance in executable SQL");
        assertContains("20260723");
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
            "enchanted crystal arrow primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "enchanted crystal arrow primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "enchanted crystal arrow primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "enchanted crystal arrow primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "enchanted crystal arrow primary-hit seed must not CREATE TABLE");
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
    void ensuresSelfContainedHeroWithNineAttrsMana280WithoutTouchingQwGraphs() {
        assertContains("hero_ashe");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (preserve existing Q/W descriptions)");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'hp'\\s*,\\s*610")
                .matcher(sql)
                .find(),
            "must preserve Ashe Q/W hp=610");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'mana'\\s*,\\s*280")
                .matcher(sql)
                .find(),
            "must preserve Ashe Q/W mana=280");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'ad'\\s*,\\s*59")
                .matcher(sql)
                .find(),
            "must preserve Ashe Q/W ad=59");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'ap'\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must seed ap base 0 (R-needed only; AP200 is fixture-only)");
        assertFalse(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'ap'\\s*,\\s*200")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not write AP200 fixture value");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'attack_speed'\\s*,\\s*0\\.658")
                .matcher(sql)
                .find(),
            "must preserve Ashe Q/W attack_speed=0.658");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'armor'\\s*,\\s*26")
                .matcher(sql)
                .find(),
            "must preserve Ashe Q/W armor=26");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'magic_resist'\\s*,\\s*30")
                .matcher(sql)
                .find(),
            "must preserve Ashe Q/W magic_resist=30");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'hp_regen'\\s*,\\s*3\\.5")
                .matcher(sql)
                .find(),
            "must preserve Ashe Q/W hp_regen=3.5");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'mana_regen'\\s*,\\s*7")
                .matcher(sql)
                .find(),
            "must preserve Ashe Q/W mana_regen=7");
        assertFalse(
            Pattern.compile("(?is)'attack_range'|'move_speed'|'crit_chance'|'crit_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not overwrite unrelated attributes");
        assertTrue(
            sql.contains("provider_hero_ashe_rangers_focus")
                && sql.contains("provider_hero_ashe_w_volley"),
            "seed must document coexistence with Ashe Q and W providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_ashe_rangers_focus'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Rangers Focus provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_ashe_w_volley'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Volley provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_ashe_q_rangers_focus'|"
                        + "'ability_hero_ashe_basic_attack'|"
                        + "'ability_hero_ashe_w_volley'|"
                        + "'phase_hero_ashe_w_volley_impact'|"
                        + "'step_hero_ashe_w_volley_damage'|"
                        + "'listener_hero_ashe'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Ashe Q/W ability/listener/effect rows");
        assertFalse(
            Pattern.compile(
                    "(?is)missing game_entities hero_ashe|"
                        + "missing provider_hero_ashe_rangers_focus|"
                        + "missing provider_hero_ashe_w_volley|"
                        + "rangers_focus.*prerequisite|"
                        + "volley.*prerequisite")
                .matcher(sqlNoLineComments)
                .find(),
            "must not depend on prior Ashe Q/W provider publication");
    }

    @Test
    void mountsDedicatedEnchantedCrystalArrowPrimaryHitProviderToHeroAshe() {
        assertContains("provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Enchanted Crystal Arrow primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_ashe'\\s*,\\s*"
                        + "'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Enchanted Crystal Arrow primary-hit provider to hero_ashe");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Enchanted Crystal Arrow primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Enchanted Crystal Arrow primary-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    @Test
    void seedsActiveEnchantedCrystalArrowWithMana100AndCooldown60000Ms() {
        assertContains("ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit'\\s*,\\s*"
                        + "'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit'\\s*,\\s*"
                        + "'enchanted_crystal_arrow'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key enchanted_crystal_arrow");
        assertContains("r_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_ashe_r_enchanted_crystal_arrow_primary_hit");
        assertContains("r_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":60000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_ashe_r_enchanted_crystal_arrow_primary_hit'\\s*,\\s*"
                        + "'ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 60000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndMagicDamage() {
        assertContains(ENCHANTED_CRYSTAL_ARROW_DAMAGE);
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":600");
        assertContains("\"value\":1.20");
        assertContains("phase_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact");
        assertContains("sequence_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact");
        assertContains("step_hero_ashe_r_enchanted_crystal_arrow_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_r_enchanted_crystal_arrow_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Enchanted Crystal Arrow damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_r_enchanted_crystal_arrow_primary_hit_damage'\\s*,\\s*"
                        + "'enchanted_crystal_arrow_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*"
                        + "false")
                .matcher(sql)
                .find(),
            "Enchanted Crystal Arrow damage must be magic 20221 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_ashe_r_enchanted_crystal_arrow_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Enchanted Crystal Arrow primary-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesCastTimingProjectileTravelStunAoeFrostSightAndCoupling() {
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
            Pattern.compile(
                    "(?i)phase_hero_ashe_r_enchanted_crystal_arrow_primary_hit_cast|"
                        + "cast_duration_formula|starts_on_phase_id\\s*=\\s*'phase_")
                .matcher(sqlNoLineComments)
                .find(),
            "must not invent cast-delay phase implementation rows");
        assertFalse(
            Pattern.compile(
                    "(?i)INSERT\\s+INTO\\s+public\\.(projectile|geometry|location|"
                        + "aoe|area|field|control|stun|sight)_")
                .matcher(sqlNoLineComments)
                .find(),
            "must not insert projectile/geometry/AOE/control/sight implementation tables");
        assertFalse(
            Pattern.compile(
                    "(?i)basic_attack_hit|emit_event|equipment|loadout|"
                        + "on.?hit.?coupl|spellshield|frost.?shot")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model on-hit/equipment/Frost/spellshield coupling in executable SQL");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[12]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)0\\.25|cast\\s*time\\s*=\\s*0\\.25")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode Wiki cast time 0.25 in executable SQL");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "must not destructively replace existing Ashe providers");
        assertTrue(
            sql.contains("cast time = 0.25") || sql.contains("cast time=0.25")
                || sql.contains("0.25"),
            "seed comments must document exclusion of Wiki cast time 0.25");
        assertTrue(
            sql.contains("Effect at cast time start"),
            "seed comments must document exclusion of Effect at cast time start");
        assertTrue(
            sql.contains("projectile") || sql.contains("travel") || sql.contains("collision"),
            "seed comments must document exclusion of projectile/travel/collision");
        assertTrue(
            sql.contains("stun") || sql.contains("distance-traveled")
                || sql.contains("crowd-control"),
            "seed comments must document exclusion of distance stun/control");
        assertTrue(
            sql.contains("AOE") || sql.contains("surrounding") || sql.contains("aoe"),
            "seed comments must document exclusion of surrounding AOE");
        assertTrue(
            sql.contains("Frost Shot") || sql.contains("Frost") || sql.contains("slow"),
            "seed comments must document exclusion of Frost Shot/slow");
        assertTrue(
            sql.contains("sight") || sql.contains("reveal"),
            "seed comments must document exclusion of sight/reveal");
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
