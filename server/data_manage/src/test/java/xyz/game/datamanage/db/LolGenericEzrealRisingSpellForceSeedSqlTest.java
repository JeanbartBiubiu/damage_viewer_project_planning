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
 * Static contract for {@code lol_generic_ezreal_rising_spell_force_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericEzrealRisingSpellForceSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_ezreal_rising_spell_force_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_ezreal",
        "provider_hero_ezreal_rising_spell_force",
        "listener_hero_ezreal_rising_spell_force_ability_started",
        "sequence_hero_ezreal_rising_spell_force_stack_add",
        "step_hero_ezreal_rising_spell_force_stack_add",
        "modifier_hero_ezreal_rising_spell_force_attack_speed",
        "rising_spell_force_stacks",
        "rising_spell_force_stacks_add",
        "rising_spell_force_attack_speed",
        "rising_spell_force_on_ability_started",
        "rising_spell_force_stack_add");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20160, 20170, 20173, 20181, 20190, 20205, 20212,
        20250);

    private static final String AS_BONUS =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.10},"
            + "{\"op\":\"read\",\"path\":\"provider.state.rising_spell_force_stacks\"}]}";

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
            "match/link/mount idempotent guards must use change_revision > v_locked_current");
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
    void rejectsDestructivePublishLegacyAndLiveMigration() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "rising spell force seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "rising spell force seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "rising spell force seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "rising spell force seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "rising spell force seed must not CREATE TABLE");
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
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
    }

    @Test
    void validatesBatchBHeroEzrealAndRequiredAttrsWithoutRecreatingBaseline() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("Batch-B prerequisite");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'hero_ezreal'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight game_entities hero_ezreal");
        assertTrue(
            sql.contains("'attack_speed'") || Pattern.compile("(?is)attr_key\\s*=\\s*'attack_speed'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight attr_key=attack_speed");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertContains("INSERT INTO public.types");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entities\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate hero_ezreal / game_entities");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write entity_attribute_values");
    }

    @Test
    void mountsExactlyOneDedicatedPassiveProvider() {
        assertContains("provider_hero_ezreal_rising_spell_force");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_ezreal'\\s*,\\s*'provider_hero_ezreal_rising_spell_force'")
                .matcher(sql)
                .find(),
            "must mount rising spell force provider to hero_ezreal");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_ezreal_rising_spell_force'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "provider kind must be passive 20120");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once via entity_provider_mounts");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider");
    }

    @Test
    void definesTimedStacksMaxFiveDuration6000RefreshDuration() {
        assertTrue(
            Pattern.compile(
                    "(?s)'rising_spell_force_stacks'[\\s\\S]{0,40}20100[\\s\\S]{0,20}5"
                        + "[\\s\\S]{0,20}6000[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "rising_spell_force_stacks max5 / 6000ms / refresh_duration");
        assertContains("refresh_duration");
        assertContains("refresh-on-write");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");
        assertContains("20250");
    }

    @Test
    void unboundAbilityStartedSourceOwnerListenerAddsOneStack() {
        assertContains("listener_hero_ezreal_rising_spell_force_ability_started");
        assertContains("sequence_hero_ezreal_rising_spell_force_stack_add");
        assertContains("step_hero_ezreal_rising_spell_force_stack_add");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_ezreal_rising_spell_force_ability_started'\\s*,\\s*"
                        + "'provider_hero_ezreal_rising_spell_force'\\s*,\\s*"
                        + "'rising_spell_force_on_ability_started'\\s*,\\s*20205\\s*,\\s*"
                        + "NULL")
                .matcher(sql)
                .find(),
            "listener must be unbound ability_started (ability_id NULL)");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_ezreal_rising_spell_force_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_ezreal_rising_spell_force_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ezreal_rising_spell_force_stack_add'\\s*,\\s*"
                        + "'sequence_hero_ezreal_rising_spell_force_stack_add'\\s*,\\s*0\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "stack add must be order 0 state_change self with no condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ezreal_rising_spell_force_stack_add'\\s*,\\s*20250\\s*,\\s*"
                        + "'rising_spell_force_stacks'\\s*,\\s*"
                        + "'rising_spell_force_stacks_add'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "stack detail must add +1 rising_spell_force_stacks via provider scope");
        assertContains("{\"op\":\"const\",\"value\":1}");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            countOccurrences(sql, "'step_hero_ezreal_rising_spell_force_stack_add'") >= 2,
            "stack-add step must appear in effect_steps and state_effect_details");
        assertTrue(
            sql.contains("event/ability_started")
                && (sql.contains("basic_attack") || sql.contains("普攻")),
            "seed must document that basic attacks do not emit ability_started");
    }

    @Test
    void definesAttackSpeedPercentAddFormulaWithStackCap() {
        assertContains(AS_BONUS);
        assertContains("\"value\":0.10");
        assertContains("20173");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_ezreal_rising_spell_force_attack_speed'[\\s\\S]{0,300}"
                        + "'attack_speed'[\\s\\S]{0,120}20173\\s*,\\s*"
                        + "'rising_spell_force_attack_speed'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "AS modifier must be percent_add with NULL condition_formula_key");
        assertTrue(
            sql.contains("0.50") || sql.contains("+50%") || sql.contains("上限 0.50"),
            "seed must document max AS bonus 0.50 from 5 stacks");
        assertFalse(
            Pattern.compile("(?i)single_attacker_dps|legacy.?dps|dps.?lane")
                .matcher(sqlNoLineComments)
                .find(),
            "must not use ad-hoc runtime or legacy DPS surface");
    }

    @Test
    void excludesActiveAbilitiesBasicAttackRewritesAndOutOfScopeClaims() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create Ezreal active ability definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_phases\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_phases");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_cooldowns\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_cooldowns");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write damage_effect_details / hit producers");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?i)ability_hero_ezreal_[qwer]|provider_hero_ezreal_basic|"
                        + "ability_hero_ezreal_basic|秘术射击|精华跃动|奥术跃迁|精准弹幕")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement Q/W/E/R or rewrite basic-attack graph");
        assertFalse(
            Pattern.compile("(?i)basic_attack")
                .matcher(sqlNoLineComments)
                .find(),
            "executable SQL must not rewrite basic-attack surfaces");
    }

    @Test
    void citesWikiRevisionHashAndReviewedContractWithoutScreenshotOcr() {
        assertContains("Template:Data Ezreal/Rising Spell Force");
        assertContains("3932280");
        assertContains("5996c969e2d1b53b3c805737fa161b4a9e235d6e7b7c74899a6580de34ca77ba");
        assertContains(
            "C:\\project\\damage_wasm_dev\\数据参考\\lol-wiki-current-champions\\"
                + "normalized\\reviewed-contracts.json#ezreal-p");
        assertTrue(
            Pattern.compile("(?i)无截图|无.*OCR|screenshot|OCR").matcher(sql).find()
                && Pattern.compile(
                        "(?i)无截图|不含截图|无.*OCR|不.*OCR|without.*screenshot|"
                            + "no screenshot|截图 / OCR|不是数值溯源")
                    .matcher(sql)
                    .find(),
            "seed comments must explicitly disclaim screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)screenshot|ocr|截图识别|光学字符")
                .matcher(sqlNoLineComments)
                .find(),
            "executable SQL must not cite screenshot/OCR provenance");
        assertContains("missing reserved_type");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int idx = haystack.indexOf(needle, from);
            if (idx < 0) {
                return count;
            }
            count++;
            from = idx + needle.length();
        }
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
