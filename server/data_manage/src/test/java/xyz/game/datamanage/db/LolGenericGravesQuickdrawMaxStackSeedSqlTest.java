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
 * Static contract for {@code lol_generic_graves_quickdraw_max_stack_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericGravesQuickdrawMaxStackSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_graves_quickdraw_max_stack_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_graves",
        "provider_hero_graves_quickdraw_max_stack",
        "ability_hero_graves_quickdraw",
        "phase_hero_graves_quickdraw_impact",
        "sequence_hero_graves_quickdraw_max_stack",
        "step_hero_graves_quickdraw_true_grit_max",
        "cooldown_hero_graves_quickdraw",
        "modifier_hero_graves_quickdraw_armor",
        "modifier_hero_graves_quickdraw_bonus_armor",
        "modifier_hero_graves_quickdraw_magic_resist",
        "modifier_hero_graves_quickdraw_bonus_magic_resist",
        "true_grit_stacks",
        "true_grit_stacks_max",
        "true_grit_armor",
        "true_grit_bonus_armor",
        "true_grit_magic_resist",
        "true_grit_bonus_magic_resist",
        "e_mana_cost",
        "e_cooldown_ms",
        "quickdraw",
        "bonus_armor",
        "bonus_magic_resist");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20130, 20142, 20160, 20170, 20172, 20250, 20260);

    private static final String ARMOR_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":19},"
            + "{\"op\":\"read\",\"path\":\"provider.state.true_grit_stacks\"}]}";

    private static final String MAGIC_RESIST_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"const\",\"value\":19},{\"op\":\"const\",\"value\":0.5}]},"
            + "{\"op\":\"read\",\"path\":\"provider.state.true_grit_stacks\"}]}";

    private static final String BAKED_MAGIC_RESIST_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":9.5},"
            + "{\"op\":\"read\",\"path\":\"provider.state.true_grit_stacks\"}]}";

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
            Pattern.compile("(?i)legacy").matcher(sqlNoLineComments).find(),
            "must not touch legacy tables");
    }

    @Test
    void documentsWikiProvenancePanelShaAndCompletedBoundaries() {
        assertContains("4007744");
        assertContains("ff4c65c5ce2a0ac1ae757271fbb924b35bf4eca1af0f4d07a69d865db901a4e1");
        assertContains("graves-e");
        assertContains("Template:Data Graves/Quickdraw");
        assertContains("hero_skill|hero_graves|E|快速拔枪");
        assertContains("4042886");
        assertContains("98094d20a267a437b0ef667db6c67143a0e15c8f8dd27186262b0ed9f621c8a3");
        assertContains("Module:ChampionData/data");
        assertContains("1401029");
        assertTrue(
            sql.contains("已完成") || sql.contains("completed") || sql.contains("Completed"),
            "must document completed Phase-A boundary");
        assertTrue(
            sql.contains("排除") || sql.contains("exclusion") || sql.contains("Exclusions"),
            "must document exclusions");
        assertFalse(
            Pattern.compile("(?i)ddragon.*(truth|numeric|mechanism)|mechanism.*ddragon")
                .matcher(sqlNoLineComments)
                .find(),
            "must not use DDragon as mechanism numeric truth");
        assertTrue(
            sql.contains("no DDragon")
                || sql.contains("不使用 DDragon")
                || sql.contains("no DDragon / Meraki")
                || sql.contains("no DDragon / Meraki / OCR"),
            "must explicitly reject DDragon/Meraki/OCR mechanism truth");
    }

    @Test
    void validatesPrerequisitesAndProjectsRequiredReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("unexpected foreign step");
        assertContains("conflicting types by type_id");
        assertContains("conflicting types by type_key");
        assertContains("INSERT INTO public.types");
        assertTrue(
            Pattern.compile("(?is)ON CONFLICT\\s*\\(game_id,\\s*type_id\\)\\s*DO NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "reserved type projection must DO NOTHING (no overwrite correct metadata)");
        for (String attr : List.of(
            "hp", "mana", "ad", "attack_speed", "armor", "magic_resist",
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
    void seedsSelfContainedHeroPanelBonusEavAndManaWithoutOverwritingPGraph() {
        assertContains("hero_graves");
        assertTrue(
            Pattern.compile("(?is)ON CONFLICT\\s*\\(game_id,\\s*entity_id\\)\\s*DO NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "hero_graves must ON CONFLICT DO NOTHING");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'hp'\\s*,\\s*625\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "hp625");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'mana'\\s*,\\s*325\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "mana325");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'ad'\\s*,\\s*66\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "AD66");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'attack_speed'\\s*,\\s*0\\.475\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "attack speed 0.475");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'armor'\\s*,\\s*33\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "armor33");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'magic_resist'\\s*,\\s*30\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "MR30");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'hp_regen'\\s*,\\s*8\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "hp regen8");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'mana_regen'\\s*,\\s*8\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "mana regen8");
        assertTrue(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.attribute_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must ensure bonus_armor / bonus_magic_resist attribute_definitions");
        assertContains("'bonus_armor'");
        assertContains("'bonus_magic_resist'");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'bonus_armor'\\s*,\\s*0\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "bonus_armor EAV base must be 0");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'bonus_magic_resist'\\s*,\\s*0\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "bonus_magic_resist EAV base must be 0");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_definitions[\\s\\S]{0,200}"
                    + "provider_hero_graves_new_destiny")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write/overwrite provider_hero_graves_new_destiny");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_definitions[\\s\\S]{0,200}"
                    + "ability_hero_graves_basic_attack")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write/overwrite ability_hero_graves_basic_attack");
        assertTrue(
            sql.contains("do not overwrite")
                || sql.contains("Preservation")
                || sql.contains("preserve")
                || sql.contains("不覆盖"),
            "must document P-graph non-overwrite intent");
    }

    @Test
    void mountsOnlyQuickdrawMaxStackProviderWithIndependentAbility() {
        assertContains("provider_hero_graves_quickdraw_max_stack");
        assertContains("ability_hero_graves_quickdraw");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_graves_quickdraw'\\s*,\\s*"
                        + "'provider_hero_graves_quickdraw_max_stack'\\s*,\\s*"
                        + "'quickdraw'\\s*,\\s*20130")
                .matcher(sqlNoLineComments)
                .find(),
            "E must be active ability with stable key quickdraw");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_graves'\\s*,\\s*'provider_hero_graves_quickdraw_max_stack'")
                .matcher(sql)
                .find(),
            "must mount quickdraw_max_stack provider to hero_graves");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once via entity_provider_mounts");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "Phase-A must not write provider_listeners");
        assertContains("provider_hero_graves_new_destiny");
        assertContains("ability_hero_graves_basic_attack");
    }

    @Test
    void seedsUntimedMaxEightTrueGritStateAndOverrideConstantEight() {
        assertTrue(
            Pattern.compile(
                    "(?s)'true_grit_stacks'\\s*,\\s*20100\\s*,\\s*8\\s*,\\s*NULL\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "true_grit_stacks must be numeric max8 untimed (duration/refresh NULL)");
        assertTrue(
            sql.contains("untimed") || sql.contains("无 duration") || sql.contains("duration_ms NULL"),
            "must document untimed state semantics");
        assertContains("{\"op\":\"const\",\"value\":8}");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_graves_quickdraw_true_grit_max'\\s*,\\s*"
                        + "'sequence_hero_graves_quickdraw_max_stack'\\s*,\\s*0\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "impact must be one unconditional self state_change");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_graves_quickdraw_true_grit_max'\\s*,\\s*20250\\s*,\\s*"
                        + "'true_grit_stacks'\\s*,\\s*'true_grit_stacks_max'\\s*,\\s*20172")
                .matcher(sqlNoLineComments)
                .find(),
            "state_change must override provider-scope true_grit_stacks via const8");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.state_effect_details"),
            "exactly one state_effect_details insert");
        assertFalse(
            Pattern.compile(
                    "(?s)'true_grit_stacks'[\\s\\S]{0,80}'true_grit_stacks_max'\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "max-stack write must not use value_policy/add");
        assertContains("Do not use add");
    }

    @Test
    void writesFourFlatAddResistanceModifiersAndFormulaConstants() {
        assertContains(ARMOR_FORMULA);
        assertContains(MAGIC_RESIST_FORMULA);
        assertFalse(
            sqlNoLineComments.contains(BAKED_MAGIC_RESIST_FORMULA),
            "MR formulas must not bake 9.5; use nested mul(mul(19,0.5), stacks)");
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, MAGIC_RESIST_FORMULA),
            "magic_resist and bonus_magic_resist must both use nested MR AST");
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, ARMOR_FORMULA),
            "armor and bonus_armor must both use mul(19, stacks)");
        assertContains("19");
        assertContains("9.5");
        assertContains("0.5");
        assertContains("152");
        assertContains("76");
        assertContains("provider.state.true_grit_stacks");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_graves_quickdraw_armor'[\\s\\S]{0,200}"
                        + "20110[\\s\\S]{0,40}'armor'[\\s\\S]{0,120}20170")
                .matcher(sqlNoLineComments)
                .find(),
            "armor modifier must be self flat-add");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_graves_quickdraw_bonus_armor'[\\s\\S]{0,200}"
                        + "20110[\\s\\S]{0,40}'bonus_armor'[\\s\\S]{0,120}20170")
                .matcher(sqlNoLineComments)
                .find(),
            "bonus_armor modifier must be self flat-add");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_graves_quickdraw_magic_resist'[\\s\\S]{0,200}"
                        + "20110[\\s\\S]{0,40}'magic_resist'[\\s\\S]{0,120}20170")
                .matcher(sqlNoLineComments)
                .find(),
            "magic_resist modifier must be self flat-add");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_graves_quickdraw_bonus_magic_resist'[\\s\\S]{0,200}"
                        + "20110[\\s\\S]{0,40}'bonus_magic_resist'[\\s\\S]{0,120}20170")
                .matcher(sqlNoLineComments)
                .find(),
            "bonus_magic_resist modifier must be self flat-add");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "exactly one provider_modifiers insert block for the four modifiers");
    }

    @Test
    void seedsActiveAbilityManaCostFortyAndCooldownTwelveSeconds() {
        assertContains("{\"op\":\"const\",\"value\":40}");
        assertContains("cooldown_hero_graves_quickdraw");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("{\"op\":\"const\",\"value\":12000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_graves_quickdraw'\\s*,\\s*"
                        + "'ability_hero_graves_quickdraw'\\s*,\\s*"
                        + "'e_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "E cooldown must be 12000ms via ability_cooldowns");
    }

    @Test
    void documentsExclusionsAndStableIds() {
        assertTrue(
            sql.contains("reload") || sql.contains("装填"),
            "must exclude reload/shell");
        assertTrue(
            sql.contains("dash") || sql.contains("geometry") || sql.contains("冲刺"),
            "must exclude dash geometry");
        assertTrue(
            sql.contains("multi-target") || sql.contains("多目标"),
            "must exclude multi-target");
        assertTrue(
            sql.contains("pellet") || sql.contains("弹丸"),
            "must exclude pellet cooldown reduction");
        assertTrue(
            sql.contains("attack-reset") || sql.contains("attack reset") || sql.contains("普攻重置"),
            "must exclude attack-reset");
        assertTrue(
            sql.contains("timed refresh") || sql.contains("refresh/expiry") || sql.contains("timed"),
            "must exclude timed refresh/expiry");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "duplicate stable id in test list: " + id);
            assertTrue(sql.contains(id), "missing stable id: " + id);
        }
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "missing: " + needle);
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

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
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
