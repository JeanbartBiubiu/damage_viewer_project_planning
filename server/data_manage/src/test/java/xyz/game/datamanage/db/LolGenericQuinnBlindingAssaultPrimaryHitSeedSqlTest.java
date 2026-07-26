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
 * Static contract for {@code lol_generic_quinn_blinding_assault_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_quinn_blinding_assault_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_quinn",
        "provider_hero_quinn_q_blinding_assault_primary_hit",
        "ability_hero_quinn_q_blinding_assault_primary_hit",
        "blinding_assault_primary_hit",
        "phase_hero_quinn_q_blinding_assault_primary_hit_impact",
        "sequence_hero_quinn_q_blinding_assault_primary_hit_impact",
        "step_hero_quinn_q_blinding_assault_primary_hit_damage",
        "cost_hero_quinn_q_blinding_assault_primary_hit_mana",
        "cooldown_hero_quinn_q_blinding_assault_primary_hit",
        "blinding_assault_damage",
        "q_mana_cost",
        "q_cooldown_ms");

    private static final List<String> PRESERVED_PROVIDER_IDS = List.of(
        "provider_hero_quinn_basic_attack",
        "provider_hero_quinn_heightened_senses");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad", "mana", "ap");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_physical_damage",
        "ap_ratio",
        "bonus_ad_ratio",
        "immediate_impact_scaffold");

    private static final String BLINDING_ASSAULT_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":205},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.50},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_champion_single_hit; immediate_impact_scaffold; "
            + "physical_205_plus_1_00_bonus_ad_plus_0_50_ap; "
            + "no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_"
            + "harrier_mark_nearsight_disarm_or_other_ranks";

    private static final String CANONICAL_SHA =
        "abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d";

    private static final String LOCAL_RAW_SHA =
        "be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd";

    private static String sql;
    private static String sqlNoComments;
    private static String readme;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoComments = stripSqlComments(sql);
        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = Files.readString(readmePath, StandardCharsets.UTF_8);
    }

    @Test
    void documentsSourceIdentityBoundaryOrderedTagsAndLocalRawCaveat() {
        assertContains("hero_skill|hero_quinn|Q|炫目攻势");
        assertContains("wasm-generic-quinn-blinding-assault-primary-hit");
        assertContains("quinn-q-blinding-assault-phase-a-v1");
        assertContains("Template:Data Quinn/Q");
        assertContains("Template:Data Quinn/Blinding Assault");
        assertContains("1308954");
        assertContains("4024766");
        assertContains("2026-06-03T00:49:42Z");
        assertContains("1742");
        assertContains(CANONICAL_SHA);
        assertContains(LOCAL_RAW_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/quinn-q.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("205 + 100% bonus AD + 50% AP")
                    || sql.contains("205 + 1.00")
                    || sql.contains("physical 205")),
            "seed comments must document rank5 physical 205 +100% bAD +50% AP");
        assertTrue(
            sql.contains("bonus AD") || sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD via sub(resolved,base)");
        assertContains("NB-ZERO-EMITTED-EVENTS-SCOPE");
        assertTrue(
            Pattern.compile("(?i)无截图|无.*OCR|screenshot|OCR").matcher(sql).find()
                && Pattern.compile("(?i)无截图|不含截图|无.*OCR|不.*OCR|without.*screenshot|"
                    + "no screenshot|无截图 / OCR")
                    .matcher(sql)
                    .find(),
            "seed comments must explicitly disclaim screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)screenshot|ocr|截图识别|光学字符")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not cite screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon|meraki")
                .matcher(sqlNoComments)
                .find(),
            "must not add DDragon/Meraki provenance in executable SQL");
        assertFalse(
            Pattern.compile("(?is)\\bmana\\s*269\\b|\\b269\\b.*mana|'mana'\\s*,\\s*269")
                .matcher(sqlNoComments)
                .find(),
            "must not hard-code Quinn panel mana269 in executable SQL");
        assertFalse(
            Pattern.compile("(?is)\\bad\\s*59\\b|'ad'\\s*,\\s*59\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not hard-code Quinn panel ad59 in executable SQL");
        assertContains("20260724");
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
                .matcher(sqlNoComments)
                .find(),
            "candidate must be locked current_revision + 1");
        assertTrue(
            Pattern.compile("(?is)IF\\s+v_changed\\s+THEN").matcher(sqlNoComments).find(),
            "must guard current_revision bump with v_changed");
        assertTrue(
            Pattern.compile("current_revision\\s*=\\s*v_candidate")
                .matcher(sqlNoComments)
                .find(),
            "must advance current_revision to candidate when changed");
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
        assertTrue(
            Pattern.compile("change_revision\\s*>\\s*v_locked_current")
                .matcher(sqlNoComments)
                .find(),
            "match/link/mount idempotent guards must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoComments).find(),
            "seed must not call publish API markers");
        assertFalse(
            Pattern.compile("(?is)\\bcurrent_revision\\s*=\\s*\\d+")
                .matcher(sqlNoComments)
                .find(),
            "seed must not hardcode revision numbers");
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoComments).find(),
            "blinding assault primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "blinding assault primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "blinding assault primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "blinding assault primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "blinding assault primary-hit seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?i)single_attacker_dps").matcher(sqlNoComments).find(),
            "must not write single_attacker_dps surfaces");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.(heroes|items|skills)\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write legacy heroes/items/skills tables");
    }

    @Test
    void validatesWAndBasicPrerequisitesPlusAmbientApDefinition() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("lol_generic_quinn_heightened_senses_seed.sql");
        assertContains("missing game_entities hero_quinn");
        assertContains("missing entity_attribute_values hero_quinn/ad");
        assertContains("missing entity_attribute_values hero_quinn/mana");
        assertContains("missing provider_hero_quinn_basic_attack");
        assertContains("missing provider_hero_quinn_heightened_senses");
        assertTrue(
            sql.contains("ambient") || sql.contains("W seed 之外")
                || sql.contains("additional ambient"),
            "seed must document attribute_definitions(ap) as ambient beyond W seed");
        assertContains("INSERT INTO public.types");
        Matcher attrsArray = Pattern.compile(
                "(?is)v_required_attrs\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]")
            .matcher(sqlNoComments);
        assertTrue(attrsArray.find(), "must declare v_required_attrs array");
        String attrsBlock = attrsArray.group(1);
        for (String attr : REQUIRED_ATTRS) {
            assertTrue(
                attrsBlock.contains("'" + attr + "'"),
                "attr preflight must include: " + attr);
        }
        assertEquals(
            3,
            countOccurrences(attrsBlock, "'") / 2,
            "attr preflight array must list exactly ad, mana, ap");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_quinn'")
                .matcher(sqlNoComments)
                .find(),
            "must EXISTS-check game_entities hero_quinn before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.provider_definitions\\b[\\s\\S]{0,200}"
                        + "provider_id\\s*=\\s*'provider_hero_quinn_basic_attack'")
                .matcher(sqlNoComments)
                .find(),
            "must EXISTS-check basic attack provider before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.provider_definitions\\b[\\s\\S]{0,200}"
                        + "provider_id\\s*=\\s*'provider_hero_quinn_heightened_senses'")
                .matcher(sqlNoComments)
                .find(),
            "must EXISTS-check W Heightened Senses provider before graph writes");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entities\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not materialize/rewrite game_entities");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.attribute_definitions\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write attribute_definitions");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_progressions\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write entity_attribute_progressions");
    }

    @Test
    void insertsNeutralApAndManaResourceWithoutOverwritePaths() {
        assertTrue(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,280}"
                        + "'hero_quinn'\\s*,\\s*'ap'\\s*,\\s*0[\\s\\S]{0,160}"
                        + "ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*,\\s*"
                        + "attr_key\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoComments)
                .find(),
            "must insert hero_quinn/ap base0 only if absent via DO NOTHING");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,400}"
                        + "'ap'[\\s\\S]{0,200}ON\\s+CONFLICT[\\s\\S]{0,120}DO\\s+UPDATE")
                .matcher(sqlNoComments)
                .find(),
            "AP insert must have no upsert-update / DO UPDATE path");
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must ensure resource_definitions.mana with neutral defaults");
        assertTrue(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.resource_definitions\\b[\\s\\S]{0,320}"
                        + "ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*resource_key\\s*\\)"
                        + "\\s*DO\\s+NOTHING")
                .matcher(sqlNoComments)
                .find(),
            "resource_definitions.mana must DO NOTHING on conflict");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.resource_definitions\\b[\\s\\S]{0,400}"
                        + "ON\\s+CONFLICT[\\s\\S]{0,120}DO\\s+UPDATE")
                .matcher(sqlNoComments)
                .find(),
            "resource_definitions insert must have no DO UPDATE path");
        assertTrue(
            Pattern.compile(
                    "(?is)SELECT\\s+eav\\.base_value\\s+INTO\\s+v_mana_attr[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'mana'")
                .matcher(sqlNoComments)
                .find(),
            "entity_resource_values must derive initial/max from existing Quinn mana attr");
        assertTrue(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_resource_values\\b[\\s\\S]{0,280}"
                        + "'hero_quinn'\\s*,\\s*'mana'\\s*,\\s*v_mana_attr\\s*,\\s*"
                        + "v_mana_attr[\\s\\S]{0,160}"
                        + "ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*,\\s*"
                        + "resource_key\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoComments)
                .find(),
            "entity_resource_values must insert derived mana via DO NOTHING");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_resource_values\\b[\\s\\S]{0,400}"
                        + "ON\\s+CONFLICT[\\s\\S]{0,120}DO\\s+UPDATE")
                .matcher(sqlNoComments)
                .find(),
            "entity_resource_values insert must have no DO UPDATE path");
        assertFalse(
            Pattern.compile(
                    "(?is)'hero_quinn'\\s*,\\s*'mana'\\s*,\\s*269\\s*,\\s*269")
                .matcher(sqlNoComments)
                .find(),
            "must not hard-code mana269 into entity_resource_values");
    }

    @Test
    void mountsDedicatedQProviderWithoutMutatingBasicOrW() {
        assertContains("provider_hero_quinn_q_blinding_assault_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_quinn_q_blinding_assault_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Blinding Assault primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_quinn'\\s*,\\s*"
                        + "'provider_hero_quinn_q_blinding_assault_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Blinding Assault primary-hit provider to hero_quinn");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Q primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Blinding Assault primary-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        for (String preserved : PRESERVED_PROVIDER_IDS) {
            assertTrue(
                sql.contains(preserved),
                "seed must document coexistence / non-mutation of " + preserved);
            assertFalse(
                Pattern.compile(
                        "(?is)INSERT\\s+INTO\\s+public\\.provider_definitions\\b"
                            + "[\\s\\S]{0,220}'" + preserved + "'")
                    .matcher(sqlNoComments)
                    .find(),
                "must not INSERT/replace preserved provider " + preserved);
            assertFalse(
                Pattern.compile(
                        "(?is)INSERT\\s+INTO\\s+public\\.entity_provider_mounts\\b"
                            + "[\\s\\S]{0,220}'" + preserved + "'")
                    .matcher(sqlNoComments)
                    .find(),
                "must not remount preserved provider " + preserved);
        }
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_quinn_basic_attack'|"
                        + "'listener_hero_quinn_heightened_senses'|"
                        + "'heightened_senses_active'|"
                        + "'harrier_vulnerable'")
                .matcher(sqlNoComments)
                .find(),
            "must not mutate W/basic ability/state/listener identities");
    }

    @Test
    void seedsActiveBlindingAssaultWithMana70AndCooldown9000Ms() {
        assertContains("ability_hero_quinn_q_blinding_assault_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_quinn_q_blinding_assault_primary_hit'\\s*,\\s*"
                        + "'provider_hero_quinn_q_blinding_assault_primary_hit'\\s*,\\s*"
                        + "'blinding_assault_primary_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key blinding_assault_primary_hit");
        assertContains("cost_hero_quinn_q_blinding_assault_primary_hit_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("q_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":70}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_quinn_q_blinding_assault_primary_hit_mana'\\s*,\\s*"
                        + "'ability_hero_quinn_q_blinding_assault_primary_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'q_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 70 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_quinn_q_blinding_assault_primary_hit");
        assertContains("q_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":9000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_quinn_q_blinding_assault_primary_hit'\\s*,\\s*"
                        + "'ability_hero_quinn_q_blinding_assault_primary_hit'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 9000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndNestedBinaryPhysicalDamage()
        throws IOException {
        assertContains(BLINDING_ASSAULT_DAMAGE);
        assertBinaryNestedDamageFormula(BLINDING_ASSAULT_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":205");
        assertContains("\"value\":1.00");
        assertContains("\"value\":0.50");
        assertContains("\"op\":\"sub\"");
        assertFalse(
            Pattern.compile("(?is)\\b20221\\b").matcher(sqlNoComments).find(),
            "executable SQL must not use magic damage type 20221");
        assertContains("phase_hero_quinn_q_blinding_assault_primary_hit_impact");
        assertContains("sequence_hero_quinn_q_blinding_assault_primary_hit_impact");
        assertContains("step_hero_quinn_q_blinding_assault_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_quinn_q_blinding_assault_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_quinn_q_blinding_assault_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_quinn_q_blinding_assault_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_quinn_q_blinding_assault_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_q_blinding_assault_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_quinn_q_blinding_assault_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Blinding Assault damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_q_blinding_assault_primary_hit_damage'\\s*,\\s*"
                        + "'blinding_assault_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Blinding Assault damage must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_quinn_q_blinding_assault_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Blinding Assault primary-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesListenersEventsStateControlAndForbiddenSurfaces() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_match_types\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write listener_match_types");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_effect_sequences\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write listener_effect_sequences");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write provider_state_fields");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.state_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write state_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write modifier_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_definitions\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write modifier_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write provider_modifiers");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.repeat_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write repeat_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.control_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write control_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.(projectile|aoe)_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write projectile/AOE effect detail surfaces");
        assertFalse(
            Pattern.compile("(?i)20158|emit_event|operation/emit_event")
                .matcher(sqlNoComments)
                .find(),
            "Q provider graph must have zero emit_event operations (NB-ZERO-EMITTED-EVENTS-SCOPE)");
        assertFalse(
            Pattern.compile(
                    "(?i)cast.?delay|projectile|missile|travel|collision|geometry|"
                        + "valor|aoe|area.?of.?effect|monster.?double|harrier|"
                        + "nearsight|disarm|basic_attack_hit|"
                        + "equipment|loadout|\\brepeat\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded Valor/projectile/geometry/AOE/Harrier/control surfaces");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoComments)
                .find(),
            "must not include live migration");
        assertTrue(
            sql.contains("Valor") || sql.contains("valor"),
            "seed comments must document exclusion of Valor");
        assertTrue(
            sql.contains("projectile") || sql.contains("travel") || sql.contains("collision"),
            "seed comments must document exclusion of projectile/travel/collision");
        assertTrue(
            sql.contains("nearsight") || sql.contains("disarm"),
            "seed comments must document exclusion of nearsight/disarm");
        assertTrue(
            sql.contains("Harrier") || sql.contains("harrier"),
            "seed comments must document exclusion of Harrier mark");
        assertTrue(
            sql.contains("monster") || sql.contains("200%"),
            "seed comments must document exclusion of monster double damage");
    }

    @Test
    void readmeEntryDocumentsWPrerequisiteAmbientApAndOrderedTags() {
        assertTrue(
            readme.contains("lol_generic_quinn_blinding_assault_primary_hit_seed.sql"),
            "README must list the Quinn Q Blinding Assault primary-hit seed");
        assertTrue(
            readme.contains("LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)quinn.*blinding|炫目攻势|Blinding Assault")
                .matcher(readme)
                .find(),
            "README must name Quinn Blinding Assault");
        int seedIdx = readme.indexOf("lol_generic_quinn_blinding_assault_primary_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("lol_generic_quinn_heightened_senses_seed.sql"),
            "README entry must list W Heightened Senses seed as prerequisite");
        assertTrue(
            Pattern.compile("(?i)attribute_definitions\\(ap\\)|`ap`.*ambient|ambient.*`ap`|"
                    + "ap.*额外|额外.*ap|ambient prerequisite")
                .matcher(section)
                .find(),
            "README must say attribute_definitions(ap) is additional ambient beyond W seed");
        assertTrue(
            Pattern.compile("(?i)provider_hero_quinn_basic_attack|"
                    + "provider_hero_quinn_heightened_senses")
                .matcher(section)
                .find(),
            "README must document basic/W provider prerequisites or coexistence");
        assertTrue(
            Pattern.compile("(?i)DO NOTHING|不覆盖|永不.*UPDATE|never update")
                .matcher(section)
                .find(),
            "README must document neutral AP/resource inserts without overwrite");
        assertTrue(
            section.contains(FROZEN_BOUNDARY) || section.contains(
                "physical_205_plus_1_00_bonus_ad_plus_0_50_ap"),
            "README must include frozen boundary");
        for (String tag : ORDERED_TAGS) {
            assertTrue(section.contains(tag), "README ordered tags must include " + tag);
        }
        assertTrue(
            Pattern.compile("(?i)排除|exclusion|Valor|nearsight|Harrier|projectile")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertFalse(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_quinn`|"
                    + "ensure `hero_quinn` 最低必要实体|mana269|ad59")
                .matcher(section)
                .find(),
            "README must not imitate self-contained Quinn panel wording or cite mana269/ad59");
    }

    /** Strip SQL line and block comments before forbidden-write checks. */
    private static String stripSqlComments(String raw) {
        String noBlock = Pattern.compile("/\\*.*?\\*/", Pattern.DOTALL).matcher(raw).replaceAll("");
        return Pattern.compile("(?m)--[^\\n]*").matcher(noBlock).replaceAll("");
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

    /**
     * compileGenericNode only wires args[0]/args[1] for binary arithmetic/comparison ops.
     * Damage formula must use nested binary add, never a three-argument add.
     */
    private static void assertBinaryNestedDamageFormula(String damageJson) throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be nested add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        assertBinaryArithmeticComparisonArity(root, "blinding_assault_damage");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ap.resolved"),
            "AP read must be present in nested binary damage AST");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ad.resolved")
                && nodeContainsReadPath(root, "source.attr.ad.base"),
            "bonus AD must be sub(resolved, base) under nested binary AST");
    }

    private static void assertBinaryArithmeticComparisonArity(JsonNode node, String path) {
        if (node == null || !node.isObject()) {
            return;
        }
        String op = node.path("op").asText(null);
        if (op != null && BINARY_ARITHMETIC_COMPARISON_OPS.contains(op)) {
            JsonNode args = node.get("args");
            assertTrue(args != null && args.isArray(), path + " op=" + op + " must have args array");
            assertEquals(
                2,
                args.size(),
                path + " op=" + op + " must be binary (exactly 2 args; compileGenericNode drops extras)");
        }
        Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            JsonNode child = entry.getValue();
            if (child.isObject()) {
                assertBinaryArithmeticComparisonArity(child, path + "." + entry.getKey());
            } else if (child.isArray()) {
                for (int i = 0; i < child.size(); i++) {
                    assertBinaryArithmeticComparisonArity(
                        child.get(i), path + "." + entry.getKey() + "[" + i + "]");
                }
            }
        }
    }

    private static boolean nodeContainsReadPath(JsonNode node, String readPath) {
        if (node == null || node.isNull()) {
            return false;
        }
        if (node.isObject()) {
            if ("read".equals(node.path("op").asText())
                && readPath.equals(node.path("path").asText())) {
                return true;
            }
            Iterator<JsonNode> values = node.elements();
            while (values.hasNext()) {
                if (nodeContainsReadPath(values.next(), readPath)) {
                    return true;
                }
            }
            return false;
        }
        if (node.isArray()) {
            for (JsonNode child : node) {
                if (nodeContainsReadPath(child, readPath)) {
                    return true;
                }
            }
        }
        return false;
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
