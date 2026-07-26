package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_terminus_juxtaposition_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericTerminusJuxtapositionSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_terminus_juxtaposition_seed.sql";

    private static final String SHADOW_SEED_RELATIVE =
        "db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3302_terminus",
        "listener_item_3302_terminus",
        "sequence_item_3302_terminus",
        "step_item_3302_terminus_damage",
        "step_item_3302_terminus_light_stacks_add",
        "step_item_3302_terminus_dark_stacks_add",
        "step_item_3302_terminus_polarity_toggle",
        "modifier_item_3302_terminus_light_armor",
        "modifier_item_3302_terminus_light_magic_resist",
        "modifier_item_3302_terminus_dark_armor_pen",
        "modifier_item_3302_terminus_dark_magic_pen",
        "next_polarity",
        "light_stacks",
        "dark_stacks",
        "terminus_polarity_is_light",
        "terminus_polarity_is_dark",
        "terminus_light_stacks_add",
        "terminus_dark_stacks_add",
        "terminus_polarity_toggle",
        "terminus_light_resist_bonus",
        "terminus_dark_pen_bonus",
        "terminus_on_hit_damage");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20150, 20160, 20170, 20172, 20190, 20250);

    private static String sql;
    private static String sqlNoLineComments;
    private static String shadowSql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);

        Path shadowPath = resolveRelative(SHADOW_SEED_RELATIVE);
        assertTrue(Files.isRegularFile(shadowPath), "shadow seed sql missing: " + shadowPath);
        shadowSql = Files.readString(shadowPath, StandardCharsets.UTF_8);
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
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "juxtaposition seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "juxtaposition seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "juxtaposition seed must not CASCADE");
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
            Pattern.compile("(?i)Data\\s*Dragon|ddragon").matcher(sqlNoLineComments).find(),
            "must not cite Data Dragon as truth source");
    }

    @Test
    void extendsExistingProviderWithoutRecreatingProviderOrMount() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate provider_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_provider_mounts\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate entity_provider_mounts");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate provider_listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.effect_sequences\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate effect_sequences");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not rewrite Shadow damage_effect_details");
        assertFalse(
            Pattern.compile("(?is)UPDATE\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not mutate Shadow damage_effect_details / copyable_on_hit");
        assertContains("provider_item_3302_terminus");
        assertContains("listener_item_3302_terminus");
        assertContains("sequence_item_3302_terminus");
        assertContains("step_item_3302_terminus_damage");
        assertContains("missing provider_item_3302_terminus");
        assertContains("missing item_3302 mount");
        assertContains("Shadow terminus_on_hit_damage must remain const 30");
    }

    @Test
    void validatesPrerequisitesForGameReservedAttrsAndShadowBaseline() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_3302");
        assertContains("armor_pen_percent");
        assertContains("magic_pen_percent");
        assertContains("champion_level");
        assertContains("INSERT INTO public.types");
        assertContains("INSERT INTO public.attribute_definitions");
        assertTrue(
            Pattern.compile(
                    "(?s)st\\.step_id\\s*=\\s*'step_item_3302_terminus_damage'\\s*"
                        + "AND\\s+st\\.sequence_id\\s*=\\s*'sequence_item_3302_terminus'\\s*"
                        + "AND\\s+st\\.step_order\\s*=\\s*0\\s*"
                        + "AND\\s+st\\.operation_type_id\\s*=\\s*20150")
                .matcher(sqlNoLineComments)
                .find(),
            "must require existing Shadow damage step order 0 / operation 20150");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void documentsWikiTruthAndPhaseAApproximations() {
        assertContains("4030984");
        assertContains("e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d");
        assertContains("Phase-A");
        assertContains("first-Light");
        assertContains("aggregate refresh");
        assertTrue(
            sql.contains("refresh_on_write") || sql.contains("整窗刷新"),
            "must document aggregate refresh / refresh_on_write approximation");
        assertTrue(
            sql.contains("champion-only") || sql.contains("对英雄"),
            "must document champion-only approximation boundary");
        assertContains("6@1");
        assertContains("7@11");
        assertContains("8@14");
    }

    @Test
    void shadowSeedStillOwnsThirtyMagicWithoutJuxtapositionKeys() {
        assertTrue(
            shadowSql.contains("{\"op\":\"const\",\"value\":30}"),
            "Shadow seed must keep terminus const 30");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3302_terminus_damage'\\s*,\\s*"
                        + "'terminus_on_hit_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(shadowSql)
                .find(),
            "Shadow seed must own 30 magic damage detail");
        assertFalse(
            shadowSql.contains("next_polarity")
                || shadowSql.contains("light_stacks")
                || shadowSql.contains("dark_stacks")
                || shadowSql.contains("terminus_light_resist_bonus")
                || shadowSql.contains("terminus_dark_pen_bonus"),
            "Shadow on-hit seed must delegate Juxtaposition to extension seed");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_formulas[\\s\\S]{0,800}"
                        + "'terminus_on_hit_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "Juxtaposition extension must not re-INSERT terminus_on_hit_damage");
    }

    @Test
    void seedsPolarityAndStackStateContracts() {
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3302_terminus'\\s*,\\s*"
                        + "'next_polarity'\\s*,\\s*"
                        + "20100\\s*,\\s*"
                        + "1\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "next_polarity must be untimed number max1 (default Light=0)");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3302_terminus'\\s*,\\s*"
                        + "'light_stacks'\\s*,\\s*"
                        + "20100\\s*,\\s*"
                        + "3\\s*,\\s*"
                        + "5000\\s*,\\s*"
                        + "20190")
                .matcher(sqlNoLineComments)
                .find(),
            "light_stacks must be max3 / 5000ms / refresh_on_write 20190");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3302_terminus'\\s*,\\s*"
                        + "'dark_stacks'\\s*,\\s*"
                        + "20100\\s*,\\s*"
                        + "3\\s*,\\s*"
                        + "5000\\s*,\\s*"
                        + "20190")
                .matcher(sqlNoLineComments)
                .find(),
            "dark_stacks must be max3 / 5000ms / refresh_on_write 20190");
    }

    @Test
    void seedsExactLightPiecewiseAndDarkPenFormulas() {
        String lightResist =
            "{\"op\":\"mul\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":["
                + "{\"op\":\"const\",\"value\":6},"
                + "{\"op\":\"clamp\",\"expr\":{\"op\":\"div\",\"args\":["
                + "{\"op\":\"sub\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
                + "{\"op\":\"const\",\"value\":1}]},"
                + "{\"op\":\"const\",\"value\":10}]},"
                + "\"min\":{\"op\":\"const\",\"value\":0},\"max\":{\"op\":\"const\",\"value\":1}}]},"
                + "{\"op\":\"clamp\",\"expr\":{\"op\":\"div\",\"args\":["
                + "{\"op\":\"sub\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.champion_level\"},"
                + "{\"op\":\"const\",\"value\":11}]},"
                + "{\"op\":\"const\",\"value\":3}]},"
                + "\"min\":{\"op\":\"const\",\"value\":0},\"max\":{\"op\":\"const\",\"value\":1}}]},"
                + "{\"op\":\"read\",\"path\":\"provider.state.light_stacks\"}]}";
        assertContains(lightResist);

        String darkPen =
            "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.10},"
                + "{\"op\":\"read\",\"path\":\"provider.state.dark_stacks\"}]}";
        assertContains(darkPen);

        assertContains(
            "{\"op\":\"eq\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.next_polarity\"},"
                + "{\"op\":\"const\",\"value\":0}]}");
        assertContains(
            "{\"op\":\"eq\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.next_polarity\"},"
                + "{\"op\":\"const\",\"value\":1}]}");
        assertContains(
            "{\"op\":\"sub\",\"args\":[{\"op\":\"const\",\"value\":1},"
                + "{\"op\":\"read\",\"path\":\"provider.state.next_polarity\"}]}");
    }

    @Test
    void advancesStacksThenTogglesOnceOnExistingListenerSequence() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3302_terminus_light_stacks_add'\\s*,\\s*"
                        + "'sequence_item_3302_terminus'\\s*,\\s*1\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'terminus_polarity_is_light'")
                .matcher(sqlNoLineComments)
                .find(),
            "light stack add must be order 1 state_change conditioned on Light");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3302_terminus_dark_stacks_add'\\s*,\\s*"
                        + "'sequence_item_3302_terminus'\\s*,\\s*2\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'terminus_polarity_is_dark'")
                .matcher(sqlNoLineComments)
                .find(),
            "dark stack add must be order 2 state_change conditioned on Dark");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3302_terminus_polarity_toggle'\\s*,\\s*"
                        + "'sequence_item_3302_terminus'\\s*,\\s*3\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "polarity toggle must be unconditional order 3 state_change");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3302_terminus_light_stacks_add'\\s*,\\s*20250\\s*,\\s*"
                        + "'light_stacks'\\s*,\\s*'terminus_light_stacks_add'\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "light stack detail must use provider scope add");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3302_terminus_dark_stacks_add'\\s*,\\s*20250\\s*,\\s*"
                        + "'dark_stacks'\\s*,\\s*'terminus_dark_stacks_add'\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "dark stack detail must use provider scope add");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3302_terminus_polarity_toggle'\\s*,\\s*20250\\s*,\\s*"
                        + "'next_polarity'\\s*,\\s*'terminus_polarity_toggle'\\s*,\\s*20172")
                .matcher(sqlNoLineComments)
                .find(),
            "polarity toggle detail must use provider scope override");
    }

    @Test
    void seedsFlatAddModifiersForLightResistsAndDarkPenetration() {
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3302_terminus_light_armor'[\\s\\S]*?"
                        + "'armor'[\\s\\S]*?20170\\s*,\\s*'terminus_light_resist_bonus'")
                .matcher(sqlNoLineComments)
                .find(),
            "Light armor modifier must flat-add terminus_light_resist_bonus");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3302_terminus_light_magic_resist'[\\s\\S]*?"
                        + "'magic_resist'[\\s\\S]*?20170\\s*,\\s*'terminus_light_resist_bonus'")
                .matcher(sqlNoLineComments)
                .find(),
            "Light MR modifier must flat-add terminus_light_resist_bonus");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3302_terminus_dark_armor_pen'[\\s\\S]*?"
                        + "'armor_pen_percent'[\\s\\S]*?20170\\s*,\\s*'terminus_dark_pen_bonus'")
                .matcher(sqlNoLineComments)
                .find(),
            "Dark armor pen modifier must flat-add terminus_dark_pen_bonus");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3302_terminus_dark_magic_pen'[\\s\\S]*?"
                        + "'magic_pen_percent'[\\s\\S]*?20170\\s*,\\s*'terminus_dark_pen_bonus'")
                .matcher(sqlNoLineComments)
                .find(),
            "Dark magic pen modifier must flat-add terminus_dark_pen_bonus");
    }

    @Test
    void stateStepsAreNotPhantomCopyableDamage() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "Juxtaposition steps must not be damage rows");
        assertFalse(
            Pattern.compile("(?i)copyable_on_hit\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "must not mark Juxtaposition state steps copyable_on_hit");
        assertContains("state_effect_details");
        assertContains("不可被 phantom");
    }

    @Test
    void stableIdsAreUniqueEnoughToRerunSafely() {
        Set<String> seen = new LinkedHashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
        assertContains("Collision-safe");
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
        fail("unable to resolve " + relative + " from cwd=" + cwd);
        return null;
    }
}
