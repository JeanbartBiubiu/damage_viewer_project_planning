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
 * Static contract for {@code lol_generic_lich_bane_spellblade_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericLichBaneSpellbladeSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_lich_bane_spellblade_seed.sql";
    private static final String SPELLBLADE_PREREQ_RELATIVE =
        "db/game_manage/seeds/lol_generic_spellblade_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3100_lich_bane_spellblade",
        "listener_item_3100_lich_bane_spellblade_ability_started",
        "listener_item_3100_lich_bane_spellblade_basic_attack_hit",
        "sequence_item_3100_lich_bane_spellblade_arm",
        "sequence_item_3100_lich_bane_spellblade_proc",
        "step_item_3100_lich_bane_spellblade_ready_arm",
        "step_item_3100_lich_bane_spellblade_icd_arm",
        "step_item_3100_lich_bane_spellblade_damage",
        "step_item_3100_lich_bane_spellblade_ready_consume",
        "modifier_item_3100_lich_bane_spellblade_attack_speed",
        "spellblade_ready",
        "spellblade_icd",
        "spellblade_icd_available",
        "spellblade_ready_arm",
        "spellblade_icd_arm",
        "spellblade_ready_armed",
        "spellblade_proc_damage",
        "spellblade_ready_consume",
        "spellblade_attack_speed");

    private static String sql;
    private static String sqlNoLineComments;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        Path prereqPath = resolveRelative(SPELLBLADE_PREREQ_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        assertTrue(Files.isRegularFile(prereqPath), "spellblade prereq seed missing: " + prereqPath);
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
            "lich bane seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "lich bane seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "lich bane seed must not CASCADE");
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
    }

    @Test
    void validatesSpellbladePrerequisitesWithoutRecreatingThem() {
        assertContains("RAISE EXCEPTION");
        assertContains("item_3100");
        assertContains("hero_vayne");
        assertContains("ability_hero_vayne_tumble");
        assertContains("ability/basic_attack");
        assertContains("62003");
        assertContains("missing ability/basic_attack relation");
        assertContains("lol_generic_spellblade_seed");
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
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'attack_speed'")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard attribute_definitions attack_speed");
        assertFalse(
            Pattern.compile("(?s),\\s*62003\\s*,\\s*'ability/basic_attack'")
                .matcher(sql)
                .find(),
            "must not INSERT type 62003 ability/basic_attack row");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create ability_definitions (tumble is prerequisite)");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create type_relations for ability/basic_attack");
        assertFalse(
            sqlNoLineComments.contains("provider_hero_vayne_tumble"),
            "must not recreate vayne tumble provider");
    }

    @Test
    void mountsLichBaneSpellbladeProviderOnItem3100() {
        assertContains("provider_item_3100_lich_bane_spellblade");
        assertTrue(
            Pattern.compile("(?s)'item_3100'\\s*,\\s*'provider_item_3100_lich_bane_spellblade'")
                .matcher(sql)
                .find(),
            "must mount lich bane spellblade provider to item_3100");
        assertTrue(
            Pattern.compile("(?s)'provider_item_3100_lich_bane_spellblade'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "lich bane spellblade provider kind must be passive 20120");
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
    void abilityStartedListenerArmsReadyThenIcdWhenIcdAvailable() {
        assertContains("listener_item_3100_lich_bane_spellblade_ability_started");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3100_lich_bane_spellblade_ability_started'\\s*,\\s*20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3100_lich_bane_spellblade_ability_started'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212");
        assertContains("provider.state.spellblade_icd");
        assertContains("spellblade_icd_available");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3100_lich_bane_spellblade_ready_arm'[\\s\\S]{0,120}"
                        + "'sequence_item_3100_lich_bane_spellblade_arm'[\\s\\S]{0,40}0[\\s\\S]{0,40}20160")
                .matcher(sql)
                .find(),
            "ready arm step must be order 0 state_change");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3100_lich_bane_spellblade_icd_arm'[\\s\\S]{0,120}"
                        + "'sequence_item_3100_lich_bane_spellblade_arm'[\\s\\S]{0,40}1[\\s\\S]{0,40}20160")
                .matcher(sql)
                .find(),
            "icd arm step must be order 1 state_change");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3100_lich_bane_spellblade_ready_arm'[\\s\\S]{0,200}"
                        + "'spellblade_ready'[\\s\\S]{0,80}'spellblade_ready_arm'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "ready arm must override ready to 1");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3100_lich_bane_spellblade_icd_arm'[\\s\\S]{0,200}"
                        + "'spellblade_icd'[\\s\\S]{0,80}'spellblade_icd_arm'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "icd arm must override icd to 1");
        assertContains("\"op\":\"eq\"");
    }

    @Test
    void basicAttackHitListenerDamagesThenConsumesReadyPreserving3078Ordering() {
        assertContains("listener_item_3100_lich_bane_spellblade_basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3100_lich_bane_spellblade_basic_attack_hit'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3100_lich_bane_spellblade_basic_attack_hit'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20212");
        assertContains("provider.state.spellblade_ready");
        assertContains("spellblade_ready_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3100_lich_bane_spellblade_damage'\\s*,\\s*"
                        + "'sequence_item_3100_lich_bane_spellblade_proc'\\s*,\\s*0\\s*,\\s*20150\\s*,\\s*20111")
                .matcher(sql)
                .find(),
            "damage step must be order 0 damage to opponent (3078 ordering)");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3100_lich_bane_spellblade_ready_consume'\\s*,\\s*"
                        + "'sequence_item_3100_lich_bane_spellblade_proc'\\s*,\\s*1\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "consume step must be order 1 state_change (3078 ordering)");
        assertContains("\"op\":\"gte\"");
    }

    @Test
    void damageFormulaIsPointSevenFiveBaseAdPlusPointFourFiveResolvedApMagicNotCopyable() {
        String formula =
            "{\"op\":\"add\",\"args\":["
                + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.75},"
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.base\"}]},"
                + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.45},"
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ap.resolved\"}]}]}";
        assertContains(formula);
        assertContains("0.75");
        assertContains("0.45");
        assertContains("event.entry_source.attr.ad.base");
        assertContains("event.entry_source.attr.ap.resolved");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3100_lich_bane_spellblade_damage'\\s*,\\s*"
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
                    "(?s)'step_item_3100_lich_bane_spellblade_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "copyable_on_hit must be explicit false (phantom exclusion)");
    }

    @Test
    void attackSpeedModifierIsHalfTimesSpellbladeReadyPercentAdd() {
        String asFormula =
            "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.5},"
                + "{\"op\":\"read\",\"path\":\"provider.state.spellblade_ready\"}]}";
        assertContains(asFormula);
        assertContains("0.5");
        assertContains("spellblade_attack_speed");
        assertContains("modifier_item_3100_lich_bane_spellblade_attack_speed");
        assertContains("provider_modifiers");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3100_lich_bane_spellblade_attack_speed'\\s*,\\s*"
                        + "'provider_item_3100_lich_bane_spellblade'\\s*,\\s*"
                        + "'spellblade_attack_speed'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'attack_speed'[\\s\\S]*?"
                        + "20173\\s*,\\s*"
                        + "'spellblade_attack_speed'")
                .matcher(sql)
                .find(),
            "modifier must target attack_speed with selector 20110 and percent_add 20173");
    }

    @Test
    void citesWikiNormalizedJsonAndValidatesStableIds() {
        assertContains("current-items.normalized.json");
        assertContains("item 3100");
        assertContains("missing reserved_type");
        for (int typeId : List.of(
            20100, 20110, 20111, 20120, 20150, 20160, 20170, 20172, 20173, 20181,
            20190, 20205, 20211, 20212, 20221, 20250)) {
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
