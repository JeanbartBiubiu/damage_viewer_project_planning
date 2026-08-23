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
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_varus_blighted_quiver_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericVarusBlightedQuiverSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_varus_blighted_quiver_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final String WIKI_SIDECAR_RELATIVE =
        "数据参考/lol-wiki-current-champions/normalized/generic/varus-w.json";

    private static final String EXPECTED_CANDIDATE =
        "hero_skill|hero_varus|W|枯萎箭袋";

    private static final String EXPECTED_SHA =
        "16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2";

    private static final String STABLE_BOUNDARY =
        "fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; "
            + "q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; "
            + "rank5; no_equipment_interop";

    private static final List<String> STABLE_IDS = List.of(
        "provider_hero_varus_w_blighted_quiver_phase_a",
        "listener_hero_varus_w_blighted_quiver_basic_attack_hit",
        "sequence_hero_varus_w_blighted_quiver_on_hit",
        "step_hero_varus_w_blighted_quiver_on_hit_damage",
        "step_hero_varus_w_blighted_quiver_blight_add",
        "ability_hero_varus_w_blighted_quiver_active",
        "blighted_quiver_phase_a_active",
        "phase_hero_varus_w_blighted_quiver_active_impact",
        "sequence_hero_varus_w_blighted_quiver_active_impact",
        "step_hero_varus_w_blighted_quiver_active_arm",
        "ability_hero_varus_w_piercing_arrow_max_charge_carrier",
        "blighted_quiver_q_max_charge_carrier",
        "phase_hero_varus_w_piercing_arrow_max_charge_carrier_impact",
        "sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact",
        "step_hero_varus_w_q_carrier_physical_damage",
        "step_hero_varus_w_q_carrier_active_missing_hp",
        "step_hero_varus_w_q_carrier_blight_detonate",
        "step_hero_varus_w_q_carrier_blight_reset",
        "step_hero_varus_w_q_carrier_active_reset",
        "blight_stacks",
        "blighted_quiver_active",
        "blighted_quiver_on_hit_magic",
        "blight_stacks_add",
        "blighted_quiver_active_arm",
        "q_carrier_physical_damage",
        "q_carrier_active_armed_condition",
        "q_carrier_active_missing_hp",
        "q_carrier_blight_present_condition",
        "q_carrier_blight_detonate",
        "blight_stacks_reset",
        "blighted_quiver_active_reset");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20160, 20170, 20172,
        20181, 20190, 20211, 20212, 20220, 20221, 20250, 20252, 20260);

    private static final String ON_HIT_MAGIC =
        "{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":40},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.15},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.base\"}]}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.25},"
            + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ap.resolved\"}]}]}";

    private static final String Q_PHYSICAL =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":360},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.20},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}]}";

    private static final String ACTIVE_MISSING_HP =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.21},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.max\"},"
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.current\"}]}]}";

    private static final String BLIGHT_DETONATE =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"mul\",\"args\":[{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.max\"},"
            + "{\"op\":\"read\",\"path\":\"provider.target_state.blight_stacks\"}]},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":0.05},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.00013},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}]},"
            + "{\"op\":\"const\",\"value\":1.5}]}";

    private static String sql;
    private static String sqlNoLineComments;
    private static String readme;

    @BeforeAll
    static void loadSeedSqlAndReadme() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = normalizeNewlines(Files.readString(seedPath, StandardCharsets.UTF_8));
        sqlNoLineComments = stripLineComments(sql);

        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = normalizeNewlines(Files.readString(readmePath, StandardCharsets.UTF_8));
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
            "mount/link idempotent guards must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?is)\\bcurrent_revision\\s*=\\s*\\d+")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not hardcode revision numbers");
    }

    @Test
    void rejectsDestructiveDdlPublishAndLegacySurfaces() {
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
            "seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoLineComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoLineComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?i)jdbc:|DriverManager|Connection\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "static seed must not embed live DB client markers");
    }

    @Test
    void documentsWikiIdentityFormulasBoundaryAndExclusions() {
        assertContains(EXPECTED_CANDIDATE);
        assertContains("1309980");
        assertContains("4026472");
        assertContains("2026-06-09");
        assertContains(EXPECTED_SHA);
        assertContains(WIKI_SIDECAR_RELATIVE);
        assertContains("Template:Data Varus/Blighted Quiver");
        assertContains("40 + 0.15*max(0, bonusAD) + 0.25*AP");
        assertContains("360 + 1.20*max(0, bonusAD)");
        assertContains("0.21*(target.hp.max-target.hp.current)");
        assertContains("0.05 + 0.00013*AP");
        assertContains("* 1.5");
        assertContains("fixed_max_charge_primary_target");
        assertContains("q_carrier_ordering_scaffold_only");
        assertContains("q_physical_then_w_active_post_q_pre_blight_then_blight_detonation");
        assertContains("no_equipment_interop");
        assertTrue(
            sql.contains("ranks1-4")
                || sql.contains("可变 Q")
                || sql.contains("cooldown refund")
                || sql.contains("Guinsoo"),
            "must document Phase-A exclusions");
        assertTrue(
            sql.contains("不 claim") || sql.contains("不 claim 真实") || sql.contains("scaffold"),
            "must not claim real Varus Q completion");
        assertFalse(
            Pattern.compile("(?i)screenshot|ocr|截图识别")
                .matcher(sqlNoLineComments)
                .find(),
            "executable SQL must not cite screenshot/OCR provenance");
    }

    @Test
    void failClosedPrerequisitesCoverBatchBGraphAndOnHitEmitWithoutRecreate() {
        assertContains("missing game_entities hero_varus");
        assertContains("missing provider_hero_varus_basic_attack");
        assertContains("missing ability_hero_varus_basic_attack");
        assertContains("missing phase_hero_varus_basic_attack_impact");
        assertContains("missing sequence_hero_varus_basic_attack_damage");
        assertContains("missing step_hero_varus_basic_attack_damage");
        assertContains("missing entity_provider_mounts hero_varus→provider_hero_varus_basic_attack");
        assertContains("missing step_hero_varus_basic_attack_emit_hit");
        assertContains("missing event_effect_details event_ref_hero_varus_basic_attack_hit");
        assertContains("lol_adc_item_on_hit_passives_seed");
        assertTrue(
            Pattern.compile("(?is)RAISE\\s+EXCEPTION").matcher(sqlNoLineComments).find(),
            "prerequisites must RAISE EXCEPTION fail-closed");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.effect_steps[\\s\\S]{0,400}"
                        + "step_hero_varus_basic_attack_emit_hit")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate step_hero_varus_basic_attack_emit_hit");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.event_effect_details[\\s\\S]{0,400}"
                        + "event_ref_hero_varus_basic_attack_hit")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate event_ref_hero_varus_basic_attack_hit");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_definitions[\\s\\S]{0,200}"
                        + "provider_hero_varus_basic_attack")
                .matcher(sqlNoLineComments)
                .find(),
            "must not rebuild provider_hero_varus_basic_attack");
        for (int typeId : REQUIRED_RESERVED) {
            assertTrue(
                sqlNoLineComments.contains(Integer.toString(typeId)),
                "must require reserved type " + typeId);
        }
        assertContains("'ad'");
        assertContains("'ap'");
        assertContains("'hp'");
    }

    @Test
    void mountsUniqueSeparateProviderAndSourceOwnerListener() {
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once (W provider only)");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_varus'\\s*,\\s*'provider_hero_varus_w_blighted_quiver_phase_a'")
                .matcher(sqlNoLineComments)
                .find(),
            "must mount W provider on hero_varus");
        assertFalse(
            Pattern.compile(
                    "(?s)'hero_varus'\\s*,\\s*'provider_hero_varus_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not rewrite basic_attack mount");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_varus_w_blighted_quiver_basic_attack_hit'\\s*,\\s*"
                        + "'provider_hero_varus_w_blighted_quiver_phase_a'\\s*,\\s*"
                        + "'blighted_quiver_on_basic_attack_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "NULL\\s*,\\s*1")
                .matcher(sqlNoLineComments)
                .find(),
            "listener must be basic_attack_hit max_triggers_per_event=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_varus_w_blighted_quiver_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20211")
                .matcher(sqlNoLineComments)
                .find(),
            "matcher must include event/basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_varus_w_blighted_quiver_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sqlNoLineComments)
                .find(),
            "matcher must include event/source_owner");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_listeners"),
            "exactly one separate passive listener");
    }

    @Test
    void pinsBothStateSchemasScopesMaxDurationRefresh() {
        assertTrue(
            Pattern.compile(
                    "(?s)'blight_stacks'\\s*,\\s*20100\\s*,\\s*3\\s*,\\s*6000\\s*,\\s*20190")
                .matcher(sqlNoLineComments)
                .find(),
            "blight_stacks must be max3 / 6000ms / refresh_duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'blighted_quiver_active'\\s*,\\s*20100\\s*,\\s*1\\s*,\\s*5500\\s*,\\s*20190")
                .matcher(sqlNoLineComments)
                .find(),
            "blighted_quiver_active must be max1 / 5500ms / refresh_duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_blighted_quiver_blight_add'\\s*,\\s*20252\\s*,\\s*"
                        + "'blight_stacks'\\s*,\\s*'blight_stacks_add'\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "blight add must use provider_target scope 20252");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_blighted_quiver_active_arm'\\s*,\\s*20250\\s*,\\s*"
                        + "'blighted_quiver_active'\\s*,\\s*'blighted_quiver_active_arm'\\s*,\\s*20172")
                .matcher(sqlNoLineComments)
                .find(),
            "active arm must override provider scope 20250");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_blight_reset'\\s*,\\s*20252\\s*,\\s*"
                        + "'blight_stacks'")
                .matcher(sqlNoLineComments)
                .find(),
            "blight reset must remain provider_target");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_active_reset'\\s*,\\s*20250\\s*,\\s*"
                        + "'blighted_quiver_active'")
                .matcher(sqlNoLineComments)
                .find(),
            "active reset must remain provider scope");
    }

    @Test
    void pinsStableWScopedAbilityIdsWithoutCostOrCooldownRows() {
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_varus_w_blighted_quiver_active'\\s*,\\s*"
                        + "'provider_hero_varus_w_blighted_quiver_phase_a'\\s*,\\s*"
                        + "'blighted_quiver_phase_a_active'\\s*,\\s*20130")
                .matcher(sqlNoLineComments)
                .find(),
            "W active ability id/key must be stable");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_varus_w_piercing_arrow_max_charge_carrier'\\s*,\\s*"
                        + "'provider_hero_varus_w_blighted_quiver_phase_a'\\s*,\\s*"
                        + "'blighted_quiver_q_max_charge_carrier'\\s*,\\s*20130")
                .matcher(sqlNoLineComments)
                .find(),
            "Q carrier ability id/key must be stable");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_cooldowns\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_cooldowns");
    }

    @Test
    void pinsExactFiveCarrierStepOrdersFormulasDamageTraitsAndConditionalResets() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_physical_damage'\\s*,\\s*"
                        + "'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150")
                .matcher(sqlNoLineComments)
                .find(),
            "carrier step0 physical");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_active_missing_hp'\\s*,\\s*"
                        + "'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact'\\s*,\\s*"
                        + "1\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*"
                        + "'q_carrier_active_armed_condition'")
                .matcher(sqlNoLineComments)
                .find(),
            "carrier step1 conditional active missing-HP");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_blight_detonate'\\s*,\\s*"
                        + "'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact'\\s*,\\s*"
                        + "2\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*"
                        + "'q_carrier_blight_present_condition'")
                .matcher(sqlNoLineComments)
                .find(),
            "carrier step2 conditional blight detonate");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_blight_reset'\\s*,\\s*"
                        + "'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact'\\s*,\\s*"
                        + "3\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'q_carrier_blight_present_condition'")
                .matcher(sqlNoLineComments)
                .find(),
            "carrier step3 conditional blight reset");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_active_reset'\\s*,\\s*"
                        + "'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact'\\s*,\\s*"
                        + "4\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'q_carrier_active_armed_condition'")
                .matcher(sqlNoLineComments)
                .find(),
            "carrier step4 conditional active reset");

        assertContains(ON_HIT_MAGIC);
        assertContains(Q_PHYSICAL);
        assertContains(ACTIVE_MISSING_HP);
        assertContains(BLIGHT_DETONATE);
        assertContains("\"value\":0.15");
        assertContains("\"value\":0.25");
        assertContains("\"value\":1.20");
        assertContains("\"value\":0.21");
        assertContains("\"value\":0.00013");
        assertContains("\"value\":1.5");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_blighted_quiver_on_hit_damage'\\s*,\\s*"
                        + "'blighted_quiver_on_hit_magic'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*"
                        + "false\\s*,\\s*false")
                .matcher(sqlNoLineComments)
                .find(),
            "passive on-hit must be magic non-copyable non-crit");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_physical_damage'\\s*,\\s*"
                        + "'q_carrier_physical_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*"
                        + "false\\s*,\\s*false")
                .matcher(sqlNoLineComments)
                .find(),
            "carrier physical must be non-copyable non-crit");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_active_missing_hp'\\s*,\\s*"
                        + "'q_carrier_active_missing_hp'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*"
                        + "false\\s*,\\s*false")
                .matcher(sqlNoLineComments)
                .find(),
            "carrier active magic must be non-copyable non-crit");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_q_carrier_blight_detonate'\\s*,\\s*"
                        + "'q_carrier_blight_detonate'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*"
                        + "false\\s*,\\s*false")
                .matcher(sqlNoLineComments)
                .find(),
            "carrier blight magic must be non-copyable non-crit");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_blighted_quiver_on_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_varus_w_blighted_quiver_on_hit'\\s*,\\s*0\\s*,\\s*20150")
                .matcher(sqlNoLineComments)
                .find(),
            "passive order: damage first");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_w_blighted_quiver_blight_add'\\s*,\\s*"
                        + "'sequence_hero_varus_w_blighted_quiver_on_hit'\\s*,\\s*1\\s*,\\s*20160")
                .matcher(sqlNoLineComments)
                .find(),
            "passive order: blight_stacks += 1 second");
    }

    @Test
    void readmeSectionPinsBoundaryAndExclusions() {
        assertTrue(
            readme.contains("Varus") || readme.contains("枯萎箭袋") || readme.contains("Blighted Quiver"),
            "README must include Varus Blighted Quiver section");
        assertTrue(
            readme.contains("lol_generic_varus_blighted_quiver_seed.sql"),
            "README must cite seed path");
        assertTrue(
            readme.contains("LolGenericVarusBlightedQuiverSeedSqlTest"),
            "README must cite static contract test");
        assertTrue(
            readme.contains("fixed_max_charge_primary_target")
                && readme.contains("q_carrier_ordering_scaffold_only")
                && readme.contains("no_equipment_interop"),
            "README must pin stable boundary string fragments");
        assertTrue(
            readme.contains(STABLE_BOUNDARY)
                || (readme.contains("q_physical_then_w_active_post_q_pre_blight_then_blight_detonation")
                    && readme.contains("rank5")),
            "README must pin full Phase-A boundary semantics");
        assertTrue(
            readme.contains("排除") || readme.contains("exclusion") || readme.contains("不建模"),
            "README must document exclusions");
        assertTrue(
            readme.contains("不自动 publish") || readme.contains("不会**自动 publish"),
            "README must note no auto-publish");
    }

    private static String normalizeNewlines(String raw) {
        return raw.replace("\r\n", "\n").replace("\r", "\n");
    }

    private static String stripLineComments(String raw) {
        StringBuilder out = new StringBuilder(raw.length());
        for (String line : raw.split("\n", -1)) {
            int idx = line.indexOf("--");
            out.append(idx >= 0 ? line.substring(0, idx) : line).append('\n');
        }
        return out.toString();
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "missing expected fragment: " + needle);
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int at = haystack.indexOf(needle, from);
            if (at < 0) {
                return count;
            }
            count++;
            from = at + needle.length();
        }
    }

    private static Path resolveRelative(String relative) {
        Path direct = Paths.get(relative);
        if (Files.isRegularFile(direct)) {
            return direct.toAbsolutePath().normalize();
        }
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        Path[] candidates = new Path[] {
            cwd.resolve(relative),
            cwd.resolve("..").resolve(relative),
            cwd.resolve("..").resolve("..").resolve(relative),
            cwd.resolve("..").resolve("..").resolve("..").resolve(relative)
        };
        for (Path candidate : candidates) {
            Path normalized = candidate.normalize();
            if (Files.isRegularFile(normalized)) {
                return normalized;
            }
        }
        fail("unable to resolve relative path: " + relative + " from cwd=" + cwd);
        return direct;
    }
}
