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
 * Static contract for {@code lol_generic_essence_reaver_spellblade_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericEssenceReaverSpellbladeSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_essence_reaver_spellblade_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3508_essence_reaver_spellblade",
        "listener_item_3508_essence_reaver_spellblade_ability_started",
        "listener_item_3508_essence_reaver_spellblade_basic_attack_hit",
        "sequence_item_3508_essence_reaver_spellblade_arm",
        "sequence_item_3508_essence_reaver_spellblade_proc",
        "step_item_3508_essence_reaver_spellblade_ready_arm",
        "step_item_3508_essence_reaver_spellblade_damage",
        "step_item_3508_essence_reaver_spellblade_icd_arm",
        "step_item_3508_essence_reaver_spellblade_ready_consume",
        "spellblade_ready",
        "spellblade_icd",
        "spellblade_can_arm",
        "spellblade_ready_arm",
        "spellblade_icd_arm",
        "spellblade_ready_armed",
        "spellblade_proc_damage",
        "spellblade_ready_consume");

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
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "essence reaver seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "essence reaver seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "essence reaver seed must not CASCADE");
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
            Pattern.compile("(?i)mana\\s*restore|mana_restore|法力").matcher(sqlNoLineComments).find(),
            "must not implement mana restore (out of DPS scope)");
    }

    @Test
    void validatesItem3508StaticPrerequisitesOnly() {
        assertContains("RAISE EXCEPTION");
        assertContains("item_3508");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'item_3508'")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard game_entities item_3508");
        assertTrue(
            Pattern.compile(
                    "(?is)entity_id\\s*=\\s*'item_3508'[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'ad'[\\s\\S]{0,80}base_value\\s*=\\s*50")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard item_3508 static ad=50");
        assertTrue(
            Pattern.compile(
                    "(?is)entity_id\\s*=\\s*'item_3508'[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'crit_chance'[\\s\\S]{0,80}base_value\\s*=\\s*0\\.25")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard item_3508 static crit_chance=0.25");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard attribute_definitions ad");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'crit_chance'")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard attribute_definitions crit_chance");
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
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create ability_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create type_relations");
        assertFalse(
            sqlNoLineComments.contains("provider_modifiers"),
            "essence reaver spellblade must not write attack_speed modifiers");
    }

    @Test
    void mountsEssenceReaverSpellbladeProviderOnItem3508() {
        assertContains("provider_item_3508_essence_reaver_spellblade");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3508'\\s*,\\s*'provider_item_3508_essence_reaver_spellblade'")
                .matcher(sql)
                .find(),
            "must mount essence reaver spellblade provider to item_3508");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3508_essence_reaver_spellblade'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "essence reaver spellblade provider kind must be passive 20120");
        assertContains("listener_item_3508_essence_reaver_spellblade_ability_started");
        assertContains("listener_item_3508_essence_reaver_spellblade_basic_attack_hit");
        assertContains("sequence_item_3508_essence_reaver_spellblade_arm");
        assertContains("sequence_item_3508_essence_reaver_spellblade_proc");
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
        assertContains("listener_item_3508_essence_reaver_spellblade_ability_started");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3508_essence_reaver_spellblade_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3508_essence_reaver_spellblade_ability_started'\\s*,\\s*"
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
                    "(?s)'step_item_3508_essence_reaver_spellblade_ready_arm'[\\s\\S]{0,120}"
                        + "'sequence_item_3508_essence_reaver_spellblade_arm'[\\s\\S]{0,40}0"
                        + "[\\s\\S]{0,40}20160")
                .matcher(sql)
                .find(),
            "ready arm step must be order 0 state_change on arm sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3508_essence_reaver_spellblade_ready_arm'[\\s\\S]{0,200}"
                        + "'spellblade_ready'[\\s\\S]{0,80}'spellblade_ready_arm'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "ready arm must override ready to 1");
        assertFalse(
            Pattern.compile(
                    "(?s)'sequence_item_3508_essence_reaver_spellblade_arm'[\\s\\S]{0,800}"
                        + "'step_item_3508_essence_reaver_spellblade_icd_arm'")
                .matcher(sql)
                .find(),
            "arm sequence must not start ICD (ICD starts on empowered attack consume)");
    }

    @Test
    void basicAttackHitDamagesThenStartsIcdThenConsumesReady() {
        assertContains("listener_item_3508_essence_reaver_spellblade_basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3508_essence_reaver_spellblade_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3508_essence_reaver_spellblade_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20212 source_owner");
        assertContains("spellblade_ready_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3508_essence_reaver_spellblade_damage'\\s*,\\s*"
                        + "'sequence_item_3508_essence_reaver_spellblade_proc'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111")
                .matcher(sql)
                .find(),
            "damage step must be order 0 damage to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3508_essence_reaver_spellblade_icd_arm'\\s*,\\s*"
                        + "'sequence_item_3508_essence_reaver_spellblade_proc'\\s*,\\s*1\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "icd arm must be order 1 on proc (ICD starts on empowered attack consume)");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3508_essence_reaver_spellblade_ready_consume'\\s*,\\s*"
                        + "'sequence_item_3508_essence_reaver_spellblade_proc'\\s*,\\s*2\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "ready consume must be order 2 on proc");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3508_essence_reaver_spellblade_icd_arm'[\\s\\S]{0,200}"
                        + "'spellblade_icd'[\\s\\S]{0,80}'spellblade_icd_arm'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "proc icd arm must override icd to 1");
        assertContains("\"op\":\"gte\"");
    }

    @Test
    void damageFormulaIsOnePointTwoFiveBaseAdPlusFiftyResolvedCritChancePhysicalNotCopyable() {
        String formula =
            "{\"op\":\"add\",\"args\":["
                + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.25},"
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.base\"}]},"
                + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":50},"
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.crit_chance.resolved\"}]}]}";
        assertContains(formula);
        assertContains("1.25");
        assertContains("event.entry_source.attr.ad.base");
        assertContains("event.entry_source.attr.crit_chance.resolved");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3508_essence_reaver_spellblade_damage'\\s*,\\s*"
                        + "'spellblade_proc_damage'\\s*,\\s*20220\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "damage detail must be physical 20220 with add policy");
        assertTrue(
            Pattern.compile("(?is)copyable_on_hit\\s*,").matcher(sqlNoLineComments).find()
                || Pattern.compile("(?is)copyable_on_hit\\s*=")
                    .matcher(sqlNoLineComments)
                    .find(),
            "must explicitly set copyable_on_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3508_essence_reaver_spellblade_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "copyable_on_hit must be explicit false (phantom exclusion)");
    }

    @Test
    void citesWikiNormalizedJsonAndValidatesStableIds() {
        assertContains("current-items.normalized.json");
        assertContains("item 3508");
        assertContains("missing reserved_type");
        for (int typeId : List.of(
            20100, 20110, 20111, 20120, 20150, 20160, 20170, 20172, 20181,
            20190, 20205, 20211, 20212, 20220, 20250)) {
            assertContains(Integer.toString(typeId));
        }
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
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
