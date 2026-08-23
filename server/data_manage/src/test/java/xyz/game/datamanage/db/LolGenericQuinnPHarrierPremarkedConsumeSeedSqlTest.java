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
 * Static contract for {@code lol_generic_quinn_p_harrier_premarked_consume_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_quinn_p_harrier_premarked_consume_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_quinn",
        "provider_hero_quinn_basic_attack",
        "provider_hero_quinn_heightened_senses",
        "listener_hero_quinn_p_harrier_premarked_consume",
        "sequence_hero_quinn_p_harrier_premarked_consume",
        "step_hero_quinn_p_harrier_premarked_consume_active_arm",
        "step_hero_quinn_p_harrier_premarked_consume_bonus_damage",
        "step_hero_quinn_p_harrier_premarked_consume_mark_clear",
        "harrier_p_level18_bonus_damage",
        "harrier_p_mark_clear",
        "heightened_senses_arm_condition",
        "heightened_senses_active_arm",
        "harrier_vulnerable",
        "heightened_senses_active");

    private static final List<String> W_OWNED_CHECK_ONLY_IDS = List.of(
        "listener_hero_quinn_heightened_senses_basic_attack_hit",
        "modifier_hero_quinn_heightened_senses_attack_speed",
        "sequence_hero_quinn_heightened_senses_arm",
        "step_hero_quinn_heightened_senses_active_arm",
        "step_hero_quinn_basic_attack_emit_hit",
        "event_ref_hero_quinn_basic_attack_hit");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20110, 20111, 20150, 20160, 20170, 20172, 20181, 20211, 20212, 20220, 20250,
        20252);

    private static final List<String> ORDERED_TAGS = List.of(
        "on_hit",
        "formula_on_hit",
        "bonus_ad_ratio",
        "copyable_on_hit_false",
        "provider_target_state_consume");

    private static final String HARRIER_P_LEVEL18_BONUS_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":120},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.40},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final String HARRIER_P_MARK_CLEAR =
        "{\"op\":\"const\",\"value\":0}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "level18_preexisting_harrier_target_single_basic_attack_consume; "
            + "bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; "
            + "no_mark_generation_ability_application_duration_reveal_valor_targeting_"
            + "monster_bonus_r_disable_parry_or_other_levels";

    private static final String CANONICAL_SHA =
        "740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c";

    private static final String LOCAL_RAW_SHA =
        "08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731";

    private static String sql;
    private static String sqlNoComments;
    private static String readme;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        byte[] bytes = Files.readAllBytes(seedPath);
        sql = new String(bytes, StandardCharsets.UTF_8);
        assertEquals(
            sql,
            Files.readString(seedPath, StandardCharsets.UTF_8),
            "seed must be valid UTF-8 without replacement");
        assertFalse(sql.contains("\uFFFD"), "seed must not contain UTF-8 replacement char");
        assertTrue(
            sql.contains("侵扰") && sql.contains("奎因"),
            "seed must preserve Chinese identity glyphs as UTF-8");
        sqlNoComments = stripSqlComments(sql);
        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = Files.readString(readmePath, StandardCharsets.UTF_8);
    }

    @Test
    void documentsSourceIdentityBoundaryOrderedTagsAndLocalRawCaveat() {
        assertContains("hero_skill|hero_quinn|P|侵扰");
        assertContains("wasm-generic-quinn-harrier-premarked-consume");
        assertContains("quinn-p-harrier-premarked-consume-phase-a-v2");
        assertContains("Template:Data Quinn/I");
        assertContains("Template:Data Quinn/Harrier");
        assertContains("1308953");
        assertContains("4024765");
        assertContains("2026-06-03T00:49:03Z");
        assertContains("2390");
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
        assertContains("normalized/generic/quinn-p.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertTrue(
            sql.indexOf("on_hit") < sql.indexOf("formula_on_hit")
                && sql.indexOf("formula_on_hit") < sql.indexOf("bonus_ad_ratio")
                && sql.indexOf("bonus_ad_ratio") < sql.indexOf("copyable_on_hit_false")
                && sql.indexOf("copyable_on_hit_false")
                    < sql.indexOf("provider_target_state_consume"),
            "ordered tags must appear in exact documented order");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("120 + 0.40") || sql.contains("120+0.40")
                    || sql.contains("bonus physical 120")),
            "seed comments must document level18 bonus physical 120 + 0.40*bonusAD");
        assertTrue(
            sql.contains("frame combat target") || sql.contains("帧战斗目标")
                || sql.contains("按帧战斗目标"),
            "seed must explain runtime stores provider_target by frame combat target");
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
            "match/link idempotent guards must use change_revision > v_locked_current");
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
            "P harrier premarked consume seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "P harrier premarked consume seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "P harrier premarked consume seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "P harrier premarked consume seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "P harrier premarked consume seed must not CREATE TABLE");
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
    void validatesWThenPPrerequisitesAndQeNonPrerequisites() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("lol_generic_quinn_heightened_senses_seed.sql");
        assertContains("W -> P");
        assertTrue(
            sql.contains("Q / E") || sql.contains("Q/E")
                || sql.contains("Q · E") || sql.contains("Q·E"),
            "seed must document Q/E are not prerequisites");
        assertTrue(
            Pattern.compile("(?i)不是.*前置|非前置|not.*prereq|非.*前置")
                .matcher(sql)
                .find(),
            "seed must state Q/E are not prerequisites");
        assertFalse(
            Pattern.compile(
                    "(?is)missing\\s+provider_hero_quinn_q_|missing\\s+"
                        + "provider_hero_quinn_e_|blinding_assault_primary_hit_seed|"
                        + "vault_primary_hit_seed")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not treat Q/E seeds/providers as hard prerequisites");
        assertContains("missing game_entities hero_quinn");
        assertContains("missing entity_attribute_values hero_quinn/ad");
        assertContains("missing provider_hero_quinn_basic_attack");
        assertContains("missing provider_hero_quinn_heightened_senses");
        assertContains("harrier_vulnerable");
        assertContains("heightened_senses_active");
        assertContains("heightened_senses_arm_condition");
        assertContains("heightened_senses_active_arm");
        assertContains("modifier_hero_quinn_heightened_senses_attack_speed");
        assertContains("listener_hero_quinn_heightened_senses_basic_attack_hit");
        assertContains("step_hero_quinn_basic_attack_emit_hit");
        assertContains("event_ref_hero_quinn_basic_attack_hit");
        assertContains("INSERT INTO public.types");
        Matcher attrsArray = Pattern.compile(
                "(?is)v_required_attrs\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]")
            .matcher(sqlNoComments);
        assertTrue(attrsArray.find(), "must declare v_required_attrs array");
        assertTrue(
            attrsArray.group(1).contains("'ad'"),
            "attr preflight must include ad");
        assertEquals(
            1,
            countOccurrences(attrsArray.group(1), "'") / 2,
            "attr preflight array must list exactly ad");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.provider_state_fields\\b[\\s\\S]{0,280}"
                        + "'harrier_vulnerable'[\\s\\S]{0,200}max_value\\s*=\\s*1")
                .matcher(sqlNoComments)
                .find(),
            "must EXISTS-check harrier_vulnerable max1 untimed (provider_target contract)");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.provider_state_fields\\b[\\s\\S]{0,280}"
                        + "'heightened_senses_active'[\\s\\S]{0,200}duration_ms\\s*=\\s*2000"
                        + "[\\s\\S]{0,80}20190")
                .matcher(sqlNoComments)
                .find(),
            "must EXISTS-check heightened_senses_active max1/2000ms/refresh_duration");
    }

    @Test
    void forbidsProviderMountEntityResourcePanelAndWOwnedUpserts() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_definitions\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not INSERT provider_definitions (reuse existing W provider)");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_provider_mounts\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not INSERT entity_provider_mounts");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entities\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not materialize/rewrite game_entities");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write entity_attribute_values / panel");
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
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write W provider_state_fields");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write W provider_modifiers");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_definitions\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write ability_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_cooldowns\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write ability_cooldowns");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_phases\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write ability_phases");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write event_effect_details / emit_event");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_formulas\\b[\\s\\S]{0,500}"
                        + "'heightened_senses_arm_condition'")
                .matcher(sqlNoComments)
                .find(),
            "must not upsert W heightened_senses_arm_condition formula");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_formulas\\b[\\s\\S]{0,500}"
                        + "'heightened_senses_active_arm'")
                .matcher(sqlNoComments)
                .find(),
            "must not upsert W heightened_senses_active_arm formula");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_formulas\\b[\\s\\S]{0,500}"
                        + "'heightened_senses_attack_speed'")
                .matcher(sqlNoComments)
                .find(),
            "must not upsert W heightened_senses_attack_speed formula");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b[\\s\\S]{0,220}"
                        + "'listener_hero_quinn_heightened_senses_basic_attack_hit'")
                .matcher(sqlNoComments)
                .find(),
            "must not upsert W basic-attack listener");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.effect_sequences\\b[\\s\\S]{0,220}"
                        + "'sequence_hero_quinn_heightened_senses_arm'")
                .matcher(sqlNoComments)
                .find(),
            "must not upsert W arm sequence");
        for (String id : W_OWNED_CHECK_ONLY_IDS) {
            assertTrue(sql.contains(id), "seed must check-only reference W-owned " + id);
        }
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    @Test
    void seedsExactPFormulasListenerSequenceAndThreeOrderedSteps() throws IOException {
        assertContains(HARRIER_P_LEVEL18_BONUS_DAMAGE);
        assertContains(HARRIER_P_MARK_CLEAR);
        assertBinaryNestedDamageFormula(HARRIER_P_LEVEL18_BONUS_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":120");
        assertContains("\"value\":0.40");
        assertContains("\"op\":\"sub\"");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_formulas"),
            "must have exactly one provider_formulas insert block (P formulas only)");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_quinn_heightened_senses'\\s*,\\s*"
                        + "'harrier_p_level18_bonus_damage'")
                .matcher(sqlNoComments)
                .find(),
            "bonus damage formula must hang under existing W provider");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_quinn_heightened_senses'\\s*,\\s*"
                        + "'harrier_p_mark_clear'")
                .matcher(sqlNoComments)
                .find(),
            "mark clear formula must hang under existing W provider");

        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_listeners"),
            "exactly one P listener");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_quinn_p_harrier_premarked_consume'\\s*,\\s*"
                        + "'provider_hero_quinn_heightened_senses'\\s*,\\s*"
                        + "'harrier_premarked_consume_on_basic_attack_hit'\\s*,\\s*"
                        + "20211\\s*,\\s*NULL\\s*,\\s*1")
                .matcher(sqlNoComments)
                .find(),
            "P listener must be under W provider, basic_attack_hit, no ability, max1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_quinn_p_harrier_premarked_consume'\\s*,\\s*"
                        + "20181\\s*,\\s*20211")
                .matcher(sqlNoComments)
                .find(),
            "matcher must include event/basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_quinn_p_harrier_premarked_consume'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sqlNoComments)
                .find(),
            "matcher must include event/source_owner");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.effect_sequences"),
            "exactly one P sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'sequence_hero_quinn_p_harrier_premarked_consume'\\s*,\\s*"
                        + "'provider_hero_quinn_heightened_senses'\\s*,\\s*"
                        + "'harrier_premarked_consume'")
                .matcher(sqlNoComments)
                .find(),
            "P sequence must hang under existing W provider");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_quinn_p_harrier_premarked_consume'\\s*,\\s*"
                        + "'sequence_hero_quinn_p_harrier_premarked_consume'")
                .matcher(sqlNoComments)
                .find(),
            "listener must link exactly the P sequence");

        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.effect_steps"),
            "exactly one effect_steps insert block with three ordered steps");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_p_harrier_premarked_consume_active_arm'\\s*,\\s*"
                        + "'sequence_hero_quinn_p_harrier_premarked_consume'\\s*,\\s*"
                        + "0\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'heightened_senses_arm_condition'")
                .matcher(sqlNoComments)
                .find(),
            "step0 must arm active via state_change self + W arm condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_p_harrier_premarked_consume_bonus_damage'\\s*,\\s*"
                        + "'sequence_hero_quinn_p_harrier_premarked_consume'\\s*,\\s*"
                        + "1\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*"
                        + "'heightened_senses_arm_condition'")
                .matcher(sqlNoComments)
                .find(),
            "step1 must deal physical to opponent under W arm condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_p_harrier_premarked_consume_mark_clear'\\s*,\\s*"
                        + "'sequence_hero_quinn_p_harrier_premarked_consume'\\s*,\\s*"
                        + "2\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'heightened_senses_arm_condition'")
                .matcher(sqlNoComments)
                .find(),
            "step2 mark consume must use selector/self 20110 under W arm condition");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_p_harrier_premarked_consume_active_arm'\\s*,\\s*"
                        + "20250\\s*,\\s*'heightened_senses_active'\\s*,\\s*"
                        + "'heightened_senses_active_arm'\\s*,\\s*20172")
                .matcher(sqlNoComments)
                .find(),
            "step0 detail must override heightened_senses_active via provider scope 20250");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_p_harrier_premarked_consume_mark_clear'\\s*,\\s*"
                        + "20252\\s*,\\s*'harrier_vulnerable'\\s*,\\s*"
                        + "'harrier_p_mark_clear'\\s*,\\s*20172")
                .matcher(sqlNoComments)
                .find(),
            "step2 detail must clear harrier_vulnerable via provider_target 20252");
        assertFalse(
            Pattern.compile(
                    "(?s)'step_hero_quinn_p_harrier_premarked_consume_mark_clear'"
                        + "[\\s\\S]{0,120}20111")
                .matcher(sqlNoComments)
                .find(),
            "mark consume step must never use selector/opponent 20111");
        assertFalse(
            Pattern.compile(
                    "(?s)'step_hero_quinn_p_harrier_premarked_consume_mark_clear'\\s*,\\s*"
                        + "20111\\s*,\\s*20252|"
                        + "'step_hero_quinn_p_harrier_premarked_consume_mark_clear'"
                        + "[\\s\\S]{0,80}20111[\\s\\S]{0,80}20252")
                .matcher(sqlNoComments)
                .find(),
            "forbid consume encoding 20111+20252");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_p_harrier_premarked_consume_bonus_damage'\\s*,\\s*"
                        + "'harrier_p_level18_bonus_damage'\\s*,\\s*20220\\s*,\\s*"
                        + "20170\\s*,\\s*false\\s*,\\s*false")
                .matcher(sqlNoComments)
                .find(),
            "bonus damage must be physical 20220 add, copyable_on_hit=false, crit_eligible=false");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "P bonus damage must not enable crit eligibility");
        assertFalse(
            Pattern.compile("(?is)\\b20221\\b").matcher(sqlNoComments).find(),
            "executable SQL must not use magic damage type 20221");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            sql.contains("order-independent") || sql.contains("顺序无关")
                || sql.contains("order independent"),
            "seed must document P step1/step0 order-independent active=1 vs W listener");
    }

    @Test
    void excludesForbiddenSurfacesAndMarkProduction() {
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
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write modifier_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.state_effect_details\\b[\\s\\S]{0,400}"
                        + "'harrier_vulnerable'[\\s\\S]{0,80}'harrier_p_level18|"
                        + "amount_formula_key\\s*=\\s*'heightened_senses_active_arm'"
                        + "[\\s\\S]{0,80}'harrier_vulnerable'")
                .matcher(sqlNoComments)
                .find(),
            "must not produce/forge harrier_vulnerable mark via non-clear writes");
        assertFalse(
            Pattern.compile(
                    "(?is)'harrier_vulnerable'\\s*,\\s*'[^']+'\\s*,\\s*20170")
                .matcher(sqlNoComments)
                .find(),
            "must not add/increment harrier_vulnerable (consume only override=0)");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoComments)
                .find(),
            "must not include live migration");
        assertTrue(
            sql.contains("mark") || sql.contains("标记") || sql.contains("generation"),
            "seed comments must document exclusion of mark generation");
        assertTrue(
            sql.contains("Valor") || sql.contains("valor"),
            "seed comments must document exclusion of Valor targeting");
        assertTrue(
            sql.contains("monster") || sql.contains("parry") || sql.contains("reveal"),
            "seed comments must document exclusion of monster/parry/reveal surfaces");
    }

    @Test
    void readmeEntryDocumentsWThenPOrderQeIndependenceAndContract() {
        assertTrue(
            readme.contains("lol_generic_quinn_p_harrier_premarked_consume_seed.sql"),
            "README must list the Quinn P Harrier premarked consume seed");
        assertTrue(
            readme.contains("LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)quinn.*harrier|侵扰|Harrier|premarked|预标记")
                .matcher(readme)
                .find(),
            "README must name Quinn P Harrier / 侵扰");
        int seedIdx = readme.indexOf("lol_generic_quinn_p_harrier_premarked_consume_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        int wSection = readme.indexOf("### LoL generic Quinn Heightened Senses seed");
        int qSection = readme.indexOf(
            "### LoL generic Quinn Blinding Assault primary-hit seed");
        assertTrue(wSection >= 0 && qSection > wSection, "W and Q README sections must exist");
        assertTrue(
            sectionStart > wSection && sectionStart < qSection,
            "P README section must sit immediately after Quinn W and before Q/E");
        assertTrue(
            section.contains("lol_generic_quinn_heightened_senses_seed.sql"),
            "README entry must list W Heightened Senses seed as prerequisite");
        assertTrue(
            Pattern.compile("(?i)W\\s*->\\s*P|W → P|W → P → Q")
                .matcher(section)
                .find()
                || section.contains("W → P → Q(resource) → E")
                || section.contains("W -> P -> Q(resource) -> E"),
            "README must document execution order W -> P -> Q(resource) -> E");
        assertTrue(
            Pattern.compile("(?i)P.*[Ww].*only|[Ww].*only|仅需\\s*W|只需要\\s*W|needs W only|"
                    + "P 仅需 W|P.*只依赖 W")
                .matcher(section)
                .find()
                || (section.contains("P") && section.contains("W")
                    && Pattern.compile("(?i)Q/E|Q · E|Q和E|Q/E.*独立|独立.*Q")
                        .matcher(section)
                        .find()),
            "README must state P needs W only and Q/E are independent later seeds");
        assertTrue(
            section.contains(FROZEN_BOUNDARY) || section.contains(
                "bonus_physical_120_plus_0_40_bonus_ad"),
            "README must include frozen boundary");
        for (String tag : ORDERED_TAGS) {
            assertTrue(section.contains(tag), "README ordered tags must include " + tag);
        }
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not claim live execution or publication");
        assertTrue(
            section.contains("mvn -Dtest=LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest"),
            "README must document the focused Maven test command");
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
        assertBinaryArithmeticComparisonArity(root, "harrier_p_level18_bonus_damage");
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
