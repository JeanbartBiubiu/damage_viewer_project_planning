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
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_draven_whirling_death_primary_outbound_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericDravenWhirlingDeathPrimaryOutboundHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_draven_whirling_death_primary_outbound_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_draven",
        "provider_hero_draven_r_whirling_death_primary_outbound_hit",
        "ability_hero_draven_r_whirling_death_primary_outbound_hit",
        "whirling_death_primary_outbound_hit",
        "phase_hero_draven_r_whirling_death_primary_outbound_hit_impact",
        "sequence_hero_draven_r_whirling_death_primary_outbound_hit_impact",
        "step_hero_draven_r_whirling_death_primary_outbound_hit_damage",
        "cost_hero_draven_r_whirling_death_primary_outbound_hit_mana",
        "cooldown_hero_draven_r_whirling_death_primary_outbound_hit",
        "whirling_death_primary_outbound_hit_damage",
        "r_mana_cost",
        "r_cooldown_ms",
        "hero_draven_r_whirling_death_primary_outbound_hit");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp", "mana", "ad", "attack_speed", "armor", "magic_resist",
        "hp_regen", "mana_regen");

    private static final String WHIRLING_DEATH_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":400},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.50},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank3_selected_primary_champion_single_first_outbound_pass_hit; "
            + "immediate_impact_scaffold; physical_400_plus_1_50_bonus_ad; "
            + "no_cast_time_direction_projectile_travel_collision_sight_recast_"
            + "reversal_return_homing_second_pass_execute_adoration_threshold_"
            + "multitarget_damage_falloff_reset_map_edge_once_per_pass_geometry_"
            + "or_full_fidelity";

    private static final String CANONICAL_SHA =
        "e38551b6eeefa0306cd40a3e15473c8983075f88edbe007915e3d9213a08adce";

    private static final String LOCAL_RAW_SHA =
        "1110179b1771c03c8ff67b428d6fa7a5b0ba42caf19e241ce512a199ef812059";

    private static String sql;
    private static String sqlNoLineComments;
    private static String readme;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = Files.readString(readmePath, StandardCharsets.UTF_8);
    }

    @Test
    void documentsSourceIdentityCanonicalLocalCaveatAndFrozenBoundary() {
        assertContains("lol_generic_draven_whirling_death_primary_outbound_hit_seed.sql");
        assertContains("hero_skill|hero_draven|R|冷血追命");
        assertContains("draven-r-whirling-death-primary-outbound-hit-phase-a-v2");
        assertContains("Template:Data Draven/R");
        assertContains("Template:Data Draven/Whirling Death");
        assertContains("1307072");
        assertContains("4040576");
        assertContains("2026-07-06T14:27:37Z");
        assertContains("3079");
        assertContains(CANONICAL_SHA);
        assertContains(LOCAL_RAW_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("同 size 不等于等价") || sql.contains("same size is not equivalence")
                || sql.contains("同 size") || sql.contains("不等于等价"),
            "seed comments must caveat that same size is not equivalence");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertTrue(
            sql.contains("materialization") || sql.contains("serialization caveat")
                || sql.contains("serialization"),
            "seed must frame local raw difference as materialization/serialization caveat only");
        assertContains("normalized/generic/draven-r.json");
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
        assertContains("20260726");
    }

    @Test
    void documentsDeterministicFixturesWithoutClaimingFullFidelity() {
        assertTrue(
            sql.contains("base0/resolved0/armor0")
                && (sql.contains("raw/final400") || sql.contains("final400")),
            "seed comments must document base0/resolved0/armor0 raw/final400");
        assertTrue(
            sql.contains("base62/resolved62/armor0")
                && (sql.contains("raw/final400") || sql.contains("final400")),
            "seed comments must document base62/resolved62/armor0 raw/final400");
        assertTrue(
            sql.contains("base62/resolved162/armor0")
                && (sql.contains("raw/final550") || sql.contains("final550")),
            "seed comments must document base62/resolved162/armor0 raw/final550");
        assertTrue(
            (sql.contains("same armor100") || sql.contains("armor100 raw550"))
                && (sql.contains("raw550/final275")
                    || (sql.contains("raw550") && sql.contains("final275"))),
            "seed comments must document armor100 raw550/final275");
        assertTrue(
            sql.contains("base0/resolved100")
                && sql.contains("base62/resolved162")
                && (sql.contains("both raw/final550") || sql.contains("both550")
                    || sql.contains("bonusAD counterproof")),
            "seed must document bonusAD counterproof");
        assertTrue(
            sql.contains("t0") && sql.contains("t79999") && sql.contains("t80000"),
            "seed comments must document cooldown timeline t0/t79999/t80000");
        assertTrue(
            (sql.contains("mana361") || sql.contains("mana361/"))
                && (sql.contains("mana261") || sql.contains("final mana261"))
                && (sql.contains("HP725") || sql.contains("HP1000")),
            "seed comments must document mana361→261 / HP1000→725 fixture");
        assertTrue(
            sql.contains("exactly two R hits") || sql.contains("two R hits"),
            "seed comments must document exactly two R hits");
        assertTrue(
            sql.contains("readyAt80000"),
            "seed comments must document readyAt80000");
        assertTrue(
            sql.contains("mana99") && (sql.contains("resource skip") || sql.contains("unchanged")),
            "seed comments must document mana99 resource skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("不写显式") || sql.contains("不写") || sql.contains("自动")
                    || sql.contains("runtime")),
            "seed must document automatic ability_started without explicit event step");
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
            "whirling death primary outbound-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "whirling death primary outbound-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "whirling death primary outbound-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "whirling death primary outbound-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "whirling death primary outbound-hit seed must not CREATE TABLE");
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
        assertEquals(
            8,
            countOccurrences(attrsBlock, "'") / 2,
            "attr preflight array must list exactly eight keys");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertFalse(
            Pattern.compile("(?is)\\b20230\\b").matcher(sqlNoLineComments).find(),
            "executable SQL must not use provider_action/apply 20230");
    }

    @Test
    void ensuresSelfContainedHeroWithoutOverwritingQwEOrBasicProviders() {
        assertContains("hero_draven");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Draven)");
        assertTrue(
            sql.contains("675") && sql.contains("361") && sql.contains("62")
                && sql.contains("0.679") && sql.contains("29") && sql.contains("30")
                && sql.contains("3.75") && sql.contains("8.05"),
            "must seed Draven level-1 panel numbers");
        assertFalse(
            Pattern.compile("(?s)'hero_draven'\\s*,\\s*'ap'\\s*,")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write AP panel values");
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
        assertTrue(
            sql.contains("provider_hero_draven_q_spinning_axe")
                && sql.contains("provider_hero_draven_w_blood_rush")
                && sql.contains("provider_hero_draven_e_stand_aside")
                && sql.contains("provider_hero_draven_basic_attack"),
            "seed must document coexistence with Q / W / E / basic attack providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_draven_q_spinning_axe'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Q Spinning Axe provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_draven_w_blood_rush'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write W Blood Rush provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_draven_e_stand_aside'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write E Stand Aside provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_draven_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_draven_q_spinning_axe'|"
                        + "'ability_hero_draven_w_blood_rush'|"
                        + "'ability_hero_draven_e_stand_aside'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Q/W/E ability rows");
        assertFalse(
            Pattern.compile(
                    "(?is)missing provider_hero_draven_q|"
                        + "missing provider_hero_draven_w|"
                        + "missing provider_hero_draven_e|"
                        + "spinning_axe.*prerequisite|"
                        + "blood_rush.*prerequisite|"
                        + "stand_aside.*prerequisite")
                .matcher(sqlNoLineComments)
                .find(),
            "must not depend on prior Q/W/E provider publication");
    }

    @Test
    void mountsDedicatedWhirlingDeathPrimaryOutboundHitProviderToHeroDraven() {
        assertContains("provider_hero_draven_r_whirling_death_primary_outbound_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_draven_r_whirling_death_primary_outbound_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Whirling Death primary outbound-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_draven'\\s*,\\s*"
                        + "'provider_hero_draven_r_whirling_death_primary_outbound_hit'")
                .matcher(sql)
                .find(),
            "must mount Whirling Death primary outbound-hit provider to hero_draven");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Whirling Death primary outbound-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Whirling Death primary outbound-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    @Test
    void seedsActiveWhirlingDeathWithMana100AndCooldown80000Ms() {
        assertContains("ability_hero_draven_r_whirling_death_primary_outbound_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_draven_r_whirling_death_primary_outbound_hit'\\s*,\\s*"
                        + "'provider_hero_draven_r_whirling_death_primary_outbound_hit'\\s*,\\s*"
                        + "'whirling_death_primary_outbound_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key whirling_death_primary_outbound_hit");
        assertContains("cost_hero_draven_r_whirling_death_primary_outbound_hit_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("r_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_draven_r_whirling_death_primary_outbound_hit_mana'\\s*,\\s*"
                        + "'ability_hero_draven_r_whirling_death_primary_outbound_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'r_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "R mana cost must be ability-level 100 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_draven_r_whirling_death_primary_outbound_hit");
        assertContains("r_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":80000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_draven_r_whirling_death_primary_outbound_hit'\\s*,\\s*"
                        + "'ability_hero_draven_r_whirling_death_primary_outbound_hit'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 80000ms via ability_cooldowns");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_definitions"),
            "must define exactly one ability");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_costs"),
            "must define exactly one cost");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_cooldowns"),
            "must define exactly one cooldown");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndPhysicalBonusAdDamage() throws IOException {
        assertContains(WHIRLING_DEATH_DAMAGE);
        assertBinaryBonusAdDamageFormula(WHIRLING_DEATH_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":400");
        assertContains("\"value\":1.50");
        assertEquals(
            1,
            countReadPathOccurrences(
                JSON.readTree(WHIRLING_DEATH_DAMAGE), "source.attr.ad.resolved"),
            "ad.resolved must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(
                JSON.readTree(WHIRLING_DEATH_DAMAGE), "source.attr.ad.base"),
            "ad.base must appear exactly once");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "source.attr.ad.resolved"),
            "executable formula must read source.attr.ad.resolved exactly once");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "source.attr.ad.base"),
            "executable formula must read source.attr.ad.base exactly once");
        assertContains("phase_hero_draven_r_whirling_death_primary_outbound_hit_impact");
        assertContains("sequence_hero_draven_r_whirling_death_primary_outbound_hit_impact");
        assertContains("step_hero_draven_r_whirling_death_primary_outbound_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_sequences"),
            "must define exactly one effect sequence");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_steps"),
            "must define exactly one effect step");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_draven_r_whirling_death_primary_outbound_hit_impact'\\s*,\\s*"
                        + "'ability_hero_draven_r_whirling_death_primary_outbound_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_draven_r_whirling_death_primary_outbound_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_draven_r_whirling_death_primary_outbound_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_r_whirling_death_primary_outbound_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_draven_r_whirling_death_primary_outbound_hit_impact'"
                        + "\\s*,\\s*0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Whirling Death damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_r_whirling_death_primary_outbound_hit_damage'\\s*,\\s*"
                        + "'whirling_death_primary_outbound_hit_damage'\\s*,\\s*"
                        + "20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Whirling Death damage must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_draven_r_whirling_death_primary_outbound_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Whirling Death primary outbound-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesCastProjectileRecastExecuteGeometryAndForbiddenTableWrites() {
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
                    "(?i)INSERT\\s+INTO\\s+public\\.(projectile|geometry|location|"
                        + "aoe|area|field)_")
                .matcher(sqlNoLineComments)
                .find(),
            "must not insert projectile/geometry/AOE/field implementation tables");
        assertFalse(
            Pattern.compile(
                    "(?i)basic_attack_hit|emit_event|equipment|loadout|"
                        + "adoration|league.?of.?draven|execute.?threshold|"
                        + "once.?per.?pass|map.?edge|damage.?falloff|"
                        + "homing|recast|reversal|second.?pass")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded recast/return/execute/geometry keywords in executable SQL");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[12]\\b|ranks?\\s*=\\s*\\[|maxrank")
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
            "must not destructively replace Q/W/E/basic rows");
        assertTrue(
            sql.contains("cast time") || sql.contains("cast-time") || sql.contains("cast_time"),
            "seed comments must document exclusion of cast time");
        assertTrue(
            sql.contains("projectile") || sql.contains("travel") || sql.contains("collision"),
            "seed comments must document exclusion of projectile/travel/collision");
        assertTrue(
            sql.contains("recast") || sql.contains("reversal") || sql.contains("return")
                || sql.contains("homing") || sql.contains("second pass"),
            "seed comments must document exclusion of recast/reversal/return/homing/second pass");
        assertTrue(
            sql.contains("execute") || sql.contains("Adoration") || sql.contains("adoration"),
            "seed comments must document exclusion of execute/Adoration");
        assertTrue(
            sql.contains("multitarget") || sql.contains("multi-target") || sql.contains("falloff")
                || sql.contains("once-per-pass") || sql.contains("map edge"),
            "seed comments must document exclusion of multitarget/falloff/geometry");
    }

    @Test
    void readmeEntryDocumentsOrderBoundarySourceSelfContainedCoexistenceAndValidation() {
        assertTrue(
            readme.contains("lol_generic_draven_whirling_death_primary_outbound_hit_seed.sql"),
            "README must list the Draven R Whirling Death primary outbound-hit seed");
        assertTrue(
            readme.contains("LolGenericDravenWhirlingDeathPrimaryOutboundHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)draven.*whirling death|冷血追命|Whirling Death")
                .matcher(readme)
                .find(),
            "README must name Draven Whirling Death");
        int seedIdx = readme.indexOf(
            "lol_generic_draven_whirling_death_primary_outbound_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("hero_skill|hero_draven|R|冷血追命"),
            "README entry must name the candidate");
        assertTrue(
            section.contains("draven-r-whirling-death-primary-outbound-hit-phase-a-v2"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("physical_400_plus_1_50_bonus_ad"),
            "README must include frozen boundary");
        assertTrue(
            section.contains("1307072") && section.contains("4040576")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("3079"),
            "README must document canonical/local raw byte size 3079");
        assertTrue(
            Pattern.compile("(?i)100.*mana|mana.?100|100 mana").matcher(section).find()
                && section.contains("80000"),
            "README must document mana100 and cooldown 80000ms");
        assertTrue(
            section.contains("400") && section.contains("1.50")
                && (section.contains("bonus AD") || section.contains("ad.resolved-ad.base")
                    || (section.contains("ad.resolved") && section.contains("ad.base"))),
            "README must document damage formula with bonus AD wording");
        assertTrue(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_draven`|自包含")
                .matcher(section)
                .find(),
            "README entry must say self-contained ensure hero_draven");
        assertTrue(
            (section.contains("Q") || section.contains("Spinning Axe"))
                && (section.contains("W") || section.contains("Blood Rush"))
                && (section.contains("E") || section.contains("Stand Aside"))
                && (section.contains("basic") || section.contains("普攻"))
                && (section.contains("并存") || section.contains("coexist")
                    || section.contains("preserve")),
            "README must document coexistence with Q/W/E/basic");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|cast.?time|projectile|recast|reversal|return|"
                        + "homing|second.?pass|execute|Adoration|multitarget|falloff|"
                        + "once.?per.?pass|geometry")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertTrue(
            Pattern.compile("(?i)不连 live|不执行.*live|no.?live|不连 live DB")
                .matcher(section)
                .find(),
            "README must make the no-live claim");
        assertTrue(
            section.contains("base0/resolved0") || section.contains("final275")
                || section.contains("HP725") || section.contains("mana361")
                || section.contains("both raw/final550") || section.contains("final550"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            section.contains("LolGenericDravenWhirlingDeathPrimaryOutboundHitSeedSqlTest")
                && (section.contains("LolGenericDravenStandAsideSeedSqlTest")
                    || section.contains("LolGenericDravenBloodRushSeedSqlTest")
                    || section.contains("LolGenericDravenSpinningAxeSeedSqlTest")
                    || section.contains(
                        "LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest")),
            "README static validation must cite focused and adjacent validation command");
    }

    private static void assertBinaryBonusAdDamageFormula(String damageJson) throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        assertEquals(
            400,
            root.path("args").get(0).path("value").asDouble(),
            0.0001,
            "add left must be const 400");
        JsonNode mulBonus = root.path("args").get(1);
        assertEquals("mul", mulBonus.path("op").asText(), "add right must be mul");
        assertEquals(2, mulBonus.path("args").size(), "mul must be binary");
        assertEquals(
            1.50,
            mulBonus.path("args").get(0).path("value").asDouble(),
            0.0001,
            "bonus AD mul left must be const 1.50");
        JsonNode sub = mulBonus.path("args").get(1);
        assertEquals("sub", sub.path("op").asText(), "mul right must be sub(resolved, base)");
        assertEquals(2, sub.path("args").size(), "sub must be binary");
        assertEquals(
            "source.attr.ad.resolved",
            sub.path("args").get(0).path("path").asText(),
            "sub left must read ad.resolved");
        assertEquals(
            "source.attr.ad.base",
            sub.path("args").get(1).path("path").asText(),
            "sub right must read ad.base");
        assertEquals(
            0,
            countReadPathOccurrences(root, "source.attr.ap.resolved"),
            "AP must not appear in whirling-death damage formula");
    }

    private static int countReadPathOccurrences(JsonNode node, String path) {
        int count = 0;
        if (node == null || node.isNull()) {
            return 0;
        }
        if (node.isObject()) {
            if ("read".equals(node.path("op").asText())
                && path.equals(node.path("path").asText())) {
                count++;
            }
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                count += countReadPathOccurrences(fields.next().getValue(), path);
            }
        } else if (node.isArray()) {
            for (JsonNode child : node) {
                count += countReadPathOccurrences(child, path);
            }
        }
        return count;
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
