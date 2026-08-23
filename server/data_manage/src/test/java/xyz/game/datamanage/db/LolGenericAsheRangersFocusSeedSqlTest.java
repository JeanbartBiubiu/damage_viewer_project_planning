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
 * Static contract for {@code lol_generic_ashe_rangers_focus_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericAsheRangersFocusSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_ashe_rangers_focus_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_ashe",
        "provider_hero_ashe_rangers_focus",
        "ability_hero_ashe_basic_attack",
        "ability_hero_ashe_q_rangers_focus",
        "phase_hero_ashe_basic_attack_impact",
        "sequence_hero_ashe_basic_attack_impact",
        "sequence_hero_ashe_q_on_cast",
        "step_hero_ashe_ba_normal_damage",
        "step_hero_ashe_ba_focus_snapshot",
        "step_hero_ashe_ba_flurry_first_1",
        "step_hero_ashe_ba_flurry_first_6",
        "step_hero_ashe_ba_flurry_next_1",
        "step_hero_ashe_ba_flurry_next_5",
        "step_hero_ashe_ba_flurry_first_clear",
        "step_hero_ashe_ba_emit_hit",
        "event_ref_hero_ashe_basic_attack_hit",
        "listener_hero_ashe_q_ability_started",
        "modifier_hero_ashe_rangers_focus_attack_speed",
        "focus_1",
        "focus_2",
        "focus_3",
        "focus_4",
        "focus_snapshot",
        "flurry_active",
        "flurry_first",
        "rangers_focus_cast_condition",
        "rangers_focus_attack_speed",
        "flurry_arrow_damage",
        "q_mana_cost");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20158, 20160, 20170,
        20172, 20173, 20181, 20190, 20205, 20211, 20212, 20220, 20250, 20260);

    private static final String CAST_CONDITION =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"provider.state.focus_1\"},"
            + "{\"op\":\"read\",\"path\":\"provider.state.focus_2\"}]},"
            + "{\"op\":\"add\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"provider.state.focus_3\"},"
            + "{\"op\":\"read\",\"path\":\"provider.state.focus_4\"}]}]},"
            + "{\"op\":\"const\",\"value\":4}]}";

    private static final String AS_BONUS =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.75},"
            + "{\"op\":\"read\",\"path\":\"provider.state.flurry_active\"}]}";

    private static final String ARROW_DAMAGE =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.28},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"}]}";

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
            "ashe seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "ashe seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "ashe seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "ashe seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "ashe seed must not CREATE TABLE");
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
    void validatesPrerequisitesAndProjectsRequiredReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        for (String attr : List.of(
            "hp", "mana", "ad", "attack_speed", "armor", "magic_resist",
            "hp_regen", "mana_regen", "crit_chance", "crit_damage")) {
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
        assertContains("generic_ability_cast_condition_compatibility_migration");
        assertContains("cast_condition_formula_key");
    }

    @Test
    void seedsSelfContainedHeroBaselineManaResourceAndSharedProvider() {
        assertContains("hero_ashe");
        assertContains("provider_hero_ashe_rangers_focus");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_ashe'\\s*,\\s*'hp'\\s*,\\s*610")
                .matcher(sql)
                .find()
                || (sql.contains("'hp', 610") || sql.contains("'hp',610")),
            "must seed hp 610");
        assertTrue(
            sql.contains("610") && sql.contains("280") && sql.contains("59")
                && sql.contains("0.658") && sql.contains("26") && sql.contains("30")
                && sql.contains("3.5") && sql.contains(", 7,"),
            "must seed Ashe level-1 panel numbers");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'crit_chance'\\s*,\\s*0\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "crit_chance EAV must be exactly 0");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'crit_damage'\\s*,\\s*2\\.0\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "crit_damage EAV must be exactly 2.0");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_ashe'\\s*,\\s*'provider_hero_ashe_rangers_focus'")
                .matcher(sql)
                .find(),
            "must mount shared provider to hero_ashe");
        assertTrue(
            countOccurrences(sql, "'provider_hero_ashe_rangers_focus'") >= 2,
            "shared provider must be defined and mounted");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one provider (shared Q+BA)");
        assertFalse(
            sql.contains("provider_hero_ashe_basic_attack"),
            "must not use a separate BA-only provider");
    }

    @Test
    void seedsQCastConditionManaCostAndNoOrdinaryCooldown() {
        assertContains("ability_hero_ashe_q_rangers_focus");
        assertContains("rangers_focus_cast_condition");
        assertContains(CAST_CONDITION);
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_ashe_q_rangers_focus'[\\s\\S]{0,200}"
                        + "'rangers_focus'\\s*,\\s*20130[\\s\\S]{0,80}"
                        + "'rangers_focus_cast_condition'")
                .matcher(sql)
                .find(),
            "Q must be active with cast_condition_formula_key");
        assertContains("q_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":30}");
        assertFalse(
            Pattern.compile("(?i)cooldown|冷却|\\bcd\\b").matcher(sqlNoLineComments).find(),
            "must not model ordinary Q cooldown");
    }

    @Test
    void definesFourFocusSlotsFlurryStatesAndDurations() {
        assertTrue(
            Pattern.compile(
                    "(?s)'focus_1'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1[\\s\\S]{0,20}4000"
                        + "[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "focus_1 max1 / 4000ms / refresh");
        assertTrue(
            Pattern.compile(
                    "(?s)'focus_2'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1[\\s\\S]{0,20}5000"
                        + "[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "focus_2 max1 / 5000ms / refresh");
        assertTrue(
            Pattern.compile(
                    "(?s)'focus_3'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1[\\s\\S]{0,20}6000"
                        + "[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "focus_3 max1 / 6000ms / refresh");
        assertTrue(
            Pattern.compile(
                    "(?s)'focus_4'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1[\\s\\S]{0,20}7000"
                        + "[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "focus_4 max1 / 7000ms / refresh");
        assertTrue(
            Pattern.compile(
                    "(?s)'flurry_active'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1[\\s\\S]{0,20}6000"
                        + "[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "flurry_active max1 / 6000ms / refresh");
        assertContains("focus_snapshot");
        assertContains("flurry_first");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");
    }

    @Test
    void seedsStateDrivenAttackSpeedPercentAddWithoutModifierCondition() {
        assertContains(AS_BONUS);
        assertContains("20173");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_ashe_rangers_focus_attack_speed'[\\s\\S]{0,300}"
                        + "'attack_speed'[\\s\\S]{0,120}20173\\s*,\\s*"
                        + "'rangers_focus_attack_speed'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "AS modifier must be percent_add with NULL condition_formula_key");
        assertTrue(
            Pattern.compile("\"value\":0\\.75").matcher(sql).find(),
            "rank-5 AS bonus constant must be 0.75");
    }

    @Test
    void seedsBasicAttackGraphWithFocusFlurryBranchesAndSingleEmit() {
        assertContains("ability_hero_ashe_basic_attack");
        assertContains("phase_hero_ashe_basic_attack_impact");
        assertContains("sequence_hero_ashe_basic_attack_impact");
        assertContains("step_hero_ashe_ba_normal_damage");
        assertContains("step_hero_ashe_ba_focus_snapshot");
        assertContains("flurry_inactive");
        assertContains("flurry_first_branch");
        assertContains("flurry_next_branch");
        assertContains(ARROW_DAMAGE);
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_ba_normal_damage'\\s*,\\s*"
                        + "'sequence_hero_ashe_basic_attack_impact'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*'flurry_inactive'")
                .matcher(sql)
                .find(),
            "inactive BA damage must be order 0");
        for (int i = 1; i <= 6; i++) {
            assertContains("step_hero_ashe_ba_flurry_first_" + i);
        }
        for (int i = 1; i <= 5; i++) {
            assertContains("step_hero_ashe_ba_flurry_next_" + i);
        }
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_ba_flurry_first_clear'\\s*,\\s*"
                        + "'sequence_hero_ashe_basic_attack_impact'\\s*,\\s*29\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*'flurry_first_branch'")
                .matcher(sql)
                .find(),
            "flurry_first clear must follow arrow steps at order 29");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_ba_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_ashe_basic_attack_impact'\\s*,\\s*30\\s*,\\s*"
                        + "20158")
                .matcher(sql)
                .find(),
            "emit_event must be sole terminal step order 30");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_ashe_ba_emit_hit'"),
            "emit step must appear in effect_steps and event_effect_details only");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_ba_emit_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "'event_ref_hero_ashe_basic_attack_hit'")
                .matcher(sql)
                .find(),
            "emit detail must use event/basic_attack_hit");
        assertTrue(
            countOccurrences(sql, "'flurry_arrow_damage'") >= 12,
            "6+5 flurry arrow damage details must reference flurry_arrow_damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_ba_flurry_first_1'[\\s\\S]{0,120}"
                        + "'flurry_arrow_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "flurry arrows must be physical copyable_on_hit=false");
        assertTrue(
            Pattern.compile(
                    "(?s)'basic_attack_damage'[\\s\\S]{0,80}"
                        + "\"\\$owner\\.attr\\.ad\"")
                .matcher(sql)
                .find()
                || sql.contains("\"$owner.attr.ad\""),
            "basic_attack_damage formula must remain $owner.attr.ad");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_ba_normal_damage'\\s*,\\s*"
                        + "'basic_attack_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*"
                        + "false\\s*,\\s*true")
                .matcher(sqlNoLineComments)
                .find(),
            "exactly one normal BA row must be crit_eligible=true");
        assertEquals(
            1,
            countCritEligibleTrueDamageRows(),
            "exactly one damage row must set crit_eligible true");
        assertEquals(
            11,
            countCritEligibleFalseFlurryDamageRows(),
            "all 6 first + 5 next Flurry arrows must set crit_eligible false");
    }

    @Test
    void ensuresAbilityBasicAttackTypeAndRelationCollisionSafely() {
        assertContains("62003");
        assertContains("ability/basic_attack");
        assertContains("type_id=62003 already bound");
        assertContains("type_key=ability/basic_attack already bound");
        assertTrue(
            Pattern.compile(
                    "(?is)62003[\\s\\S]{0,400}ability/basic_attack[\\s\\S]{0,400}NULL")
                .matcher(sqlNoLineComments)
                .find()
                || Pattern.compile("(?is)'ability/basic_attack'[\\s\\S]{0,200}NULL")
                    .matcher(sqlNoLineComments)
                    .find(),
            "type 62003 must set reserved_type_id NULL");
        assertTrue(
            Pattern.compile(
                    "(?s)62003\\s*,\\s*'ability'\\s*,\\s*'ability_hero_ashe_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must relate 62003 to ability_hero_ashe_basic_attack");
        assertTrue(
            sql.contains("\"role\":\"basic_attack\"")
                || sql.contains("'{\"role\":\"basic_attack\"}'"),
            "type_relations extend must use stable basic_attack role");
        assertTrue(
            Pattern.compile(
                    "(?s)type_relations\\.extend\\s+IS\\s+DISTINCT\\s+FROM\\s+EXCLUDED\\.extend")
                .matcher(sqlNoLineComments)
                .find(),
            "type_relations upsert must compare extend for material-change-only");
        assertTrue(
            Pattern.compile(
                    "(?s)crit_eligible\\s+IS\\s+DISTINCT\\s+FROM\\s+EXCLUDED\\.crit_eligible")
                .matcher(sqlNoLineComments)
                .find(),
            "damage_effect_details upsert must compare crit_eligible");
    }

    @Test
    void abilityStartedListenerClearsFocusAndArmsFlurry() {
        assertContains("listener_hero_ashe_q_ability_started");
        assertContains("sequence_hero_ashe_q_on_cast");
        assertContains("step_hero_ashe_q_clear_focus_1");
        assertContains("step_hero_ashe_q_clear_focus_4");
        assertContains("step_hero_ashe_q_clear_focus_snapshot");
        assertContains("step_hero_ashe_q_arm_flurry_active");
        assertContains("step_hero_ashe_q_arm_flurry_first");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_ashe_q_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_ashe_q_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_q_arm_flurry_active'\\s*,\\s*20250\\s*,\\s*"
                        + "'flurry_active'\\s*,\\s*'focus_slot_one'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "Q cast must arm flurry_active=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_q_arm_flurry_first'\\s*,\\s*20250\\s*,\\s*"
                        + "'flurry_first'\\s*,\\s*'focus_slot_one'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "Q cast must arm flurry_first=1");
        assertFalse(
            Pattern.compile(
                    "(?s)'step_hero_ashe_ba_emit_hit'[\\s\\S]{0,200}20205")
                .matcher(sql)
                .find(),
            "basic attack must not emit event/ability_started");
    }

    @Test
    void preservesExactlyOneDetailLayoutByConstruction() {
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            countOccurrences(sql, "'step_hero_ashe_ba_normal_damage'") >= 2,
            "normal damage must appear in effect_steps and damage_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_ashe_ba_emit_hit'") >= 2,
            "emit_hit must appear in effect_steps and event_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_ashe_q_arm_flurry_active'") >= 2,
            "arm flurry must appear in effect_steps and state_effect_details");
        assertFalse(sql.contains("heal_effect_details"), "must not mix unrelated detail families");
    }

    @Test
    void excludesTravelFrostFidelityLifeStealBuildingsRotationOtherRanksAndMigration() {
        assertFalse(
            Pattern.compile(
                    "(?i)attack.?timer|attack.?reset|攻击计时|arrow.?travel|箭矢飞行|"
                        + "life.?steal|生命偷取|omnivamp|"
                        + "building|建筑物|multi.?target|多目标|"
                        + "ability.?rotation|技能轮转|cadence")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded combat surfaces");
        assertFalse(
            Pattern.compile(
                    "(?i)critical.?slow|frost.?slow|slow.?duration|duration.?decay|"
                        + "rng.?crit|on.?crit|randuin|runaan|cheap.?shot|"
                        + "full.?fidelity|full_fidelity")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model Frost Shot slow/critical-slow/RNG/on-crit/full-fidelity");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)ability_hero_ashe_[wer]|万箭齐发|鹰击长空|魔法水晶箭")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement W/E/R");
        assertFalse(
            Pattern.compile("(?i)migration|ALTER\\s+TABLE|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
        assertFalse(
            Pattern.compile("(?i)INSERT\\s+INTO\\s+public\\.attribute_definitions")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create or alter attribute definitions");
    }

    @Test
    void documentsFrostShotWikiIdentityExpectedOnlyBoundaryAndLocalRawCaveat() {
        assertContains("Template:Data Ashe/I");
        assertContains("Template:Data Ashe/Frost Shot");
        assertContains("1306803");
        assertContains("4038216");
        assertContains("2026-06-30T07:27:41Z");
        assertContains("def2547f895e1533754e9265fd36f995a30258f11ca947cd737a70ea17df51da");
        assertContains("575de3e4c99f9a92d3edd4076d33586d4f96b4e4a8511ff5925617e526ff2e2a");
        assertContains("a8e2f81d77f85ad8d7a346ba9a3a3a354e675aa8cc9953765d5c6495f8bbd7ce");
        assertContains("5da5112e02a1c3aed266df1a424a33e8c4806c15d94991ec14c3bbaed2ca8378");
        assertTrue(
            sql.contains("local raw") && sql.contains("canonical"),
            "must document local raw vs canonical caveat");
        assertTrue(
            sql.contains("expectation-only")
                || sql.contains("expected-only")
                || sql.contains("expectation only"),
            "must document expectation-only P boundary");
        assertTrue(
            sql.contains("2.0") && (sql.contains("26.1") || sql.contains("Patch 26.1")),
            "must document current crit_damage=2.0 Patch 26.1 baseline");
        assertContains("ashe-p-frost-shot-expected-basic-attack-phase-a-v3");
        assertTrue(
            sql.contains("不扩大 Q") || sql.contains("不扩大Q")
                || sql.contains("sharing seed") || sql.contains("共享 seed"),
            "must state sharing seed does not enlarge Q Frost Shot fidelity claim");
    }

    @Test
    void citesMerakiAsheJsonAndValidatesStableIds() {
        assertContains("Ashe.json");
        assertContains("merakianalytics");
        assertContains("missing reserved_type");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
        assertEquals(6, countNamedFlurryFirstArrowSteps());
        assertEquals(5, countNamedFlurryNextArrowSteps());
    }

    private static int countCritEligibleTrueDamageRows() {
        Matcher m = Pattern.compile(
                "(?s)'(step_hero_ashe_ba_[^']+)'\\s*,\\s*'[^']+'\\s*,\\s*20220\\s*,\\s*"
                    + "20170\\s*,\\s*false\\s*,\\s*true")
            .matcher(sqlNoLineComments);
        Set<String> ids = new HashSet<>();
        while (m.find()) {
            ids.add(m.group(1));
        }
        return ids.size();
    }

    private static int countCritEligibleFalseFlurryDamageRows() {
        Matcher m = Pattern.compile(
                "(?s)'(step_hero_ashe_ba_flurry_(?:first|next)_\\d+)'\\s*,\\s*"
                    + "'flurry_arrow_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*"
                    + "false\\s*,\\s*false")
            .matcher(sqlNoLineComments);
        Set<String> ids = new HashSet<>();
        while (m.find()) {
            ids.add(m.group(1));
        }
        return ids.size();
    }

    private static int countNamedFlurryFirstArrowSteps() {
        Matcher m = Pattern.compile("step_hero_ashe_ba_flurry_first_([1-6])\\b").matcher(sql);
        Set<String> ids = new HashSet<>();
        while (m.find()) {
            ids.add(m.group(1));
        }
        return ids.size();
    }

    private static int countNamedFlurryNextArrowSteps() {
        Matcher m = Pattern.compile("step_hero_ashe_ba_flurry_next_([1-5])\\b").matcher(sql);
        Set<String> ids = new HashSet<>();
        while (m.find()) {
            ids.add(m.group(1));
        }
        return ids.size();
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
