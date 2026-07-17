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
 * Static contract for {@code lol_generic_akshan_dirty_fighting_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericAkshanDirtyFightingSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_akshan_dirty_fighting_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_akshan",
        "provider_hero_akshan_basic_attack",
        "ability_hero_akshan_basic_attack",
        "phase_hero_akshan_basic_attack_impact",
        "sequence_hero_akshan_basic_attack_damage",
        "step_hero_akshan_basic_attack_damage",
        "step_hero_akshan_dirty_fighting_stacks_add",
        "step_hero_akshan_dirty_fighting_proc_damage",
        "step_hero_akshan_dirty_fighting_stacks_reset",
        "step_hero_akshan_basic_attack_emit_hit",
        "event_ref_hero_akshan_basic_attack_hit",
        "dirty_fighting_stacks",
        "dirty_fighting_stacks_add",
        "dirty_fighting_third_stack_condition",
        "dirty_fighting_proc_damage",
        "dirty_fighting_stacks_reset",
        "basic_attack_damage",
        "champion_level");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20158, 20160, 20170,
        20172, 20190, 20211, 20220, 20221, 20252, 20260);

    private static final String THIRD_STACK_CONDITION =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.target_state.dirty_fighting_stacks\"},"
            + "{\"op\":\"const\",\"value\":3}]}";

    /** Nested binary adds only — TinyGo V2 consumes two add operands. */
    private static final String PROC_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":["
            + "{\"op\":\"const\",\"value\":15},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":25},"
            + "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
            + "{\"op\":\"const\",\"value\":6}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":40},"
            + "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
            + "{\"op\":\"const\",\"value\":11}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":70},"
            + "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
            + "{\"op\":\"const\",\"value\":16}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.60},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.ap\"}]}]}";

    /** Prior flat/variadic five-argument add — silently drops later terms under TinyGo V2. */
    private static final String REJECTED_FLAT_FIVE_ARG_PROC_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":15},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":25},"
            + "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
            + "{\"op\":\"const\",\"value\":6}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":40},"
            + "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
            + "{\"op\":\"const\",\"value\":11}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":70},"
            + "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
            + "{\"op\":\"const\",\"value\":16}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.60},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.ap\"}]}]}";

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
            "mount/link idempotent guards must use change_revision > v_locked_current");
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
            "dirty fighting seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "dirty fighting seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "dirty fighting seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "dirty fighting seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "dirty fighting seed must not CREATE TABLE");
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
    void documentsWikiProvenancePanelShaAndCompletedBoundaries() {
        assertContains("4038197");
        assertContains("22ba762382dedced4b63a451c4513cb3129e3b16a137236e5b637eea7510b534");
        assertContains("akshan-p");
        assertContains("4042886");
        assertContains("98094d20a267a437b0ef667db6c67143a0e15c8f8dd27186262b0ed9f621c8a3");
        assertContains("15 + 25*gte(level,6) + 40*gte(level,11) + 70*gte(level,16) + 0.60*AP");
        assertContains("15;40;80;150");
        assertTrue(
            sql.contains("已完成") || sql.contains("completed") || sql.contains("建模"),
            "must document completed damage-core boundary");
        assertTrue(
            sql.contains("排除") || sql.contains("剩余") || sql.contains("excluded"),
            "must document excluded / remaining boundaries");
    }

    @Test
    void documentsExclusionsAndNoSeparatePassiveListener() {
        assertTrue(
            sql.contains("second shot")
                || sql.contains("第二发")
                || sql.contains("after a delay"),
            "must exclude passive second shot (delay unknown)");
        assertTrue(
            sql.contains("ability") && (sql.contains("技能") || sql.contains("ability-hit")
                || sql.contains("ability hits")),
            "must exclude ability-hit stack application");
        assertTrue(
            sql.contains("shield") || sql.contains("护盾"),
            "must exclude champion shield branch");
        assertTrue(
            sql.contains("movement") || sql.contains("移速") || sql.contains("minion")
                || sql.contains("小兵") || sql.contains("retarget") || sql.contains("换目标"),
            "must exclude non-damage second-shot / multi-target branches");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create a separate passive listener");
        assertFalse(
            Pattern.compile(
                    "(?is)provider_hero_akshan_dirty_fighting|listener_hero_akshan_dirty_fighting")
                .matcher(sqlNoLineComments)
                .find(),
            "must not introduce a separate Dirty Fighting provider or listener");
    }

    @Test
    void validatesPrerequisitesAndProjectsRequiredReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("unexpected foreign step");
        assertContains("INSERT INTO public.types");
        for (String attr : List.of(
            "hp", "mana", "ad", "ap", "attack_speed", "armor", "magic_resist",
            "hp_regen", "mana_regen")) {
            assertTrue(
                sql.contains("'" + attr + "'"),
                "must preflight or write attr_key=" + attr);
        }
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void seedsSelfContainedHeroPanelChampionLevelAndBasicAttackGraph() {
        assertContains("hero_akshan");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertContains("INSERT INTO public.ability_definitions");
        assertContains("INSERT INTO public.ability_phases");
        assertContains("INSERT INTO public.ability_phase_effect_sequences");
        assertContains("event_effect_details");
        assertTrue(
            sql.contains("610") && sql.contains("350") && sql.contains("52")
                && sql.contains("0.638") && sql.contains("26") && sql.contains("30")
                && sql.contains("3.75") && sql.contains("8.2"),
            "must seed Akshan level-1 panel numbers");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_akshan'\\s*,\\s*'ap'\\s*,\\s*0\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "level-1 panel must include ap=0");
        assertTrue(
            Pattern.compile(
                    "(?s)'champion_level'[\\s\\S]{0,120}'scalar'[\\s\\S]{0,40}1[\\s\\S]{0,20}18")
                .matcher(sqlNoLineComments)
                .find(),
            "champion_level must be scalar with min 1 / max 18");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_akshan'\\s*,\\s*'champion_level'\\s*,\\s*1\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "hero_akshan champion_level base must be 1");
        assertContains("generate_series(1, 18)");
        assertTrue(
            Pattern.compile("(?is)s\\.stage::numeric|stage::numeric")
                .matcher(sqlNoLineComments)
                .find(),
            "stage rows must set value equal to stage");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_akshan'\\s*,\\s*'provider_hero_akshan_basic_attack'")
                .matcher(sql)
                .find(),
            "must mount BA provider to hero_akshan");
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
                || Pattern.compile(
                        "(?is)'ability/basic_attack'[\\s\\S]{0,200}NULL")
                    .matcher(sqlNoLineComments)
                    .find(),
            "type 62003 must set reserved_type_id NULL");
        assertTrue(
            Pattern.compile(
                    "(?s)62003\\s*,\\s*'ability'\\s*,\\s*'ability_hero_akshan_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must relate 62003 to ability_hero_akshan_basic_attack");
    }

    @Test
    void dirtyFightingStateIsMax3Duration5000RefreshDurationProviderTarget() {
        assertContains("refresh_duration");
        assertContains("20190");
        assertContains("20252");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_akshan_basic_attack'[\\s\\S]{0,40}'dirty_fighting_stacks'"
                        + "[\\s\\S]{0,40}20100[\\s\\S]{0,20}3[\\s\\S]{0,20}5000"
                        + "[\\s\\S]{0,20}20190")
                .matcher(sqlNoLineComments)
                .find(),
            "dirty_fighting_stacks must be number / max3 / 5000ms / refresh 20190");
        assertFalse(
            Pattern.compile(
                    "(?is)provider_state_fields[\\s\\S]{0,400}default_value")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_state_fields.default_value (runtime default 0)");
    }

    @Test
    void upsertsExactAddConditionProcAndResetFormulas() {
        assertContains("{\"op\":\"read\",\"path\":\"$owner.attr.ad\"}");
        assertContains("{\"op\":\"const\",\"value\":1}");
        assertContains(THIRD_STACK_CONDITION);
        assertContains(PROC_DAMAGE);
        assertFalse(
            sql.contains(REJECTED_FLAT_FIVE_ARG_PROC_DAMAGE),
            "dirty_fighting_proc_damage must not use flat/variadic five-argument add");
        assertContains("{\"op\":\"const\",\"value\":0}");
        assertContains("provider.target_state.dirty_fighting_stacks");
        assertContains("$owner.attr.champion_level");
        assertContains("$owner.attr.ap");
        assertContains("'dirty_fighting_stacks_add'");
        assertContains("'dirty_fighting_third_stack_condition'");
        assertContains("'dirty_fighting_proc_damage'");
        assertContains("'dirty_fighting_stacks_reset'");
        assertContains("'basic_attack_damage'");
    }

    @Test
    void upgradesSequenceToExactOperationOrderPhysicalThenMagicAndDetails() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_basic_attack_damage'\\s*,\\s*"
                        + "'sequence_hero_akshan_basic_attack_damage'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "order 0 must be unconditional physical basic-attack damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_dirty_fighting_stacks_add'\\s*,\\s*"
                        + "'sequence_hero_akshan_basic_attack_damage'\\s*,\\s*1\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "order 1 must unconditionally add one provider-target Dirty Fighting stack");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_dirty_fighting_proc_damage'\\s*,\\s*"
                        + "'sequence_hero_akshan_basic_attack_damage'\\s*,\\s*2\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*"
                        + "'dirty_fighting_third_stack_condition'")
                .matcher(sqlNoLineComments)
                .find(),
            "order 2 must be conditional third-stack magic proc");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_dirty_fighting_stacks_reset'\\s*,\\s*"
                        + "'sequence_hero_akshan_basic_attack_damage'\\s*,\\s*3\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*"
                        + "'dirty_fighting_third_stack_condition'")
                .matcher(sqlNoLineComments)
                .find(),
            "order 3 must conditionally reset Dirty Fighting stacks to 0");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_basic_attack_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_akshan_basic_attack_damage'\\s*,\\s*4\\s*,\\s*"
                        + "20158\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "order 4 must be the single basic_attack_hit emit");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_basic_attack_damage'\\s*,\\s*"
                        + "'basic_attack_damage'\\s*,\\s*20220\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "physical BA detail must be basic_attack_damage / physical 20220");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_dirty_fighting_proc_damage'\\s*,\\s*"
                        + "'dirty_fighting_proc_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "proc detail must be magic 20221 / add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_dirty_fighting_stacks_add'\\s*,\\s*20252\\s*,\\s*"
                        + "'dirty_fighting_stacks'\\s*,\\s*'dirty_fighting_stacks_add'\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "stack add detail must use provider_target 20252 / add 20170");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_dirty_fighting_stacks_reset'\\s*,\\s*20252\\s*,\\s*"
                        + "'dirty_fighting_stacks'\\s*,\\s*'dirty_fighting_stacks_reset'\\s*,\\s*20172")
                .matcher(sqlNoLineComments)
                .find(),
            "stack reset detail must use provider_target 20252 / override 20172");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_basic_attack_emit_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "'event_ref_hero_akshan_basic_attack_hit'")
                .matcher(sqlNoLineComments)
                .find(),
            "emit detail must use event/basic_attack_hit and stable event_ref");

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
                    "(?s)'step_hero_akshan_basic_attack_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_akshan_basic_attack_damage'\\s*,\\s*4\\s*,\\s*20158")
                .matcher(sqlNoLineComments)
                .results()
                .count(),
            "exactly one emit step at order 4 in the final sequence upsert");
        assertEquals(
            1,
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .results()
                .count(),
            "exactly one damage_effect_details upsert family");
        assertEquals(
            1,
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.state_effect_details\\b")
                .matcher(sqlNoLineComments)
                .results()
                .count(),
            "exactly one state_effect_details upsert family");
    }

    @Test
    void collisionSafeOwnedStepReorderGuardsOrderUniquenessBeforeFinalUpsert() {
        assertTrue(
            sql.contains("uq_effect_steps_order")
                || sql.contains("UNIQUE (game_id, sequence_id, step_order)"),
            "seed must document uq_effect_steps_order / (game_id, sequence_id, step_order) risk");

        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_akshan_basic_attack_damage[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+0")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare BA damage against desired order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_akshan_dirty_fighting_stacks_add[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+1")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare stacks_add against desired order 1");
        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_akshan_dirty_fighting_proc_damage[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+2")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare proc against desired order 2");
        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_akshan_dirty_fighting_stacks_reset[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+3")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare reset against desired order 3");
        assertTrue(
            Pattern.compile(
                    "(?s)step_hero_akshan_basic_attack_emit_hit[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+4")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare emit against desired order 4");

        assertTrue(
            Pattern.compile(
                    "(?is)SELECT\\s+COALESCE\\s*\\(\\s*MAX\\s*\\(\\s*es\\.step_order\\s*\\)\\s*,\\s*0\\s*\\)"
                        + "[\\s\\S]*?sequence_hero_akshan_basic_attack_damage")
                .matcher(sqlNoLineComments)
                .find(),
            "temporary order base must be derived from MAX(step_order) on the Akshan BA sequence");
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
                        + "'step_hero_akshan_basic_attack_damage'\\s*,\\s*"
                        + "'step_hero_akshan_dirty_fighting_stacks_add'\\s*,\\s*"
                        + "'step_hero_akshan_dirty_fighting_proc_damage'\\s*,\\s*"
                        + "'step_hero_akshan_dirty_fighting_stacks_reset'\\s*,\\s*"
                        + "'step_hero_akshan_basic_attack_emit_hit'\\s*"
                        + "\\)")
                .matcher(sqlNoLineComments)
                .find(),
            "temporary reorder must only touch the five owned Dirty Fighting BA steps");

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
            if (idx >= 0) {
                // keep leading whitespace of stripped comment lines empty
                out.append(line, 0, idx);
            } else {
                out.append(line);
            }
            out.append('\n');
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
            Path parent = cursor.getParent();
            if (parent == null) {
                break;
            }
            cursor = parent;
        }
        fail("unable to resolve seed path from cwd=" + cwd + " relative=" + relative);
        return direct;
    }
}
