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
 * Static contract for {@code lol_generic_kaisa_second_skin_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKaisaSecondSkinSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kaisa_second_skin_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_kaisa",
        "provider_hero_kaisa_basic_attack",
        "ability_hero_kaisa_basic_attack",
        "phase_hero_kaisa_basic_attack_impact",
        "sequence_hero_kaisa_basic_attack_damage",
        "step_hero_kaisa_caustic_wounds_damage",
        "step_hero_kaisa_plasma_stacks_add",
        "step_hero_kaisa_plasma_rupture_damage",
        "step_hero_kaisa_plasma_stacks_reset",
        "step_hero_kaisa_basic_attack_damage",
        "step_hero_kaisa_basic_attack_emit_hit",
        "event_ref_hero_kaisa_basic_attack_hit",
        "plasma_stacks",
        "caustic_wounds_damage",
        "plasma_stacks_add",
        "plasma_fifth_stack_condition",
        "plasma_rupture_missing_health",
        "plasma_stacks_reset",
        "basic_attack_damage",
        "champion_level");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20150, 20158, 20160, 20170, 20172, 20190, 20211,
        20220, 20221, 20252);

    private static final String CAUSTIC_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":["
            + "{\"op\":\"const\",\"value\":4},{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"div\",\"args\":[{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"const\",\"value\":24},{\"op\":\"const\",\"value\":4}]},"
            + "{\"op\":\"const\",\"value\":17}]},{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
            + "{\"op\":\"const\",\"value\":1}]}]}]},{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"provider.target_state.plasma_stacks\"},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"div\",\"args\":["
            + "{\"op\":\"sub\",\"args\":[{\"op\":\"const\",\"value\":6},"
            + "{\"op\":\"const\",\"value\":1}]},{\"op\":\"const\",\"value\":17}]},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
            + "{\"op\":\"const\",\"value\":1}]}]}]}]}]},{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"$owner.attr.ap\"},{\"op\":\"add\",\"args\":["
            + "{\"op\":\"const\",\"value\":0.12},{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"const\",\"value\":0.03},"
            + "{\"op\":\"read\",\"path\":\"provider.target_state.plasma_stacks\"}]}]}]}]}";

    private static final String FIFTH_STACK_CONDITION =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.target_state.plasma_stacks\"},"
            + "{\"op\":\"const\",\"value\":5}]}";

    private static final String RUPTURE_MISSING_HEALTH =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"$opponent.attr.hp.max\"},"
            + "{\"op\":\"read\",\"path\":\"$opponent.attr.hp.current\"}]},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":0.15},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.0006},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.ap\"}]}]}]}";

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
            "mount idempotent guards must use change_revision > v_locked_current");
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
            "second skin seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "second skin seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "second skin seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "second skin seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "second skin seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoLineComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoLineComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?i)legacy").matcher(sqlNoLineComments).find(),
            "must not touch legacy tables");
        assertFalse(
            Pattern.compile("(?i)jdbc:|DriverManager|Connection\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "static seed must not embed live DB client markers");
    }

    @Test
    void documentsWikiProvenanceAndExactLinearFormulas() {
        assertContains("4038390");
        assertContains("f7adc35c58f47d28f8bd098a1303cf5cfef5a414783cde389ecf07240e95515f");
        assertContains("4036514");
        assertContains("4039181");
        assertContains("kaisa-p");
        assertContains("4+(24-4)/17*(level-1)");
        assertContains("1+(6-1)/17*(level-1)");
        assertContains("0.12 + 0.03*S");
        assertContains("0.15 + 0.0006*AP");
        assertContains("artificial");
        assertTrue(
            sql.contains("tooltip") || sql.contains("presentation") || sql.contains("两位小数"),
            "must note Wiki two-decimal rounding is presentation only");
        assertTrue(
            sql.contains("before") && sql.contains("basic attack"),
            "must document Wiki note: missing-health after Caustic, before basic attack");
    }

    @Test
    void documentsExclusionsAndNoSeparatePassiveListener() {
        assertTrue(
            sql.contains("W") || sql.contains("overflow") || sql.contains("2/3"),
            "must exclude W 2/3 stack / overflow branch");
        assertTrue(
            sql.contains("400") || sql.contains("野怪") || sql.contains("monster"),
            "must exclude monster 400 cap");
        assertTrue(
            sql.contains("法术护盾") || sql.contains("spell shield"),
            "must exclude spell shield");
        assertTrue(
            sql.contains("Guinsoo") || sql.contains("phantom") || sql.contains("buff-slot"),
            "must exclude Guinsoo phantom-copy / buff-slot ordering");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create a separate passive listener");
        assertFalse(
            Pattern.compile(
                    "(?is)provider_hero_kaisa_second_skin|listener_hero_kaisa_second_skin|"
                        + "provider_hero_kaisa_plasma|listener_hero_kaisa_plasma")
                .matcher(sqlNoLineComments)
                .find(),
            "must not introduce a separate Second Skin / Plasma provider or listener");
    }

    @Test
    void failClosedPrerequisitesCoverBatchBGraphAndEmit() {
        assertContains("missing game_entities hero_kaisa");
        assertContains("missing provider_hero_kaisa_basic_attack");
        assertContains("missing ability_hero_kaisa_basic_attack");
        assertContains("missing phase_hero_kaisa_basic_attack_impact");
        assertContains("missing sequence_hero_kaisa_basic_attack_damage");
        assertContains("missing step_hero_kaisa_basic_attack_damage");
        assertContains("missing step_hero_kaisa_basic_attack_emit_hit");
        assertContains("missing event_effect_details event_ref_hero_kaisa_basic_attack_hit");
        assertContains("missing entity_provider_mounts");
        assertContains("unexpected foreign step");
        assertTrue(
            Pattern.compile("(?is)RAISE\\s+EXCEPTION").matcher(sqlNoLineComments).find(),
            "prerequisites must RAISE EXCEPTION fail-closed");
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
    void ensuresChampionLevelAttributeAndEighteenStageRows() {
        assertTrue(
            Pattern.compile(
                    "(?s)'champion_level'[\\s\\S]{0,120}'scalar'[\\s\\S]{0,40}1[\\s\\S]{0,20}18")
                .matcher(sqlNoLineComments)
                .find(),
            "champion_level must be scalar with min 1 / max 18");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kaisa'\\s*,\\s*'champion_level'\\s*,\\s*1\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "hero_kaisa champion_level base must be 1");
        assertContains("generate_series(1, 18)");
        assertTrue(
            Pattern.compile("(?is)s\\.stage::numeric|stage::numeric")
                .matcher(sqlNoLineComments)
                .find(),
            "stage rows must set value equal to stage");
        assertFalse(
            Pattern.compile("(?i)lol_batch_b_adc_entities_seed")
                .matcher(sqlNoLineComments)
                .find(),
            "must not modify shared Batch-B seed file");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entities\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate hero_kaisa / game_entities");
    }

    @Test
    void plasmaStateIsMax5Duration4000RefreshDurationOnBasicAttackProvider() {
        assertContains("refresh_duration");
        assertContains("20190");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kaisa_basic_attack'[\\s\\S]{0,40}'plasma_stacks'"
                        + "[\\s\\S]{0,40}20100[\\s\\S]{0,20}5[\\s\\S]{0,20}4000"
                        + "[\\s\\S]{0,20}20190")
                .matcher(sqlNoLineComments)
                .find(),
            "plasma_stacks must be number / max5 / 4000ms / refresh 20190 on basic-attack provider");
        assertFalse(
            Pattern.compile(
                    "(?is)provider_state_fields[\\s\\S]{0,400}default_value")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_state_fields.default_value (runtime default 0)");
    }

    @Test
    void upsertsExactCausticAddConditionRuptureAndResetFormulas() {
        assertContains(CAUSTIC_DAMAGE);
        assertContains("{\"op\":\"const\",\"value\":1}");
        assertContains(FIFTH_STACK_CONDITION);
        assertContains(RUPTURE_MISSING_HEALTH);
        assertContains("{\"op\":\"const\",\"value\":0}");
        assertContains("provider.target_state.plasma_stacks");
        assertContains("$owner.attr.champion_level");
        assertContains("$owner.attr.ap");
        assertContains("$opponent.attr.hp.max");
        assertContains("$opponent.attr.hp.current");
        assertContains("'caustic_wounds_damage'");
        assertContains("'plasma_stacks_add'");
        assertContains("'plasma_fifth_stack_condition'");
        assertContains("'plasma_rupture_missing_health'");
        assertContains("'plasma_stacks_reset'");
    }

    @Test
    void upgradesSequenceToExactOperationOrderAndDetails() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_caustic_wounds_damage'\\s*,\\s*"
                        + "'sequence_hero_kaisa_basic_attack_damage'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "order 0 must be unconditional Caustic magic damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_plasma_stacks_add'\\s*,\\s*"
                        + "'sequence_hero_kaisa_basic_attack_damage'\\s*,\\s*1\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "order 1 must unconditionally add one provider-target Plasma stack");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_plasma_rupture_damage'\\s*,\\s*"
                        + "'sequence_hero_kaisa_basic_attack_damage'\\s*,\\s*2\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*"
                        + "'plasma_fifth_stack_condition'")
                .matcher(sqlNoLineComments)
                .find(),
            "order 2 must be conditional rupture magic damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_plasma_stacks_reset'\\s*,\\s*"
                        + "'sequence_hero_kaisa_basic_attack_damage'\\s*,\\s*3\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*"
                        + "'plasma_fifth_stack_condition'")
                .matcher(sqlNoLineComments)
                .find(),
            "order 3 must conditionally reset Plasma to 0");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_basic_attack_damage'\\s*,\\s*"
                        + "'sequence_hero_kaisa_basic_attack_damage'\\s*,\\s*4\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "order 4 must keep existing physical basic-attack damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_basic_attack_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_kaisa_basic_attack_damage'\\s*,\\s*5\\s*,\\s*"
                        + "20158\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "order 5 must be the single basic_attack_hit emit");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_caustic_wounds_damage'\\s*,\\s*"
                        + "'caustic_wounds_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "Caustic detail must be magic 20221 / add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_plasma_rupture_damage'\\s*,\\s*"
                        + "'plasma_rupture_missing_health'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "rupture detail must be magic 20221 / add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_basic_attack_damage'\\s*,\\s*"
                        + "'basic_attack_damage'\\s*,\\s*20220\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "physical BA detail must remain basic_attack_damage / 20220");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_plasma_stacks_add'\\s*,\\s*20252\\s*,\\s*"
                        + "'plasma_stacks'\\s*,\\s*'plasma_stacks_add'\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "plasma add detail must use provider_target 20252 / add 20170");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_plasma_stacks_reset'\\s*,\\s*20252\\s*,\\s*"
                        + "'plasma_stacks'\\s*,\\s*'plasma_stacks_reset'\\s*,\\s*20172")
                .matcher(sqlNoLineComments)
                .find(),
            "plasma reset detail must use provider_target 20252 / override 20172");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_basic_attack_emit_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "'event_ref_hero_kaisa_basic_attack_hit'")
                .matcher(sqlNoLineComments)
                .find(),
            "emit detail must keep stable event_ref_hero_kaisa_basic_attack_hit");
        assertEquals(
            1,
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .results()
                .count(),
            "exactly one event_effect_details upsert for the stable basic_attack_hit emit");
        assertEquals(
            1,
            Pattern.compile(
                    "(?s)'step_hero_kaisa_basic_attack_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_kaisa_basic_attack_damage'\\s*,\\s*5\\s*,\\s*20158")
                .matcher(sqlNoLineComments)
                .results()
                .count(),
            "exactly one emit step at order 5 in the final sequence upsert");
    }

    @Test
    void collisionSafeOwnedStepReorderGuardsOrderUniquenessBeforeFinalUpsert() {
        assertTrue(
            sql.contains("uq_effect_steps_order")
                || sql.contains("UNIQUE (game_id, sequence_id, step_order)"),
            "seed must document uq_effect_steps_order / (game_id, sequence_id, step_order) risk");

        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_kaisa_caustic_wounds_damage[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+0")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare caustic against desired order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_kaisa_plasma_stacks_add[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+1")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare plasma_add against desired order 1");
        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_kaisa_plasma_rupture_damage[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+2")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare rupture against desired order 2");
        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_kaisa_plasma_stacks_reset[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+3")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare reset against desired order 3");
        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_kaisa_basic_attack_damage[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+4")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare BA damage against desired order 4");
        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_kaisa_basic_attack_emit_hit[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+5")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare emit against desired order 5");

        assertTrue(
            Pattern.compile(
                    "(?is)SELECT\\s+COALESCE\\s*\\(\\s*MAX\\s*\\(\\s*es\\.step_order\\s*\\)\\s*,\\s*0\\s*\\)"
                        + "[\\s\\S]*?sequence_hero_kaisa_basic_attack_damage")
                .matcher(sqlNoLineComments)
                .find(),
            "temporary order base must be derived from MAX(step_order) on the Kaisa BA sequence");
        assertTrue(
            Pattern.compile("v_temp_order_base\\s*\\+\\s*owned\\.rn")
                .matcher(sqlNoLineComments)
                .find(),
            "existing owned rows must move to distinct temporary orders above the max base");
        assertTrue(
            Pattern.compile(
                    "(?is)ROW_NUMBER\\s*\\(\\s*\\)\\s+OVER\\s*\\(\\s*ORDER\\s+BY\\s+es\\.step_id\\s*\\)")
                .matcher(sqlNoLineComments)
                .find(),
            "temporary parking must assign distinct rn per existing owned step");
        assertTrue(
            Pattern.compile(
                    "(?is)UPDATE\\s+public\\.effect_steps\\b[\\s\\S]*?"
                        + "step_order\\s*=\\s*v_temp_order_base\\s*\\+\\s*owned\\.rn")
                .matcher(sqlNoLineComments)
                .find(),
            "collision-safe phase must UPDATE existing owned effect_steps to temporary orders");

        int tempUpdateIdx =
            indexOfPattern(
                sqlNoLineComments,
                "(?is)UPDATE\\s+public\\.effect_steps\\b[\\s\\S]*?"
                    + "v_temp_order_base\\s*\\+\\s*owned\\.rn");
        int finalInsertIdx = sqlNoLineComments.indexOf("INSERT INTO public.effect_steps");
        assertTrue(tempUpdateIdx >= 0, "must contain temporary owned-step UPDATE");
        assertTrue(finalInsertIdx >= 0, "must contain final effect_steps INSERT");
        assertTrue(
            tempUpdateIdx < finalInsertIdx,
            "collision-safe temporary reorder must run before final effect_steps INSERT");

        assertTrue(
            Pattern.compile(
                    "(?is)es\\.step_id\\s+IN\\s*\\(\\s*"
                        + "'step_hero_kaisa_caustic_wounds_damage'\\s*,\\s*"
                        + "'step_hero_kaisa_plasma_stacks_add'\\s*,\\s*"
                        + "'step_hero_kaisa_plasma_rupture_damage'\\s*,\\s*"
                        + "'step_hero_kaisa_plasma_stacks_reset'\\s*,\\s*"
                        + "'step_hero_kaisa_basic_attack_damage'\\s*,\\s*"
                        + "'step_hero_kaisa_basic_attack_emit_hit'\\s*"
                        + "\\)")
                .matcher(sqlNoLineComments)
                .find(),
            "temporary reorder must only touch the six owned Second Skin BA steps");

        assertTrue(
            sql.contains("do not set v_changed here")
                || sql.contains("Temporary parking only")
                || sql.contains("rerun idempotent"),
            "seed must document that temporary reorder does not itself mark material change");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*step_id\\s*\\)\\s*"
                        + "DO\\s+UPDATE[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+EXCLUDED\\.step_order")
                .matcher(sqlNoLineComments)
                .find(),
            "final effect_steps upsert must remain conditional on actual step_order differences");
    }

    @Test
    void retainsStableIdsAndRequiredReservedVocabulary() {
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
        Set<Integer> seen = new HashSet<>();
        for (int typeId : REQUIRED_RESERVED) {
            assertTrue(seen.add(typeId), "duplicate required reserved assertion " + typeId);
            assertTrue(
                Pattern.compile("\\b" + typeId + "\\b").matcher(sqlNoLineComments).find(),
                "seed must reference reserved type " + typeId);
        }
        assertContains("game_id='lol'");
        assertContains("v_game_id            varchar(64) := 'lol'");
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "expected seed to contain: " + needle);
    }

    private static int indexOfPattern(String haystack, String regex) {
        var matcher = Pattern.compile(regex).matcher(haystack);
        return matcher.find() ? matcher.start() : -1;
    }

    private static String stripLineComments(String raw) {
        StringBuilder out = new StringBuilder(raw.length());
        for (String line : raw.split("\\R", -1)) {
            int idx = line.indexOf("--");
            out.append(idx >= 0 ? line.substring(0, idx) : line).append('\n');
        }
        return out.toString();
    }

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        Path direct = cwd.resolve(relative).normalize();
        if (Files.isRegularFile(direct)) {
            return direct;
        }
        Path fromModule = cwd.resolve("..").resolve("..").resolve(relative).normalize();
        if (Files.isRegularFile(fromModule)) {
            return fromModule;
        }
        Path cursor = cwd;
        for (int i = 0; i < 6; i++) {
            Path candidate = cursor.resolve(relative).normalize();
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
            cursor = cursor.getParent();
            if (cursor == null) {
                break;
            }
        }
        fail("unable to resolve seed path from cwd=" + cwd + " relative=" + relative);
        return direct;
    }
}
