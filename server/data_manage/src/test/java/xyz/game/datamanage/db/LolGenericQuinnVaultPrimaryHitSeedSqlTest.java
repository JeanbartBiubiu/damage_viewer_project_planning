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
 * Static contract for {@code lol_generic_quinn_vault_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericQuinnVaultPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_quinn_vault_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_quinn",
        "provider_hero_quinn_e_vault_primary_hit",
        "ability_hero_quinn_e_vault_primary_hit",
        "vault_primary_hit",
        "phase_hero_quinn_e_vault_primary_hit_impact",
        "sequence_hero_quinn_e_vault_primary_hit_impact",
        "step_hero_quinn_e_vault_primary_hit_damage",
        "cost_hero_quinn_e_vault_primary_hit_mana",
        "cooldown_hero_quinn_e_vault_primary_hit",
        "vault_damage",
        "e_mana_cost",
        "e_cooldown_ms");

    private static final List<String> PRESERVED_PROVIDER_IDS = List.of(
        "provider_hero_quinn_basic_attack",
        "provider_hero_quinn_heightened_senses",
        "provider_hero_quinn_q_blinding_assault_primary_hit");

    private static final List<String> FORBIDDEN_IDENTITY_PANEL_RESOURCE_WRITES = List.of(
        "games_entities",
        "attribute_definitions",
        "entity_attribute_values",
        "resource_definitions",
        "entity_resource_values",
        "entity_attribute_progressions");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_physical_damage",
        "bonus_ad_ratio",
        "immediate_impact_scaffold");

    private static final String VAULT_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":140},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.20},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_champion_single_hit; immediate_impact_scaffold; "
            + "physical_140_plus_0_20_bonus_ad; "
            + "no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_"
            + "basic_attack_reset_auto_attack_or_other_ranks";

    private static final String CANONICAL_SHA =
        "9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714";

    private static final String LOCAL_RAW_SHA =
        "317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b";

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
        assertContains("hero_skill|hero_quinn|E|旋翔掠杀");
        assertContains("wasm-generic-quinn-vault-primary-hit");
        assertContains("quinn-e-vault-phase-a-v1");
        assertContains("Template:Data Quinn/E");
        assertContains("Template:Data Quinn/Vault");
        assertContains("1308957");
        assertContains("4024768");
        assertContains("2026-06-03T00:51:11Z");
        assertContains("2649");
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
        assertContains("normalized/generic/quinn-e.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertOrderedTagsInSection(sql, "Ordered tags");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("140 + 20% bonus AD")
                    || sql.contains("140 + 0.20")
                    || sql.contains("physical 140")),
            "seed comments must document rank5 physical 140 +20% bonus AD");
        assertTrue(
            sql.contains("bonus AD") || sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD via sub(resolved,base)");
        assertContains("NB-ZERO-EMITTED-EVENTS-SCOPE");
        assertContains("NB-MANA-RESOURCE-SEED-ORDER");
        assertTrue(
            sql.contains("W → Q(resource) → E")
                || sql.contains("W -> Q(resource) -> E"),
            "seed header must state W -> Q(resource) -> E order");
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
            "vault primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "vault primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "vault primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "vault primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "vault primary-hit seed must not CREATE TABLE");
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
    void validatesWBasicAndManaResourcePrerequisitesCheckOnlyWithoutQProviderHardReq() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("lol_generic_quinn_heightened_senses_seed.sql");
        assertContains("lol_generic_quinn_blinding_assault_primary_hit_seed.sql");
        assertContains("missing game_entities hero_quinn");
        assertContains("missing entity_attribute_values hero_quinn/ad");
        assertContains("missing resource_definitions mana");
        assertContains("missing entity_resource_values hero_quinn/mana");
        assertContains("missing provider_hero_quinn_basic_attack");
        assertContains("missing provider_hero_quinn_heightened_senses");
        assertTrue(
            sql.contains("check-only") || sql.contains("check only"),
            "seed must document check-only prerequisites");
        assertTrue(
            sql.contains("NB-MANA-RESOURCE-SEED-ORDER")
                || sql.contains("W → Q(resource) → E")
                || sql.contains("W -> Q(resource) -> E"),
            "seed must document NB-MANA-RESOURCE-SEED-ORDER / W -> Q(resource) -> E");
        assertFalse(
            Pattern.compile(
                    "(?is)missing provider_hero_quinn_q_blinding_assault|"
                        + "RAISE EXCEPTION[\\s\\S]{0,240}"
                        + "provider_hero_quinn_q_blinding_assault")
                .matcher(sqlNoComments)
                .find(),
            "must not RAISE/require Q provider as functional hard prerequisite");
        assertFalse(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.provider_definitions\\b[\\s\\S]{0,200}"
                        + "provider_id\\s*=\\s*"
                        + "'provider_hero_quinn_q_blinding_assault_primary_hit'")
                .matcher(sqlNoComments)
                .find(),
            "must not EXISTS-check Q provider as hard prerequisite");
        assertTrue(
            Pattern.compile("(?i)Q provider.*(非|不是).*硬前置|not a functional hard prerequisite|"
                    + "不断言 Q provider")
                .matcher(sql)
                .find(),
            "seed must state Q provider is not a functional hard prerequisite");
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
            1,
            countOccurrences(attrsBlock, "'") / 2,
            "attr preflight array must list exactly ad");
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
                    "(?is)FROM\\s+public\\.resource_definitions\\b[\\s\\S]{0,200}"
                        + "resource_key\\s*=\\s*'mana'")
                .matcher(sqlNoComments)
                .find(),
            "must EXISTS-check resource_definitions mana before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_resource_values\\b[\\s\\S]{0,240}"
                        + "resource_key\\s*=\\s*'mana'")
                .matcher(sqlNoComments)
                .find(),
            "must EXISTS-check entity_resource_values hero_quinn/mana before graph writes");
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
        for (String table : FORBIDDEN_IDENTITY_PANEL_RESOURCE_WRITES) {
            assertFalse(
                Pattern.compile(
                        "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO|DELETE\\s+FROM)\\s+"
                            + "public\\." + table + "\\b")
                    .matcher(sqlNoComments)
                    .find(),
                "must not INSERT/UPDATE/MERGE/DELETE public." + table
                    + " (SELECT/EXISTS checks are allowed)");
        }
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.games\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not INSERT into games");
    }

    @Test
    void mountsDedicatedEProviderWithoutMutatingBasicWorQ() {
        assertContains("provider_hero_quinn_e_vault_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_quinn_e_vault_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Vault primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_quinn'\\s*,\\s*"
                        + "'provider_hero_quinn_e_vault_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Vault primary-hit provider to hero_quinn");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated E primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (E Vault primary-hit only)");
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
                        + "'ability_hero_quinn_q_blinding_assault_primary_hit'|"
                        + "'listener_hero_quinn_heightened_senses'|"
                        + "'heightened_senses_active'|"
                        + "'harrier_vulnerable'")
                .matcher(sqlNoComments)
                .find(),
            "must not mutate W/basic/Q ability/state/listener identities");
    }

    @Test
    void seedsActiveVaultWithMana50AndCooldown8000Ms() {
        assertContains("ability_hero_quinn_e_vault_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_quinn_e_vault_primary_hit'\\s*,\\s*"
                        + "'provider_hero_quinn_e_vault_primary_hit'\\s*,\\s*"
                        + "'vault_primary_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "E must be active ability with stable key vault_primary_hit");
        assertContains("cost_hero_quinn_e_vault_primary_hit_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("e_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":50}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_quinn_e_vault_primary_hit_mana'\\s*,\\s*"
                        + "'ability_hero_quinn_e_vault_primary_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'e_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "E mana cost must be ability-level 50 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_quinn_e_vault_primary_hit");
        assertContains("e_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":8000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_quinn_e_vault_primary_hit'\\s*,\\s*"
                        + "'ability_hero_quinn_e_vault_primary_hit'\\s*,\\s*"
                        + "'e_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "E cooldown must be 8000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndBinaryPhysicalDamage()
        throws IOException {
        assertContains(VAULT_DAMAGE);
        assertBinaryNestedDamageFormula(VAULT_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":140");
        assertContains("\"value\":0.20");
        assertContains("\"op\":\"sub\"");
        assertFalse(
            Pattern.compile("(?is)source\\.attr\\.ap\\.resolved")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not include AP scaling for Vault Phase-A");
        assertFalse(
            Pattern.compile("(?is)\\b20221\\b").matcher(sqlNoComments).find(),
            "executable SQL must not use magic damage type 20221");
        assertContains("phase_hero_quinn_e_vault_primary_hit_impact");
        assertContains("sequence_hero_quinn_e_vault_primary_hit_impact");
        assertContains("step_hero_quinn_e_vault_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_quinn_e_vault_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_quinn_e_vault_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_quinn_e_vault_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_quinn_e_vault_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_e_vault_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_quinn_e_vault_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Vault damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_e_vault_primary_hit_damage'\\s*,\\s*"
                        + "'vault_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Vault damage must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_quinn_e_vault_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Vault primary-hit must not enable crit eligibility");
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
            "E provider graph must have zero emit_event operations (NB-ZERO-EMITTED-EVENTS-SCOPE)");
        assertFalse(
            Pattern.compile(
                    "(?i)\\bdash\\b|tracking|bounce|geometry|grounded|knockdown|"
                        + "knockback|airborne|\\bslow\\b|facing|windup|harrier|"
                        + "basic_attack_hit|spellshield|callforhelp|"
                        + "equipment|loadout|\\brepeat\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded dash/geometry/knockback/Harrier/control surfaces");
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
            sql.contains("dash") || sql.contains("Dash"),
            "seed comments must document exclusion of dash");
        assertTrue(
            sql.contains("knockback") || sql.contains("airborne") || sql.contains("slow"),
            "seed comments must document exclusion of knockback/airborne/slow");
        assertTrue(
            sql.contains("Harrier") || sql.contains("harrier"),
            "seed comments must document exclusion of Harrier mark");
        assertTrue(
            sql.contains("basic-attack reset") || sql.contains("basic_attack reset")
                || sql.contains("autoattack") || sql.contains("auto-attack"),
            "seed comments must document exclusion of basic-attack reset / autoattack");
    }

    @Test
    void readmeEntryDocumentsWToQResourceToEOrderAndCheckOnlyPreservation() {
        assertTrue(
            readme.contains("lol_generic_quinn_vault_primary_hit_seed.sql"),
            "README must list the Quinn E Vault primary-hit seed");
        assertTrue(
            readme.contains("LolGenericQuinnVaultPrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)quinn.*vault|旋翔掠杀|Vault")
                .matcher(readme)
                .find(),
            "README must name Quinn Vault");
        int seedIdx = readme.indexOf("lol_generic_quinn_vault_primary_hit_seed.sql");
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
            section.contains("lol_generic_quinn_blinding_assault_primary_hit_seed.sql"),
            "README entry must list Q Blinding Assault seed for neutral mana resource");
        assertTrue(
            section.contains("W → Q(resource) → E")
                || section.contains("W -> Q(resource) -> E")
                || section.contains("NB-MANA-RESOURCE-SEED-ORDER"),
            "README must state W -> Q(resource) -> E / NB-MANA-RESOURCE-SEED-ORDER");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|不写.*资源|资源.*check")
                .matcher(section)
                .find(),
            "README must document check-only mana resource preservation");
        assertTrue(
            Pattern.compile("(?i)provider_hero_quinn_basic_attack|"
                    + "provider_hero_quinn_heightened_senses")
                .matcher(section)
                .find(),
            "README must document basic/W provider prerequisites or coexistence");
        assertTrue(
            Pattern.compile("(?i)Q provider.*(非|不是).*硬前置|不断言 Q provider|"
                    + "not.*Q provider.*prerequisite")
                .matcher(section)
                .find(),
            "README must say Q provider is not a hard prerequisite");
        assertTrue(
            section.contains(FROZEN_BOUNDARY) || section.contains(
                "physical_140_plus_0_20_bonus_ad"),
            "README must include frozen boundary");
        for (String tag : ORDERED_TAGS) {
            assertTrue(section.contains(tag), "README ordered tags must include " + tag);
        }
        assertOrderedTagsInSection(section, "Ordered tags");
        assertTrue(
            Pattern.compile("(?i)排除|exclusion|dash|knockback|Harrier|bounce")
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
        // Repository registration order: W section before Q section before E section
        int wIdx = readme.indexOf("lol_generic_quinn_heightened_senses_seed.sql");
        int qIdx = readme.indexOf("lol_generic_quinn_blinding_assault_primary_hit_seed.sql");
        int eIdx = readme.indexOf("lol_generic_quinn_vault_primary_hit_seed.sql");
        assertTrue(
            wIdx >= 0 && qIdx > wIdx && eIdx > qIdx,
            "README registration order must be W -> Q(resource) -> E");
    }

    /**
     * Assert frozen tag order inside the Ordered-tags prose block only.
     * Boundary text may reuse tag tokens earlier (e.g. immediate_impact_scaffold).
     */
    private static void assertOrderedTagsInSection(String text, String marker) {
        int markerIdx = text.indexOf(marker);
        assertTrue(markerIdx >= 0, "must contain ordered-tags marker: " + marker);
        String after = text.substring(markerIdx);
        int prev = -1;
        for (String tag : ORDERED_TAGS) {
            int idx = after.indexOf(tag);
            assertTrue(idx >= 0, "ordered-tags section must include " + tag);
            assertTrue(idx > prev, "ordered tags must appear in frozen order: " + tag);
            prev = idx;
        }
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
        assertBinaryArithmeticComparisonArity(root, "vault_damage");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ad.resolved")
                && nodeContainsReadPath(root, "source.attr.ad.base"),
            "bonus AD must be sub(resolved, base) under nested binary AST");
        assertFalse(
            nodeContainsReadPath(root, "source.attr.ap.resolved"),
            "Vault Phase-A damage must not include AP reads");
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
