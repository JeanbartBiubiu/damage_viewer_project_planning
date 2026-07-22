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
 * Static contract for {@code lol_generic_varus_hail_of_arrows_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_varus_hail_of_arrows_primary_hit_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_varus",
        "provider_hero_varus_e_hail_of_arrows_primary_hit",
        "ability_hero_varus_e_hail_of_arrows_primary_hit",
        "hail_of_arrows",
        "phase_hero_varus_e_hail_of_arrows_primary_hit_impact",
        "sequence_hero_varus_e_hail_of_arrows_primary_hit_impact",
        "step_hero_varus_e_hail_of_arrows_primary_hit_damage",
        "cost_hero_varus_e_hail_of_arrows_primary_hit_mana",
        "cooldown_hero_varus_e_hail_of_arrows_primary_hit",
        "hail_of_arrows_damage",
        "e_mana_cost",
        "e_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp", "mana", "ad", "attack_speed", "armor", "magic_resist",
        "hp_regen", "mana_regen");

    private static final String HAIL_OF_ARROWS_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":180},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.90},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_target_single_hit; immediate_impact_scaffold; "
            + "physical_180_plus_0_90_bonus_ad; "
            + "no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation";

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
        assertContains("hero_skill|hero_varus|E|恶灵箭雨");
        assertContains("varus-e-hail-of-arrows-primary-hit-phase-a-v1");
        assertContains("Template:Data Varus/E");
        assertContains("Template:Data Varus/Hail of Arrows");
        assertContains("1309978");
        assertContains("3969402");
        assertContains("2025-11-24T16:03:58Z");
        assertContains("1750");
        assertContains("7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9");
        assertContains("normalized/generic/varus-e.json");
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
            Pattern.compile("(?i)ddragon|data.?dragon").matcher(sqlNoLineComments).find(),
            "must not add DDragon provenance in executable SQL");
    }

    @Test
    void documentsPhysicalDescriptionRankTableEvidenceAndDamagetypeMagicContradiction() {
        assertTrue(
            sql.contains("60 to 180") || sql.contains("60 to 180 (+90% bonus AD)"),
            "seed comments must cite description/rank-table physical evidence 60 to 180");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("+90% bonus AD") || sql.contains("90% bonus AD")
                    || sql.contains("0.90")),
            "seed comments must document physical rank-5 bonus AD evidence");
        assertContains("damagetype=Magic");
        assertTrue(
            Pattern.compile("(?i)contradict|矛盾|incorrectly|错误").matcher(sql).find(),
            "seed must explicitly disclose damagetype=Magic contradiction");
        assertTrue(
            sql.contains("description") && sql.contains("rank table")
                || sql.contains("labeled rank table")
                || sql.contains("description + labeled rank table"),
            "seed must state description + labeled rank table govern this branch");
        assertFalse(
            Pattern.compile("(?is)\\b20221\\b").matcher(sqlNoLineComments).find(),
            "executable SQL must not leak contradictory magic type 20221 into runtime rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'step_hero_varus_e_hail_of_arrows_primary_hit_damage'[\\s\\S]{0,120}20221")
                .matcher(sqlNoLineComments)
                .find(),
            "damage detail must not use magic type 20221");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_e_hail_of_arrows_primary_hit_damage'\\s*,\\s*"
                        + "'hail_of_arrows_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "runtime damage detail must be physical type 20220");
        assertFalse(
            Pattern.compile("(?i)damagetype\\s*=\\s*Magic")
                .matcher(sqlNoLineComments)
                .find(),
            "damagetype=Magic must remain comment/metadata disclosure only");
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
            "hail of arrows primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "hail of arrows primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "hail of arrows primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "hail of arrows primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "hail of arrows primary-hit seed must not CREATE TABLE");
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
    void validatesExactlyEightAttrPreflightWithoutApAndProjectsReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        assertContains("INSERT INTO public.resource_definitions");
        assertEquals(8, REQUIRED_ATTRS.size(), "contract expects exactly eight attrs");
        Matcher attrsArray = Pattern.compile(
                "(?is)v_required_attrs\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]")
            .matcher(sqlNoLineComments);
        assertTrue(attrsArray.find(), "must declare v_required_attrs array");
        String attrsBlock = attrsArray.group(1);
        for (String attr : REQUIRED_ATTRS) {
            assertTrue(
                attrsBlock.contains("'" + attr + "'"),
                "attr preflight must include exactly-eight key: " + attr);
        }
        assertFalse(
            Pattern.compile("(?i)'ap'").matcher(attrsBlock).find(),
            "attr preflight must not require AP");
        assertFalse(
            Pattern.compile("(?is)'hero_varus'\\s*,\\s*'ap'\\s*,")
                .matcher(sqlNoLineComments)
                .find(),
            "must not insert entity_attribute_values for ap");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void ensuresSelfContainedHeroWithoutDependingOnVarusWOrBatchBPublication() {
        assertContains("hero_varus");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Varus)");
        assertTrue(
            sql.contains("600") && sql.contains("320") && sql.contains("59")
                && sql.contains("0.658") && sql.contains("24") && sql.contains("30")
                && sql.contains("0.7") && sql.contains("1.6"),
            "must seed Varus level-1 panel numbers aligned with Batch-B");
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must project resource_definitions.mana");
        assertTrue(
            Pattern.compile("(?s)'hero_varus'\\s*,\\s*'mana'\\s*,\\s*320\\s*,\\s*320")
                .matcher(sql)
                .find(),
            "must seed entity_resource_values mana 320/320");
        assertTrue(
            sql.contains("provider_hero_varus_basic_attack")
                && sql.contains("provider_hero_varus_w_blighted_quiver_phase_a"),
            "seed must document coexistence with basic attack / W Blighted Quiver providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_varus_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_varus_w_blighted_quiver_phase_a'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace W Blighted Quiver provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_varus_basic_attack'|"
                        + "'ability_hero_varus_w_blighted_quiver_active'|"
                        + "'ability_hero_varus_w_piercing_arrow_max_charge_carrier'|"
                        + "'listener_hero_varus_w_blighted_quiver_basic_attack_hit'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write basic/W/Q-carrier ability or listener rows");
        assertFalse(
            Pattern.compile(
                    "(?is)missing game_entities hero_varus|"
                        + "missing provider_hero_varus_basic_attack|"
                        + "Batch-B prerequisite|"
                        + "blighted_quiver.*prerequisite")
                .matcher(sqlNoLineComments)
                .find(),
            "must not depend on prior Varus W / Batch-B provider publication");
        assertFalse(
            Pattern.compile("(?is)blight_stacks|blighted_quiver_active")
                .matcher(sqlNoLineComments)
                .find(),
            "must not read/write Blight state fields in executable SQL");
    }

    @Test
    void mountsDedicatedHailOfArrowsPrimaryHitProviderToHeroVarus() {
        assertContains("provider_hero_varus_e_hail_of_arrows_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_varus_e_hail_of_arrows_primary_hit'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Hail of Arrows primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_varus'\\s*,\\s*"
                        + "'provider_hero_varus_e_hail_of_arrows_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Hail of Arrows primary-hit provider to hero_varus");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Hail of Arrows primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (E Hail of Arrows primary-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    @Test
    void seedsActiveHailOfArrowsWithMana90AndCooldown10000Ms() {
        assertContains("ability_hero_varus_e_hail_of_arrows_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_varus_e_hail_of_arrows_primary_hit'\\s*,\\s*"
                        + "'provider_hero_varus_e_hail_of_arrows_primary_hit'\\s*,\\s*"
                        + "'hail_of_arrows'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "E must be active ability with stable key hail_of_arrows");
        assertContains("cost_hero_varus_e_hail_of_arrows_primary_hit_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("e_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":90}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_varus_e_hail_of_arrows_primary_hit_mana'\\s*,\\s*"
                        + "'ability_hero_varus_e_hail_of_arrows_primary_hit'\\s*,\\s*NULL\\s*,\\s*"
                        + "'mana'\\s*,\\s*'e_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "E mana cost must be ability-level 90 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_varus_e_hail_of_arrows_primary_hit");
        assertContains("e_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":10000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_varus_e_hail_of_arrows_primary_hit'\\s*,\\s*"
                        + "'ability_hero_varus_e_hail_of_arrows_primary_hit'\\s*,\\s*"
                        + "'e_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "E cooldown must be 10000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndPhysicalDamage() {
        assertContains(HAIL_OF_ARROWS_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":180");
        assertContains("\"value\":0.90");
        assertContains("phase_hero_varus_e_hail_of_arrows_primary_hit_impact");
        assertContains("sequence_hero_varus_e_hail_of_arrows_primary_hit_impact");
        assertContains("step_hero_varus_e_hail_of_arrows_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_varus_e_hail_of_arrows_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_varus_e_hail_of_arrows_primary_hit'\\s*,\\s*0\\s*,\\s*"
                        + "20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_varus_e_hail_of_arrows_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_varus_e_hail_of_arrows_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_e_hail_of_arrows_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_varus_e_hail_of_arrows_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Hail of Arrows damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_e_hail_of_arrows_primary_hit_damage'\\s*,\\s*"
                        + "'hail_of_arrows_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Hail of Arrows damage must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_varus_e_hail_of_arrows_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Hail of Arrows primary-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesLandingDelayGeometryFieldSlowGrievousWoundsBlightAndCoupling() {
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
            Pattern.compile(
                    "(?i)landing.?delay|cast.?duration|cast.?time|cast.?delay|"
                        + "\"value\":\\s*0\\.2419\\b|const\",\"value\":0\\.2419|"
                        + "\"value\":\\s*0\\.5\\b|const\",\"value\":0\\.5|"
                        + "projectile|missile|\"value\":\\s*925\\b|\"value\":\\s*300\\b|"
                        + "geometry|collision|target.?location|radius|"
                        + "multi.?target|多目标|all.?enemies|repeat|"
                        + "grievous.?wounds|heal.?reduction|regen.?reduction|"
                        + "blight.?detonat|blight_stacks|blighted_quiver|"
                        + "basic_attack_hit|emit_event|equipment|loadout|"
                        + "slow|linger|field")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded landing/cast/geometry/field/slow/"
                + "Grievous Wounds/Blight/equipment surfaces");
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
            "must not destructively replace existing Varus providers");
        assertTrue(
            sql.contains("landing") || sql.contains("0.5"),
            "seed comments must document exclusion of Wiki 0.5s landing delay");
        assertTrue(
            sql.contains("Grievous") || sql.contains("grievous") || sql.contains("重伤"),
            "seed comments must document exclusion of Grievous Wounds");
        assertTrue(
            sql.contains("Blight") || sql.contains("blight") || sql.contains("枯萎"),
            "seed comments must document exclusion of Blight detonation coupling");
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
