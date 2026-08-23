package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_dusk_and_dawn_spellblade_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericDuskAndDawnSpellbladeSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_dusk_and_dawn_spellblade_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_2510_dusk_and_dawn_spellblade",
        "listener_item_2510_dusk_and_dawn_spellblade_ability_started",
        "listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit",
        "sequence_item_2510_dusk_and_dawn_spellblade_arm",
        "sequence_item_2510_dusk_and_dawn_spellblade_proc",
        "step_item_2510_dusk_and_dawn_spellblade_ready_arm",
        "step_item_2510_dusk_and_dawn_spellblade_damage",
        "step_item_2510_dusk_and_dawn_spellblade_heal",
        "step_item_2510_dusk_and_dawn_spellblade_delayed_on_hit",
        "step_item_2510_dusk_and_dawn_spellblade_icd_arm",
        "step_item_2510_dusk_and_dawn_spellblade_ready_consume",
        "spellblade_ready",
        "spellblade_icd",
        "spellblade_can_arm",
        "spellblade_ready_arm",
        "spellblade_icd_arm",
        "spellblade_ready_armed",
        "spellblade_proc_damage",
        "spellblade_proc_heal",
        "spellblade_ready_consume",
        "dusk_and_dawn_delayed_on_hit");

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
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoLineComments).find(),
            "seed must not call publish API markers");
    }

    @Test
    void rejectsDestructivePublishLegacyAndForbiddenSurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "dusk and dawn seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "dusk and dawn seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "dusk and dawn seed must not CASCADE");
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
        assertFalse(
            Pattern.compile("(?i)single_attacker_dps").matcher(sqlNoLineComments).find(),
            "must not reference single_attacker_dps");
        assertFalse(
            Pattern.compile("(?i)法力|mana\\s*restore|mana_restore")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement mana restore");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_modifiers");
        assertFalse(
            Pattern.compile("(?i)live\\s+migration|ALTER\\s+TABLE")
                .matcher(sqlNoLineComments)
                .find(),
            "must not perform live migration / ALTER TABLE");
    }

    @Test
    void validatesItem2510StaticPrerequisitesOnly() {
        assertContains("RAISE EXCEPTION");
        assertContains("item_2510");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'item_2510'")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard game_entities item_2510");
        assertTrue(
            Pattern.compile(
                    "(?is)entity_id\\s*=\\s*'item_2510'[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'ap'[\\s\\S]{0,80}base_value\\s*=\\s*60")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard item_2510 static ap=60");
        assertTrue(
            Pattern.compile(
                    "(?is)entity_id\\s*=\\s*'item_2510'[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'hp'[\\s\\S]{0,80}base_value\\s*=\\s*300")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard item_2510 static hp=300");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard attribute_definitions ad");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard attribute_definitions ap");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not mutate/recreate Batch-C entity_attribute_values");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entities\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate Batch-C game_entities");
        assertFalse(
            Pattern.compile("(?is)entity_id\\s*=\\s*'hero_vayne'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not preflight hero_vayne (independent mount)");
        assertFalse(
            Pattern.compile("(?i)ability_hero_vayne_tumble").matcher(sqlNoLineComments).find(),
            "must not preflight ability_hero_vayne_tumble");
        assertFalse(
            Pattern.compile("(?i)ability/basic_attack|62003").matcher(sqlNoLineComments).find(),
            "must not preflight ability/basic_attack 62003");
        assertFalse(
            Pattern.compile("(?i)lol_generic_spellblade_seed").matcher(sqlNoLineComments).find(),
            "must not depend on lol_generic_spellblade_seed.sql");
        assertFalse(
            Pattern.compile("(?i)item_3100|item_3508").matcher(sqlNoLineComments).find(),
            "must not depend on item_3100 / item_3508");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create ability_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create type_relations");
    }

    @Test
    void requiresHealAndRepeatReservedPrerequisitesAndProjectsTypes() {
        for (int typeId : List.of(20151, 20161, 20263)) {
            assertTrue(
                Pattern.compile("\\b" + typeId + "\\b").matcher(sqlNoLineComments).find(),
                "required reserved must include " + typeId);
        }
        assertTrue(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.types\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must project reserved → game-local types");
        assertTrue(
            Pattern.compile("(?is)type_id\\s*=\\s*ANY\\s*\\(\\s*v_required_reserved\\s*\\)")
                .matcher(sqlNoLineComments)
                .find(),
            "types projection must use v_required_reserved");
    }

    @Test
    void mountsDuskAndDawnSpellbladeProviderOnItem2510Only() {
        assertContains("provider_item_2510_dusk_and_dawn_spellblade");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_2510'\\s*,\\s*'provider_item_2510_dusk_and_dawn_spellblade'")
                .matcher(sql)
                .find(),
            "must mount dusk and dawn spellblade provider to item_2510");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_2510_dusk_and_dawn_spellblade'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "dusk and dawn spellblade provider kind must be passive 20120");
        assertContains("listener_item_2510_dusk_and_dawn_spellblade_ability_started");
        assertContains("listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit");
        assertContains("sequence_item_2510_dusk_and_dawn_spellblade_arm");
        assertContains("sequence_item_2510_dusk_and_dawn_spellblade_proc");
        assertFalse(
            Pattern.compile(
                    "(?s)entity_provider_mounts[\\s\\S]{0,400}'(?!item_2510)[a-z0-9_]+'\\s*,\\s*"
                        + "'provider_item_2510_dusk_and_dawn_spellblade'")
                .matcher(sqlNoLineComments)
                .find(),
            "provider must mount only to item_2510");
    }

    @Test
    void definesReadyAndIcdStatesWithoutDefaultValue() {
        assertContains("spellblade_ready");
        assertContains("spellblade_icd");
        assertContains("10000");
        assertContains("1500");
        assertContains("20190");
        assertTrue(
            Pattern.compile(
                    "(?s)'spellblade_ready'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1[\\s\\S]{0,40}10000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "ready state must be max 1 / duration 10000 / refresh 20190");
        assertTrue(
            Pattern.compile(
                    "(?s)'spellblade_icd'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1[\\s\\S]{0,40}1500[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "icd state must be max 1 / duration 1500 / refresh 20190");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");
        assertContains("20250");
    }

    @Test
    void abilityStartedArmsReadyOnlyWhenReadyAndIcdAreZero() {
        assertContains("listener_item_2510_dusk_and_dawn_spellblade_ability_started");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2510_dusk_and_dawn_spellblade_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2510_dusk_and_dawn_spellblade_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212 source_owner");
        String canArm =
            "{\"op\":\"mul\",\"args\":["
                + "{\"op\":\"eq\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.spellblade_ready\"},"
                + "{\"op\":\"const\",\"value\":0}]},"
                + "{\"op\":\"eq\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.spellblade_icd\"},"
                + "{\"op\":\"const\",\"value\":0}]}]}";
        assertContains(canArm);
        assertContains("spellblade_can_arm");
        assertFalse(
            Pattern.compile("\"op\"\\s*:\\s*\"(and|or|not)\"").matcher(sqlNoLineComments).find(),
            "formula VM has no and/or/not; must use numeric 0/1 gating");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_ready_arm'[\\s\\S]{0,120}"
                        + "'sequence_item_2510_dusk_and_dawn_spellblade_arm'[\\s\\S]{0,40}0"
                        + "[\\s\\S]{0,40}20160")
                .matcher(sql)
                .find(),
            "ready arm step must be order 0 state_change on arm sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_ready_arm'[\\s\\S]{0,200}"
                        + "'spellblade_ready'[\\s\\S]{0,80}'spellblade_ready_arm'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "ready arm must override ready to 1");
        assertFalse(
            Pattern.compile(
                    "(?s)'sequence_item_2510_dusk_and_dawn_spellblade_arm'[\\s\\S]{0,800}"
                        + "'step_item_2510_dusk_and_dawn_spellblade_icd_arm'")
                .matcher(sql)
                .find(),
            "arm sequence must not start ICD (ICD starts on empowered attack consume)");
    }

    @Test
    void procOrderIsDamageHealRepeatIcdThenConsumeWithSharedCondition() {
        assertContains("listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20212 source_owner");
        assertContains("spellblade_ready_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_damage'\\s*,\\s*"
                        + "'sequence_item_2510_dusk_and_dawn_spellblade_proc'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*'spellblade_ready_armed'")
                .matcher(sql)
                .find(),
            "damage step must be order 0 damage to opponent with shared condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_heal'\\s*,\\s*"
                        + "'sequence_item_2510_dusk_and_dawn_spellblade_proc'\\s*,\\s*1\\s*,\\s*"
                        + "20151\\s*,\\s*20110\\s*,\\s*'spellblade_ready_armed'")
                .matcher(sql)
                .find(),
            "heal step must be order 1 self heal with shared condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_delayed_on_hit'\\s*,\\s*"
                        + "'sequence_item_2510_dusk_and_dawn_spellblade_proc'\\s*,\\s*2\\s*,\\s*"
                        + "20161\\s*,\\s*20110\\s*,\\s*'spellblade_ready_armed'")
                .matcher(sql)
                .find(),
            "repeat step must be order 2 with shared condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_icd_arm'\\s*,\\s*"
                        + "'sequence_item_2510_dusk_and_dawn_spellblade_proc'\\s*,\\s*3\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*'spellblade_ready_armed'")
                .matcher(sql)
                .find(),
            "icd arm must be order 3 on proc");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_ready_consume'\\s*,\\s*"
                        + "'sequence_item_2510_dusk_and_dawn_spellblade_proc'\\s*,\\s*4\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*'spellblade_ready_armed'")
                .matcher(sql)
                .find(),
            "ready consume must be order 4 on proc");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_icd_arm'[\\s\\S]{0,200}"
                        + "'spellblade_icd'[\\s\\S]{0,80}'spellblade_icd_arm'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "proc icd arm must override icd to 1");
        assertContains("\"op\":\"gte\"");
    }

    @Test
    void healFormulaIsApPlusBonusHpAndSelfHealDetail() {
        String healFormula =
            "{\"op\":\"add\",\"args\":["
                + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.10},"
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ap.resolved\"}]},"
                + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.03},"
                + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0},"
                + "{\"op\":\"sub\",\"args\":["
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.hp.max\"},"
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.hp.base\"}]}]}]}]}";
        assertContains(healFormula);
        assertContains("spellblade_proc_heal");
        assertContains("event.entry_source.attr.hp.max");
        assertContains("event.entry_source.attr.hp.base");
        assertTrue(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.heal_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must write heal_effect_details");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_heal'\\s*,\\s*"
                        + "'spellblade_proc_heal'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "heal detail must use add policy 20170");
    }

    @Test
    void repeatDetailUsesCopyableScopeTagIcdGateAndDelayMs200() {
        assertTrue(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.repeat_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must write repeat_effect_details");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_delayed_on_hit'\\s*,\\s*"
                        + "20263\\s*,\\s*1\\s*,\\s*'dusk_and_dawn_delayed_on_hit'\\s*,\\s*"
                        + "'spellblade_icd'\\s*,\\s*1\\s*,\\s*200")
                .matcher(sql)
                .find(),
            "repeat detail must be scope 20263 / count 1 / tag / icd threshold 1 / delay_ms 200");
        assertContains("delay_ms");
    }

    @Test
    void collisionSafeOwnedStepReorderGuardsOrderUniquenessBeforeFinalUpsert() {
        assertTrue(
            sql.contains("uq_effect_steps_order")
                || sql.contains("UNIQUE (game_id, sequence_id, step_order)"),
            "seed must document uq_effect_steps_order / (game_id, sequence_id, step_order) risk");
        assertTrue(
            Pattern.compile(
                    "(?s)step_item_2510_dusk_and_dawn_spellblade_damage[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+0")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare damage against desired order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)step_item_2510_dusk_and_dawn_spellblade_heal[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+1")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare heal against desired order 1");
        assertTrue(
            Pattern.compile(
                    "(?s)step_item_2510_dusk_and_dawn_spellblade_delayed_on_hit[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+2")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare delayed_on_hit against desired order 2");
        assertTrue(
            Pattern.compile(
                    "(?s)step_item_2510_dusk_and_dawn_spellblade_icd_arm[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+3")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare icd_arm against desired order 3");
        assertTrue(
            Pattern.compile(
                    "(?s)step_item_2510_dusk_and_dawn_spellblade_ready_consume[\\s\\S]*?"
                        + "step_order\\s+IS\\s+DISTINCT\\s+FROM\\s+4")
                .matcher(sqlNoLineComments)
                .find(),
            "reorder guard must compare ready_consume against desired order 4");
        assertTrue(
            Pattern.compile(
                    "(?is)SELECT\\s+COALESCE\\s*\\(\\s*MAX\\s*\\(\\s*es\\.step_order\\s*\\)\\s*,\\s*0\\s*\\)"
                        + "[\\s\\S]*?sequence_item_2510_dusk_and_dawn_spellblade_proc")
                .matcher(sqlNoLineComments)
                .find(),
            "temporary order base must be derived from MAX(step_order) on the proc sequence");
        assertTrue(
            Pattern.compile("v_temp_order_base\\s*\\+\\s*owned\\.rn")
                .matcher(sqlNoLineComments)
                .find(),
            "existing owned rows must move to distinct temporary orders above the max base");
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
        int finalInsertIdx =
            sqlNoLineComments.indexOf(
                "INSERT INTO public.effect_steps (\n"
                    + "        game_id, step_id, sequence_id, step_order, operation_type_id,\n"
                    + "        target_selector_type_id, condition_formula_key, change_revision, updated_at\n"
                    + "    ) VALUES\n"
                    + "        (\n"
                    + "            v_game_id,\n"
                    + "            'step_item_2510_dusk_and_dawn_spellblade_damage'");
        if (finalInsertIdx < 0) {
            finalInsertIdx =
                indexOfPattern(
                    sqlNoLineComments,
                    "(?is)INSERT\\s+INTO\\s+public\\.effect_steps\\b[\\s\\S]*?"
                        + "'step_item_2510_dusk_and_dawn_spellblade_damage'[\\s\\S]*?"
                        + "'sequence_item_2510_dusk_and_dawn_spellblade_proc'[\\s\\S]*?0");
        }
        assertTrue(tempUpdateIdx >= 0, "must contain temporary owned-step UPDATE");
        assertTrue(finalInsertIdx >= 0, "must contain final proc effect_steps INSERT");
        assertTrue(
            tempUpdateIdx < finalInsertIdx,
            "collision-safe temporary reorder must run before final proc effect_steps INSERT");
        assertTrue(
            sql.contains("do not set v_changed here")
                || sql.contains("Temporary parking only")
                || sql.contains("rerun idempotent"),
            "seed must document that temporary reorder does not itself mark material change");
    }

    @Test
    void damageFormulaIsZeroPointSevenFiveBaseAdPlusZeroPointOneResolvedApMagicNotCopyable() {
        String formula =
            "{\"op\":\"add\",\"args\":["
                + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.75},"
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.base\"}]},"
                + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.10},"
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ap.resolved\"}]}]}";
        assertContains(formula);
        assertContains("0.75");
        assertContains("0.10");
        assertContains("event.entry_source.attr.ad.base");
        assertContains("event.entry_source.attr.ap.resolved");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_damage'\\s*,\\s*"
                        + "'spellblade_proc_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "damage detail must be magic 20221 with add policy");
        assertTrue(
            Pattern.compile("(?is)copyable_on_hit\\s*,").matcher(sqlNoLineComments).find()
                || Pattern.compile("(?is)copyable_on_hit\\s*=")
                    .matcher(sqlNoLineComments)
                    .find(),
            "must explicitly set copyable_on_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2510_dusk_and_dawn_spellblade_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "copyable_on_hit must be explicit false (phantom exclusion)");
    }

    @Test
    void citesWikiNormalizedJsonAndValidatesStableIds() {
        assertContains("current-items.normalized.json");
        assertContains("item 2510");
        assertContains("revid 4030984");
        assertContains("e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d");
        assertContains("missing reserved_type");
        for (int typeId : List.of(
            20100, 20110, 20111, 20120, 20150, 20151, 20160, 20161, 20170, 20172, 20181,
            20190, 20205, 20211, 20212, 20221, 20250, 20263)) {
            assertContains(Integer.toString(typeId));
        }
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
    }

    private static int indexOfPattern(String haystack, String regex) {
        var matcher = Pattern.compile(regex).matcher(haystack);
        return matcher.find() ? matcher.start() : -1;
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
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
        fail("unable to resolve " + relative + " from " + cwd);
        return null;
    }
}
