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
 * Static contract for {@code lol_generic_graves_new_destiny_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericGravesNewDestinySeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_graves_new_destiny_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_graves",
        "provider_hero_graves_new_destiny",
        "ability_hero_graves_basic_attack",
        "phase_hero_graves_basic_attack_impact",
        "sequence_hero_graves_basic_attack_damage",
        "step_hero_graves_basic_attack_damage",
        "step_hero_graves_basic_attack_emit_hit",
        "event_ref_hero_graves_basic_attack_hit",
        "modifier_hero_graves_new_destiny_crit_natural",
        "modifier_hero_graves_new_destiny_crit_forced",
        "basic_attack_damage",
        "crit_multiplier_override",
        "crit_multiplier_natural_branch",
        "crit_multiplier_forced_branch",
        "champion_level");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20158, 20170, 20172,
        20211, 20220, 20252, 20260, 20264, 20265, 20266, 20269, 20277, 20279,
        20280);

    private static final String DAMAGE_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":0.6895},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.01765},"
            + "{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.champion_level.resolved\"},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":0.595},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.0225},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.champion_level.resolved\"},"
            + "{\"op\":\"const\",\"value\":1}]}]}]}]}]}]}]},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":3},"
            + "{\"op\":\"const\",\"value\":0.33302}]}]}]}";

    private static final String CRIT_OVERRIDE_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"div\",\"args\":["
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":5},"
            + "{\"op\":\"const\",\"value\":0.33302}]}]},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":3},"
            + "{\"op\":\"const\",\"value\":0.33302}]}]}]},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.5},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.crit_damage.resolved\"},"
            + "{\"op\":\"const\",\"value\":1}]}]}]}]}";

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
        assertContains("4038342");
        assertContains("553bda222e9e85f0eff6d4cba3b8723979a58b68fba9097d2dfa1bd373117aa8");
        assertContains("graves-p");
        assertContains("Template:Data Graves/New Destiny");
        assertContains("hero_skill|hero_graves|P|新命运");
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
            "hp_regen", "mana_regen", "crit_chance", "crit_damage")) {
            assertTrue(
                sql.contains("'" + attr + "'"),
                "must preflight or write attr_key=" + attr);
        }
        assertContains("'champion_level'");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void seedsSelfContainedHeroPanelChampionLevelCritEavAndMana() {
        assertContains("hero_graves");
        assertTrue(
            Pattern.compile("(?is)ON CONFLICT\\s*\\(game_id,\\s*entity_id\\)\\s*DO NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "hero_graves must ON CONFLICT DO NOTHING");
        assertTrue(
            sql.contains("625") && sql.contains("325") && sql.contains("66")
                && sql.contains("0.475") && sql.contains("33") && sql.contains("30"),
            "must seed Graves Wiki level-1 panel numbers");
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
            Pattern.compile(
                    "(?s)'champion_level'[\\s\\S]{0,120}'scalar'[\\s\\S]{0,40}1[\\s\\S]{0,20}18")
                .matcher(sqlNoLineComments)
                .find(),
            "champion_level must be scalar with min 1 / max 18");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'champion_level'\\s*,\\s*1\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "hero_graves champion_level base must be 1");
        assertContains("generate_series(1, 18)");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'crit_chance'\\s*,\\s*0\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "crit_chance EAV default 0");
        assertTrue(
            Pattern.compile("(?s)'hero_graves'\\s*,\\s*'crit_damage'\\s*,\\s*2\\.0\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "crit_damage EAV default 2.0");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_graves'\\s*,\\s*'mana'\\s*,\\s*325\\s*,\\s*325")
                .matcher(sqlNoLineComments)
                .find(),
            "mana resource 325/325");
        assertTrue(
            sql.contains("not Graves P numeric truth")
                || sql.contains("非 Graves P")
                || sql.contains("not Graves P"),
            "crit EAV must be documented as non-mechanism truth");
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
                || Pattern.compile("(?is)'ability/basic_attack'[\\s\\S]{0,200}NULL")
                    .matcher(sqlNoLineComments)
                    .find(),
            "type 62003 must set reserved_type_id NULL");
        assertTrue(
            Pattern.compile(
                    "(?s)62003\\s*,\\s*'ability'\\s*,\\s*'ability_hero_graves_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must relate 62003 to ability_hero_graves_basic_attack");
    }

    @Test
    void mountsOnlyNewDestinyProviderWithBasicAttackAbility() {
        assertContains("provider_hero_graves_new_destiny");
        assertContains("ability_hero_graves_basic_attack");
        assertFalse(
            sqlNoLineComments.contains("provider_hero_graves_basic_attack"),
            "must not create a separate provider_hero_graves_basic_attack");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_graves_basic_attack'\\s*,\\s*"
                        + "'provider_hero_graves_new_destiny'")
                .matcher(sqlNoLineComments)
                .find(),
            "basic attack ability must belong to new_destiny provider");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_graves'\\s*,\\s*'provider_hero_graves_new_destiny'")
                .matcher(sql)
                .find(),
            "must mount new_destiny provider to hero_graves");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "Phase-A must not write provider_listeners");
    }

    @Test
    void upsertsPointBlankDamageAndCritOverrideFormulas() {
        assertContains(DAMAGE_FORMULA);
        assertContains(CRIT_OVERRIDE_FORMULA);
        assertContains("0.6895");
        assertContains("0.01765");
        assertContains("0.33302");
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.champion_level.resolved");
        assertContains("source.attr.crit_damage.resolved");
        assertContains("'basic_attack_damage'");
        assertContains("'crit_multiplier_override'");
    }

    @Test
    void writesNaturalAndForcedCritPipelineOverrides() {
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_graves_new_destiny_crit_natural'[\\s\\S]{0,200}"
                        + "20264[\\s\\S]{0,120}20277[\\s\\S]{0,80}20266[\\s\\S]{0,80}"
                        + "20269[\\s\\S]{0,80}20280[\\s\\S]{0,80}20172")
                .matcher(sqlNoLineComments)
                .find(),
            "natural branch must be pipeline/crit/basic_damage/all/20280/override");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_graves_new_destiny_crit_forced'[\\s\\S]{0,200}"
                        + "20264[\\s\\S]{0,120}20277[\\s\\S]{0,80}20266[\\s\\S]{0,80}"
                        + "20269[\\s\\S]{0,80}20279[\\s\\S]{0,80}20172")
                .matcher(sqlNoLineComments)
                .find(),
            "forced branch must be pipeline/crit/basic_damage/all/20279/override");
        assertContains("value_policy/override");
        assertContains("20280");
        assertContains("20279");
        assertContains("20172");
    }

    @Test
    void sequenceIsOneDamageThenOneEmitWithCritEligibleAndCopyableFalse() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_graves_basic_attack_damage'\\s*,\\s*"
                        + "'sequence_hero_graves_basic_attack_damage'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "order 0 must be unconditional physical damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_graves_basic_attack_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_graves_basic_attack_damage'\\s*,\\s*1\\s*,\\s*"
                        + "20158\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "order 1 must be the single basic_attack_hit emit");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_graves_basic_attack_damage'[\\s\\S]{0,120}"
                        + "'basic_attack_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*"
                        + "false\\s*,\\s*true")
                .matcher(sqlNoLineComments)
                .find(),
            "damage must be physical add copyable_on_hit=false crit_eligible=true");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_graves_basic_attack_emit_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "'event_ref_hero_graves_basic_attack_hit'")
                .matcher(sqlNoLineComments)
                .find(),
            "emit must be event/basic_attack_hit 20211");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "exactly one damage_effect_details insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.event_effect_details"),
            "exactly one event_effect_details insert");
        assertContains("copyable_on_hit=false");
        assertContains("crit_eligible=true");
        assertContains("deferred exactly-one-detail");
    }

    @Test
    void documentsExclusionsAndStableIds() {
        assertTrue(
            sql.contains("reload") || sql.contains("装填"),
            "must exclude reload/cadence");
        assertTrue(
            sql.contains("pellet") || sql.contains("弹丸"),
            "must exclude pellet instances");
        assertTrue(
            sql.contains("projectile") || sql.contains("弹道") || sql.contains("distance"),
            "must exclude projectile/distance");
        assertTrue(
            sql.contains("multi-target") || sql.contains("多目标"),
            "must exclude multi-target");
        assertTrue(
            sql.contains("life steal") || sql.contains("生命偷取") || sql.contains("lifesteal"),
            "must exclude life steal");
        assertTrue(
            sql.contains("knockback") || sql.contains("击退"),
            "must exclude knockback");
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
