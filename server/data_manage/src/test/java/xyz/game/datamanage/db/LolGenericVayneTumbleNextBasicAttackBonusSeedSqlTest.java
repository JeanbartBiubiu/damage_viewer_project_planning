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
 * Static contract for {@code lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericVayneTumbleNextBasicAttackBonusSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "provider_hero_vayne_tumble",
        "ability_hero_vayne_tumble",
        "tumble",
        "tumble_empowered_attack_ready",
        "cost_hero_vayne_tumble_mana",
        "cooldown_hero_vayne_tumble",
        "phase_hero_vayne_tumble_impact",
        "sequence_hero_vayne_tumble_impact",
        "step_hero_vayne_tumble_empowered_arm",
        "sequence_hero_vayne_tumble_empowered_proc",
        "step_hero_vayne_tumble_empowered_damage",
        "step_hero_vayne_tumble_empowered_consume",
        "listener_hero_vayne_tumble_basic_attack_hit",
        "q_mana_cost",
        "q_cooldown_ms",
        "tumble_empowered_attack_ready_arm",
        "tumble_empowered_attack_ready_armed",
        "tumble_empowered_attack_ready_consume",
        "tumble_bonus_damage");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20160, 20170, 20172,
        20181, 20190, 20211, 20212, 20220, 20250, 20260);

    private static final List<String> FORBIDDEN_IDENTITY_PANEL_WRITES = List.of(
        "game_entities",
        "attribute_definitions",
        "entity_attribute_values",
        "resource_definitions",
        "entity_resource_values");

    private static final List<String> PRESERVED_SIBLING_SURFACES = List.of(
        "provider_hero_vayne_basic_attack",
        "provider_hero_vayne_silver_bolts",
        "provider_hero_vayne_e_condemn_primary_hit",
        "provider_hero_vayne_r_final_hour_timed_bonus_ad",
        "provider_item_3078_spellblade",
        "ability_hero_vayne_basic_attack",
        "step_hero_vayne_basic_attack_emit_hit");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "cast_triggered_next_ba_arm",
        "basic_attack_hit_bonus_damage",
        "provider_state_consume");

    private static final String BONUS_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.15},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.50},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String READY_ARMED =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":"
            + "\"provider.state.tumble_empowered_attack_ready\"},{\"op\":\"const\",\"value\":1}]}";

    private static final String FROZEN_BOUNDARY =
        "rank5_next_basic_attack_bonus; cast_arm_provider_state; "
            + "physical_1_15_ad_plus_0_50_ap; mana30_cooldown2000ms; "
            + "no_dash_ba_reset_invisibility_lifesteal_crit_rng_or_full_tumble";

    private static final String CANONICAL_SHA =
        "5ae387c07aa6c510a9da57df976b6e6ba9d3b52490fa91ce59e1221813fe9dad";

    private static String sql;
    private static String sqlNoLineComments;
    private static String sqlExecutable;
    private static String readme;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        sqlExecutable = stripSqlStringLiterals(sqlNoLineComments);
        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = Files.readString(readmePath, StandardCharsets.UTF_8);
    }

    @Test
    void documentsExactSourceIdentityBoundaryAndOrderedTags() {
        assertContains("hero_skill|hero_vayne|Q|闪避突袭");
        assertContains("vayne-q-tumble-next-basic-attack-bonus-phase-a-v2");
        assertContains("Template:Data Vayne/Q");
        assertContains("Template:Data Vayne/Tumble");
        assertContains("1309988");
        assertContains("4015566");
        assertContains("2026-05-05T15:55:50Z");
        assertContains("1735");
        assertContains(CANONICAL_SHA);
        assertContains("normalized/generic/vayne-q.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertTrue(
            sql.indexOf(ORDERED_TAGS.get(0)) < sql.indexOf(ORDERED_TAGS.get(1))
                && sql.indexOf(ORDERED_TAGS.get(1)) < sql.indexOf(ORDERED_TAGS.get(2))
                && sql.indexOf(ORDERED_TAGS.get(2)) < sql.indexOf(ORDERED_TAGS.get(3)),
            "ordered tags must appear in frozen order");
        assertTrue(
            Pattern.compile("(?i)无截图|无.*OCR|screenshot|OCR").matcher(sql).find(),
            "seed comments must explicitly disclaim screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon")
                .matcher(sqlNoLineComments)
                .find(),
            "must not add DDragon provenance in executable SQL");
        assertContains("20260726");
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
            "match/link idempotent guards must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoLineComments).find(),
            "seed must not call publish API markers");
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "seed must not DDL ALTER");
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
    void checkOnlyPrerequisitesAndNeverMaterializesIdentityPanelManaOrBasic() {
        assertContains("missing game_entities hero_vayne");
        assertContains("attr_key=ad");
        assertContains("attr_key=ap");
        assertContains("attr_key=mana");
        assertContains("missing entity_attribute_values hero_vayne/ad");
        assertContains("missing entity_attribute_values hero_vayne/ap");
        assertContains("missing entity_attribute_values hero_vayne/mana");
        assertContains("missing resource_definitions mana");
        assertContains("missing entity_resource_values hero_vayne/mana");
        assertContains("missing provider_hero_vayne_basic_attack");
        assertContains("missing ability_hero_vayne_basic_attack");
        assertContains("missing step_hero_vayne_basic_attack_emit_hit");
        assertContains("missing event_ref_hero_vayne_basic_attack_hit");
        assertContains("missing provider_hero_vayne_tumble");
        assertContains("missing ability_hero_vayne_tumble");
        assertContains("missing entity_provider_mounts hero_vayne/provider_hero_vayne_tumble");
        assertTrue(
            sql.contains("check-only") || sql.contains("check only"),
            "seed must document check-only prerequisites");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_vayne'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_vayne");
        for (String table : FORBIDDEN_IDENTITY_PANEL_WRITES) {
            assertFalse(
                Pattern.compile(
                        "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO|DELETE\\s+FROM)\\s+"
                            + "public\\." + table + "\\b")
                    .matcher(sqlNoLineComments)
                    .find(),
                "must not INSERT/UPDATE/MERGE/DELETE public." + table);
        }
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.games\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not INSERT into public.games");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_provider_mounts\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write entity_provider_mounts (mount is check-only prerequisite)");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details / emit_event");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.effect_steps\\b[\\s\\S]{0,500}20158")
                .matcher(sqlNoLineComments)
                .find(),
            "must not INSERT effect_steps that write operation/emit_event 20158");
        assertTrue(
            Pattern.compile("operation_type_id\\s*=\\s*20158")
                .matcher(sqlNoLineComments)
                .find(),
            "check-only may EXISTS-verify emit baseline operation_type_id=20158");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertContains("INSERT INTO public.types");
    }

    @Test
    void enrichesExactExistingTumbleIdentityWithoutCompetingQIds() {
        assertContains("provider_hero_vayne_tumble");
        assertContains("ability_hero_vayne_tumble");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_vayne_tumble'\\s*,\\s*"
                        + "'provider_hero_vayne_tumble'\\s*,\\s*"
                        + "'tumble'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "enrichment must keep ability_hero_vayne_tumble / tumble / 20130");
        assertTrue(
            Pattern.compile("(?s)'provider_hero_vayne_tumble'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "enrichment must keep provider kind 20120");
        assertTrue(
            Pattern.compile(
                    "(?is)ability_key\\s*=\\s*'tumble'[\\s\\S]{0,120}"
                        + "ability_kind_type_id\\s*=\\s*20130")
                .matcher(sqlNoLineComments)
                .find(),
            "must fail-closed check exact ability_key=tumble and kind 20130");
        assertTrue(
            Pattern.compile(
                    "(?is)provider_id\\s*=\\s*'provider_hero_vayne_tumble'[\\s\\S]{0,120}"
                        + "provider_kind_type_id\\s*=\\s*20120")
                .matcher(sqlNoLineComments)
                .find(),
            "must fail-closed check exact provider kind 20120");
        assertFalse(
            Pattern.compile("(?i)ability_hero_vayne_q_|provider_hero_vayne_q_")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create competing Q ability/provider IDs");
        assertTrue(
            Pattern.compile("ability_key\\s*=\\s*'tumble'").matcher(sqlNoLineComments).find(),
            "check-only must require ability_key = 'tumble'");
        assertFalse(
            Pattern.compile(
                    "(?s)'ability_hero_vayne_tumble'\\s*,\\s*"
                        + "'provider_hero_vayne_tumble'\\s*,\\s*'(?!tumble)[^']+'")
                .matcher(sql)
                .find(),
            "enrichment VALUES must not use a non-tumble ability_key");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertTrue(
            sql.contains("display") || sql.contains("散文") || sql.contains("enrich"),
            "seed must document display-prose enrichment / non-invariant display text");
        assertTrue(
            sql.contains("Spellblade") || sql.contains("spellblade"),
            "seed must document Spellblade order compatibility for display prose");
    }

    @Test
    void definesEmpoweredReadyStateScopeDurationRefreshAndDefault0() {
        assertContains("tumble_empowered_attack_ready");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_vayne_tumble'\\s*,\\s*"
                        + "'tumble_empowered_attack_ready'\\s*,\\s*20100\\s*,\\s*1\\s*,\\s*"
                        + "3000\\s*,\\s*20190")
                .matcher(sql)
                .find(),
            "ready state must be number / max1 / 3000ms / refresh_on_write 20190");
        assertContains("20250");
        assertTrue(
            Pattern.compile("(?i)default0|文档契约.*default0|explicit default0|运行时缺省\\s*0")
                .matcher(sql)
                .find(),
            "must document explicit default0 / runtime default 0");
        assertTrue(
            Pattern.compile("(?i)refresh_on_write").matcher(sql).find(),
            "must document refresh_on_write");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value column");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_tumble_empowered_arm'\\s*,\\s*"
                        + "20250\\s*,\\s*'tumble_empowered_attack_ready'")
                .matcher(sql)
                .find(),
            "arm state_effect_details must use state_scope/provider 20250");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_tumble_empowered_consume'\\s*,\\s*"
                        + "20250\\s*,\\s*'tumble_empowered_attack_ready'")
                .matcher(sql)
                .find(),
            "consume state_effect_details must use state_scope/provider 20250");
    }

    @Test
    void seedsQMana30Cooldown2000AndCastArmWithoutDamage() {
        assertContains("cost_hero_vayne_tumble_mana");
        assertContains("{\"op\":\"const\",\"value\":30}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_vayne_tumble_mana'\\s*,\\s*"
                        + "'ability_hero_vayne_tumble'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'q_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 30 via ability_costs");
        assertContains("cooldown_hero_vayne_tumble");
        assertContains("{\"op\":\"const\",\"value\":2000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_vayne_tumble'\\s*,\\s*"
                        + "'ability_hero_vayne_tumble'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 2000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_vayne_tumble_impact'\\s*,\\s*"
                        + "'ability_hero_vayne_tumble'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_tumble_empowered_arm'\\s*,\\s*"
                        + "'sequence_hero_vayne_tumble_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "cast arm must be sole impact state_change targeting self");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_tumble_empowered_arm'\\s*,\\s*"
                        + "20250\\s*,\\s*'tumble_empowered_attack_ready'\\s*,\\s*"
                        + "'tumble_empowered_attack_ready_arm'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "cast arm must provider-scope override ready=1");
        assertTrue(
            sql.contains("无伤害") || sql.contains("不造成伤害") || sql.contains("deals no damage")
                || sql.contains("Q cast 无伤害"),
            "seed must document Q cast deals no damage");
        assertTrue(
            sql.contains("ability_started") && (sql.contains("自然") || sql.contains("naturally")),
            "seed must document natural ability_started emission on cast");
        assertFalse(
            Pattern.compile(
                    "(?s)'sequence_hero_vayne_tumble_impact'[\\s\\S]{0,400}20150")
                .matcher(sql)
                .find(),
            "impact arm sequence must not include damage operation 20150");
    }

    @Test
    void listenerMatchesExactlyBasicAttackHitAndSourceOwnerWithout62003() {
        assertContains("listener_hero_vayne_tumble_basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_vayne_tumble_basic_attack_hit'\\s*,\\s*"
                        + "'provider_hero_vayne_tumble'\\s*,\\s*"
                        + "'tumble_on_basic_attack_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "NULL\\s*,\\s*1")
                .matcher(sql)
                .find(),
            "listener must be ability_id NULL / event 20211 / max_triggers 1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_vayne_tumble_basic_attack_hit'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_vayne_tumble_basic_attack_hit'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20212");
        assertEquals(
            2,
            countMatcherRowsForListener("listener_hero_vayne_tumble_basic_attack_hit"),
            "listener must have exactly two match rows (20211 + 20212)");
        assertFalse(
            Pattern.compile(
                    "(?s)'listener_hero_vayne_tumble_basic_attack_hit'[\\s\\S]{0,120}62003")
                .matcher(sql)
                .find(),
            "listener matcher MUST NOT include ability/basic_attack 62003");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.listener_match_types\\b[\\s\\S]{0,800}"
                        + "62003")
                .matcher(sqlNoLineComments)
                .find(),
            "listener_match_types insert block must not reference 62003");
        assertFalse(
            Pattern.compile("(?is)\\b62003\\b").matcher(sqlExecutable).find(),
            "executable SQL must not embed 62003");
    }

    @Test
    void listenerSequenceHasTwoGuardedStepsExactFormulaAndFlagsWithoutEmit() {
        assertContains(READY_ARMED);
        assertContains(BONUS_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":1.15");
        assertContains("\"value\":0.50");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_tumble_empowered_damage'\\s*,\\s*"
                        + "'sequence_hero_vayne_tumble_empowered_proc'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*"
                        + "'tumble_empowered_attack_ready_armed'")
                .matcher(sql)
                .find(),
            "damage step must be order 0 / opponent / guarded by ready_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_tumble_empowered_consume'\\s*,\\s*"
                        + "'sequence_hero_vayne_tumble_empowered_proc'\\s*,\\s*"
                        + "1\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'tumble_empowered_attack_ready_armed'")
                .matcher(sql)
                .find(),
            "consume step must be order 1 / self / guarded by ready_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_tumble_empowered_damage'\\s*,\\s*"
                        + "'tumble_bonus_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*"
                        + "false\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "damage detail must be physical add / copyable=false / crit_eligible=false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_tumble_empowered_consume'\\s*,\\s*"
                        + "20250\\s*,\\s*'tumble_empowered_attack_ready'\\s*,\\s*"
                        + "'tumble_empowered_attack_ready_consume'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "consume must provider-scope override ready=0");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_vayne_tumble_basic_attack_hit'\\s*,\\s*"
                        + "'sequence_hero_vayne_tumble_empowered_proc'")
                .matcher(sql)
                .find(),
            "listener must bind empowered proc sequence");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not emit_event via event_effect_details");
        assertTrue(
            sql.contains("crit_eligible=false") || sql.contains("crit_eligible = false")
                || sql.contains("非 crit") || sql.contains("noncrit")
                || sql.contains("non-crit"),
            "seed must document noncrit / crit_eligible=false");
        assertTrue(
            sql.contains("copyable_on_hit=false") || sql.contains("copyable_on_hit = false")
                || sql.contains("noncopyable"),
            "seed must document copyable_on_hit=false");
    }

    @Test
    void preservesBasicWESilverBoltsSpellbladeAndForbidsSiblingGraphWrites() {
        for (String preserved : PRESERVED_SIBLING_SURFACES) {
            assertTrue(
                sql.contains(preserved),
                "seed comments/checks must mention preserved surface: " + preserved);
        }
        // Check-only SELECT of basic/tumble IDs is allowed; forbid INSERT of sibling graphs.
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_definitions\\b[\\s\\S]*?"
                        + "'provider_hero_vayne_(?:basic_attack|silver_bolts|e_condemn|"
                        + "r_final_hour)")
                .matcher(sqlNoLineComments)
                .find(),
            "must not INSERT sibling Vayne providers");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_definitions\\b[\\s\\S]*?"
                        + "'provider_item_3078_spellblade'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not INSERT Spellblade provider");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.ability_definitions\\b[\\s\\S]*?"
                        + "'ability_hero_vayne_(?:basic_attack|silver|e_condemn|r_final)")
                .matcher(sqlNoLineComments)
                .find(),
            "must not INSERT sibling Vayne abilities");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.effect_steps\\b[\\s\\S]*?"
                        + "'step_hero_vayne_basic_attack")
                .matcher(sqlNoLineComments)
                .find(),
            "must not INSERT/mutate basic-attack effect steps");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b[\\s\\S]*?"
                        + "'listener_hero_vayne_silver|"
                        + "'listener_item_3078")
                .matcher(sqlNoLineComments)
                .find(),
            "must not INSERT Silver Bolts / Spellblade listeners");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must only enrich the existing tumble provider_definitions row");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_definitions"),
            "must only enrich the existing tumble ability_definitions row");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_listeners"),
            "must define exactly one listener");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must define exactly one damage detail");
    }

    @Test
    void readmeEntryDocumentsPhaseARank5NextBasicAttackBonusBoundary() {
        assertTrue(
            readme.contains("lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql"),
            "README must list the Vayne Q tumble next-BA bonus seed");
        assertTrue(
            readme.contains("LolGenericVayneTumbleNextBasicAttackBonusSeedSqlTest"),
            "README must list the focused JUnit class");
        int seedIdx =
            readme.indexOf("lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("hero_skill|hero_vayne|Q|闪避突袭"),
            "README entry must document exact stable key");
        assertTrue(
            section.contains("vayne-q-tumble-next-basic-attack-bonus-phase-a-v2")
                || section.contains(FROZEN_BOUNDARY)
                || section.contains("rank5_next_basic_attack_bonus"),
            "README entry must document frozen Phase-A boundary");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|不写|不物化").matcher(section).find(),
            "README entry must document check-only / no materialization");
        assertTrue(
            section.contains("provider_hero_vayne_tumble")
                && section.contains("ability_hero_vayne_tumble")
                && section.contains("tumble"),
            "README entry must document exact tumble identity enrichment");
        assertTrue(
            Pattern.compile("(?i)20211|basic_attack_hit").matcher(section).find()
                && Pattern.compile("(?i)20212|source_owner").matcher(section).find(),
            "README entry must document matcher 20211+20212");
        assertTrue(
            section.contains("62003") && (section.contains("不") || section.contains("MUST NOT")
                || section.contains("不得")),
            "README entry must forbid 62003 matcher");
        assertTrue(
            Pattern.compile("(?i)1\\.15|115%|0\\.50|50%|30|2000|3000").matcher(section).find(),
            "README entry must document numeric contract");
        assertTrue(
            Pattern.compile("(?i)dash|位移|BA reset|invisibility|lifesteal|吸血|crit|RNG")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertTrue(
            Pattern.compile("(?i)Spellblade|display|散文").matcher(section).find(),
            "README entry must note Spellblade display-prose order compatibility");
    }

    private static int countMatcherRowsForListener(String listenerId) {
        Matcher m =
            Pattern.compile(
                    "(?s)'" + Pattern.quote(listenerId) + "'\\s*,\\s*20181\\s*,\\s*(\\d+)")
                .matcher(sql);
        int count = 0;
        while (m.find()) {
            count++;
        }
        return count;
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    private static String stripSqlStringLiterals(String raw) {
        return Pattern.compile("'([^']|'')*'").matcher(raw).replaceAll("''");
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
