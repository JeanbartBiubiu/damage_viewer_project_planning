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
 * Static contract for {@code lol_generic_graves_collateral_damage_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_graves_collateral_damage_primary_hit_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_graves",
        "provider_hero_graves_r_collateral_damage_primary_hit",
        "ability_hero_graves_r_collateral_damage_primary_hit",
        "collateral_damage",
        "phase_hero_graves_r_collateral_damage_primary_hit_impact",
        "sequence_hero_graves_r_collateral_damage_primary_hit_impact",
        "step_hero_graves_r_collateral_damage_primary_hit_damage",
        "cooldown_hero_graves_r_collateral_damage_primary_hit",
        "collateral_damage_damage",
        "r_mana_cost",
        "r_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp", "mana", "ad", "ap", "attack_speed", "armor", "magic_resist",
        "hp_regen", "mana_regen");

    private static final String COLLATERAL_DAMAGE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":575},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.50},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank3_primary_target_single_hit; immediate_impact_scaffold; "
            + "physical_575_plus_1_50_bonus_ad; "
            + "no_cast_delay_recoil_projectile_geometry_line_multitarget_"
            + "explosion_cone_or_reduced_damage";

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
    void documentsSourceIdentityFileBoundaryAndFrozenPlan() {
        assertContains("lol_generic_graves_collateral_damage_primary_hit_seed.sql");
        assertContains("hero_skill|hero_graves|R|终极爆弹");
        assertContains("graves-r-collateral-damage-primary-hit-phase-a-v2");
        assertContains("Template:Data Graves/R");
        assertContains("Template:Data Graves/Collateral Damage");
        assertContains("normalized/generic/graves-r.json");
        assertContains(FROZEN_BOUNDARY);
        assertContains("raw656");
        assertContains("mitigated328");
        assertContains("bonus AD54");
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
            "collateral damage primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "collateral damage primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "collateral damage primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "collateral damage primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "collateral damage primary-hit seed must not CREATE TABLE");
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
    void ensuresSelfContainedHeroWithNineAttrsMana325WithoutTouchingPewGraphs() {
        assertContains("hero_graves");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (preserve existing P/E/W descriptions)");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'hp'\\s*,\\s*625")
                .matcher(sql)
                .find(),
            "must preserve Graves P/E/W hp=625");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'mana'\\s*,\\s*325")
                .matcher(sql)
                .find(),
            "must preserve Graves P/E/W mana=325");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'ad'\\s*,\\s*66")
                .matcher(sql)
                .find(),
            "must preserve Graves P/E/W ad=66");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'ap'\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must seed ap base 0 (fixture/bootstrap; flat+54 AD is fixture-only)");
        assertFalse(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'ad'\\s*,\\s*120")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not write resolved-AD120 fixture value");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'attack_speed'\\s*,\\s*0\\.475")
                .matcher(sql)
                .find(),
            "must preserve Graves P/E/W attack_speed=0.475");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'armor'\\s*,\\s*33")
                .matcher(sql)
                .find(),
            "must preserve Graves P/E/W armor=33");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'magic_resist'\\s*,\\s*30")
                .matcher(sql)
                .find(),
            "must preserve Graves P/E/W magic_resist=30");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'hp_regen'\\s*,\\s*8")
                .matcher(sql)
                .find(),
            "must preserve Graves P/E/W hp_regen=8");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'mana_regen'\\s*,\\s*8")
                .matcher(sql)
                .find(),
            "must preserve Graves P/E/W mana_regen=8");
        assertFalse(
            Pattern.compile("(?is)'attack_range'|'move_speed'|'crit_chance'|'crit_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not overwrite unrelated attributes");
        assertFalse(
            Pattern.compile("(?is)'bonus_armor'|'bonus_magic_resist'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not ensure or rewrite E bonus-resistance definitions/values");
        assertFalse(
            Pattern.compile("(?is)'true_grit_stacks'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not read/write Quickdraw true_grit_stacks in executable SQL");
        assertTrue(
            sql.contains("provider_hero_graves_new_destiny")
                && sql.contains("provider_hero_graves_quickdraw_max_stack")
                && sql.contains("provider_hero_graves_w_smoke_screen_primary_hit"),
            "seed must document coexistence with Graves P, E, and W providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_graves_new_destiny'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace New Destiny provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_graves_quickdraw_max_stack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Quickdraw provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_graves_w_smoke_screen_primary_hit'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Smoke Screen provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_graves_basic_attack'|"
                        + "'ability_hero_graves_quickdraw'|"
                        + "'ability_hero_graves_w_smoke_screen_primary_hit'|"
                        + "'modifier_hero_graves_quickdraw_armor'|"
                        + "'modifier_hero_graves_quickdraw_bonus_armor'|"
                        + "'modifier_hero_graves_quickdraw_magic_resist'|"
                        + "'modifier_hero_graves_quickdraw_bonus_magic_resist'|"
                        + "'step_hero_graves_quickdraw_true_grit_max'|"
                        + "'sequence_hero_graves_quickdraw_max_stack'|"
                        + "'listener_hero_graves'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Graves P/E/W ability/listener/effect/modifier rows");
        assertFalse(
            Pattern.compile(
                    "(?is)missing game_entities hero_graves|"
                        + "missing provider_hero_graves_new_destiny|"
                        + "missing provider_hero_graves_quickdraw|"
                        + "missing provider_hero_graves_w_smoke_screen|"
                        + "new_destiny.*prerequisite|"
                        + "quickdraw.*prerequisite|"
                        + "smoke_screen.*prerequisite")
                .matcher(sqlNoLineComments)
                .find(),
            "must not depend on prior Graves P/E/W provider publication");
    }

    @Test
    void mountsDedicatedCollateralDamagePrimaryHitProviderToHeroGraves() {
        assertContains("provider_hero_graves_r_collateral_damage_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_graves_r_collateral_damage_primary_hit'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Collateral Damage primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_graves'\\s*,\\s*"
                        + "'provider_hero_graves_r_collateral_damage_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Collateral Damage primary-hit provider to hero_graves");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Collateral Damage primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Collateral Damage primary-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    @Test
    void seedsActiveCollateralDamageWithMana100AndCooldown60000Ms() {
        assertContains("ability_hero_graves_r_collateral_damage_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_graves_r_collateral_damage_primary_hit'\\s*,\\s*"
                        + "'provider_hero_graves_r_collateral_damage_primary_hit'\\s*,\\s*"
                        + "'collateral_damage'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key collateral_damage");
        assertContains("r_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_graves_r_collateral_damage_primary_hit");
        assertContains("r_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":60000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_graves_r_collateral_damage_primary_hit'\\s*,\\s*"
                        + "'ability_hero_graves_r_collateral_damage_primary_hit'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 60000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndPhysicalBonusAdDamage() {
        assertContains(COLLATERAL_DAMAGE_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":575");
        assertContains("\"value\":1.50");
        assertContains("phase_hero_graves_r_collateral_damage_primary_hit_impact");
        assertContains("sequence_hero_graves_r_collateral_damage_primary_hit_impact");
        assertContains("step_hero_graves_r_collateral_damage_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_graves_r_collateral_damage_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_graves_r_collateral_damage_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_graves_r_collateral_damage_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_graves_r_collateral_damage_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_graves_r_collateral_damage_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_graves_r_collateral_damage_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Collateral Damage damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_graves_r_collateral_damage_primary_hit_damage'\\s*,\\s*"
                        + "'collateral_damage_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Collateral Damage damage must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_graves_r_collateral_damage_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Collateral Damage primary-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertFalse(
            Pattern.compile("(?i)basic_attack|ability/basic_attack|62003")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model R as basic attack");
    }

    @Test
    void excludesCastRecoilProjectileGeometryLineExplosionConeAndCoupling() {
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
                    "(?i)phase_hero_graves_r_collateral_damage_primary_hit_cast|"
                        + "cast_duration_formula|starts_on_phase_id\\s*=\\s*'phase_")
                .matcher(sqlNoLineComments)
                .find(),
            "must not invent cast-delay phase implementation rows");
        assertFalse(
            Pattern.compile(
                    "(?i)INSERT\\s+INTO\\s+public\\.(projectile|geometry|location|"
                        + "aoe|area|field)_")
                .matcher(sqlNoLineComments)
                .find(),
            "must not insert projectile/geometry/AOE/field implementation tables");
        assertFalse(
            Pattern.compile(
                    "(?i)basic_attack_hit|emit_event|equipment|loadout|"
                        + "on.?hit.?coupl|spellshield|ammo|reload|true.?grit")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model on-hit/equipment/ammo/True Grit coupling in executable SQL");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[12]\\b|ranks?\\s*=\\s*\\[|maxrank|falloffdamage")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / falloff / rank tables");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "must not destructively replace existing Graves providers");
        assertTrue(
            sql.contains("cast-delay") || sql.contains("cast delay"),
            "seed comments must document exclusion of cast delay");
        assertTrue(
            sql.contains("recoil") || sql.contains("dash"),
            "seed comments must document exclusion of recoil/dash");
        assertTrue(
            sql.contains("projectile") || sql.contains("geometry"),
            "seed comments must document exclusion of projectile/geometry");
        assertTrue(
            sql.contains("line") || sql.contains("multi-target") || sql.contains("AOE")
                || sql.contains("aoe"),
            "seed comments must document exclusion of line/AOE/multitarget");
        assertTrue(
            sql.contains("explosion") || sql.contains("cone") || sql.contains("reduced damage"),
            "seed comments must document exclusion of explosion/cone/reduced damage");
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
