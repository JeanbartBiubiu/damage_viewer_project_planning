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
 * Static contract for {@code lol_generic_spellblade_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericSpellbladeSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_spellblade_seed.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final List<String> BASIC_ATTACK_ABILITIES = List.of(
        "ability_hero_kaisa_basic_attack",
        "ability_hero_kogmaw_basic_attack",
        "ability_hero_teemo_basic_attack",
        "ability_hero_twitch_basic_attack",
        "ability_hero_varus_basic_attack",
        "ability_hero_vayne_basic_attack");

    private static final List<String> STABLE_IDS = List.of(
        "provider_hero_vayne_tumble",
        "ability_hero_vayne_tumble",
        "provider_item_3078_spellblade",
        "listener_item_3078_spellblade_ability_started",
        "listener_item_3078_spellblade_basic_attack_hit",
        "sequence_item_3078_spellblade_arm",
        "sequence_item_3078_spellblade_proc",
        "step_item_3078_spellblade_ready_arm",
        "step_item_3078_spellblade_icd_arm",
        "step_item_3078_spellblade_damage",
        "step_item_3078_spellblade_ready_consume",
        "spellblade_ready",
        "spellblade_icd",
        "spellblade_icd_available",
        "spellblade_ready_arm",
        "spellblade_icd_arm",
        "spellblade_ready_armed",
        "spellblade_proc_damage",
        "spellblade_ready_consume");

    private static String sql;
    private static String sqlNoLineComments;
    private static String reservedSql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        Path reservedPath = resolveRelative(RESERVED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        assertTrue(Files.isRegularFile(reservedPath), "reserved seed missing: " + reservedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        reservedSql = Files.readString(reservedPath, StandardCharsets.UTF_8);
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
            "spellblade seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "spellblade seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "spellblade seed must not CASCADE");
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
    void definesGameLocalBasicAttackTypeWithCollisionGuards() {
        assertContains("62003");
        assertContains("ability/basic_attack");
        assertContains("Basic attack ability");
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
        assertContains("type_id=62003 already bound");
        assertContains("type_key=ability/basic_attack already bound");
        assertFalse(
            reservedSql.contains("ability/basic_attack"),
            "reserved seed must not define ability/basic_attack");
        assertFalse(
            Pattern.compile("(?is)\\(62003\\s*,").matcher(reservedSql).find(),
            "reserved seed must not claim type_id 62003");
        assertFalse(
            sql.contains("event/ability_cast"),
            "must not create event/ability_cast");
    }

    @Test
    void writesExactSixBasicAttackAbilityRelationsWithoutTumble() {
        for (String abilityId : BASIC_ATTACK_ABILITIES) {
            assertTrue(
                Pattern.compile(
                        "(?s)62003\\s*,\\s*'ability'\\s*,\\s*'" + abilityId + "'")
                    .matcher(sql)
                    .find(),
                "must relate 62003 to " + abilityId);
        }
        assertFalse(
            Pattern.compile(
                    "(?s)62003\\s*,\\s*'ability'\\s*,\\s*'ability_hero_vayne_tumble'")
                .matcher(sql)
                .find(),
            "Tumble must not receive ability/basic_attack relation");
    }

    @Test
    void createsMinimalVayneTumbleActiveAbility() {
        assertContains("provider_hero_vayne_tumble");
        assertContains("ability_hero_vayne_tumble");
        assertTrue(
            Pattern.compile("(?s)'ability_hero_vayne_tumble'\\s*,\\s*'provider_hero_vayne_tumble'")
                .matcher(sql)
                .find(),
            "tumble ability must belong to tumble provider");
        assertTrue(
            Pattern.compile("(?s)'tumble'\\s*,\\s*20130").matcher(sql).find()
                || Pattern.compile("(?s)ability_key[^;]*'tumble'[\\s\\S]{0,80}20130")
                    .matcher(sqlNoLineComments)
                    .find()
                || Pattern.compile(
                        "(?s)'ability_hero_vayne_tumble'[\\s\\S]{0,120}'tumble'[\\s\\S]{0,80}20130")
                    .matcher(sql)
                    .find(),
            "tumble ability_key and active kind 20130 required");
        assertTrue(
            Pattern.compile("(?s)'hero_vayne'\\s*,\\s*'provider_hero_vayne_tumble'")
                .matcher(sql)
                .find(),
            "must mount tumble provider to hero_vayne");
        assertTrue(
            Pattern.compile("(?s)'provider_hero_vayne_tumble'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "tumble provider kind must be passive 20120");
    }

    @Test
    void mountsSpellbladeProviderOnItem3078() {
        assertContains("provider_item_3078_spellblade");
        assertContains("item_3078");
        assertTrue(
            Pattern.compile("(?s)'item_3078'\\s*,\\s*'provider_item_3078_spellblade'")
                .matcher(sql)
                .find(),
            "must mount spellblade provider to item_3078");
        assertTrue(
            Pattern.compile("(?s)'provider_item_3078_spellblade'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "spellblade provider kind must be passive 20120");
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
        assertContains("listener_item_3078_spellblade_ability_started");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3078_spellblade_ability_started'\\s*,\\s*20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3078_spellblade_ability_started'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212");
        assertContains("provider.state.spellblade_icd");
        assertContains("spellblade_icd_available");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3078_spellblade_ready_arm'[\\s\\S]{0,120}"
                        + "'sequence_item_3078_spellblade_arm'[\\s\\S]{0,40}0[\\s\\S]{0,40}20160")
                .matcher(sql)
                .find(),
            "ready arm step must be order 0 state_change");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3078_spellblade_icd_arm'[\\s\\S]{0,120}"
                        + "'sequence_item_3078_spellblade_arm'[\\s\\S]{0,40}1[\\s\\S]{0,40}20160")
                .matcher(sql)
                .find(),
            "icd arm step must be order 1 state_change");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3078_spellblade_ready_arm'[\\s\\S]{0,200}"
                        + "'spellblade_ready'[\\s\\S]{0,80}'spellblade_ready_arm'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "ready arm must override ready to 1");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3078_spellblade_icd_arm'[\\s\\S]{0,200}"
                        + "'spellblade_icd'[\\s\\S]{0,80}'spellblade_icd_arm'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "icd arm must override icd to 1");
        assertContains("\"op\":\"eq\"");
    }

    @Test
    void basicAttackHitListenerDamagesThenConsumesReady() {
        assertContains("listener_item_3078_spellblade_basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3078_spellblade_basic_attack_hit'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3078_spellblade_basic_attack_hit'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "hit listener must ALL-match 20212");
        assertContains("provider.state.spellblade_ready");
        assertContains("spellblade_ready_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3078_spellblade_damage'\\s*,\\s*"
                        + "'sequence_item_3078_spellblade_proc'\\s*,\\s*0\\s*,\\s*20150\\s*,\\s*20111")
                .matcher(sql)
                .find(),
            "damage step must be order 0 damage to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3078_spellblade_ready_consume'\\s*,\\s*"
                        + "'sequence_item_3078_spellblade_proc'\\s*,\\s*1\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "consume step must be order 1 state_change");
        assertContains("\"op\":\"gte\"");
    }

    @Test
    void damageFormulaIsTwoTimesEntrySourceBaseAdPhysicalNotCopyable() {
        String formula =
            "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":2},"
                + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.base\"}]}";
        assertContains(formula);
        assertContains("event.entry_source.attr.ad.base");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3078_spellblade_damage'\\s*,\\s*"
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
                    "(?s)'step_item_3078_spellblade_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "copyable_on_hit must be explicit false");
    }

    @Test
    void validatesPrerequisitesAndStableIds() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_3078");
        assertContains("hero_vayne");
        assertContains("missing basic attack ability");
        for (int typeId : List.of(
            20100, 20110, 20111, 20120, 20130, 20150, 20160, 20170, 20172, 20181,
            20190, 20205, 20211, 20212, 20220, 20250)) {
            assertContains(Integer.toString(typeId));
        }
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
        for (String abilityId : BASIC_ATTACK_ABILITIES) {
            assertContains(abilityId);
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
