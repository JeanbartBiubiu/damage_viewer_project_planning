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
 * Static contract for {@code lol_generic_quinn_heightened_senses_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericQuinnHeightenedSensesSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_quinn",
        "provider_hero_quinn_basic_attack",
        "ability_hero_quinn_basic_attack",
        "phase_hero_quinn_basic_attack_impact",
        "sequence_hero_quinn_basic_attack_damage",
        "step_hero_quinn_basic_attack_damage",
        "step_hero_quinn_basic_attack_emit_hit",
        "event_ref_hero_quinn_basic_attack_hit",
        "provider_hero_quinn_heightened_senses",
        "listener_hero_quinn_heightened_senses_basic_attack_hit",
        "sequence_hero_quinn_heightened_senses_arm",
        "step_hero_quinn_heightened_senses_active_arm",
        "modifier_hero_quinn_heightened_senses_attack_speed",
        "harrier_vulnerable",
        "heightened_senses_active",
        "heightened_senses_active_arm",
        "heightened_senses_arm_condition",
        "heightened_senses_attack_speed");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20158, 20160, 20170,
        20172, 20173, 20181, 20190, 20211, 20212, 20220, 20250, 20252, 20260);

    private static final String ARM_CONDITION =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\","
            + "\"path\":\"provider.target_state.harrier_vulnerable\"},"
            + "{\"op\":\"const\",\"value\":1}]}";

    private static final String AS_BONUS =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.80},"
            + "{\"op\":\"read\",\"path\":\"provider.state.heightened_senses_active\"}]}";

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
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "heightened senses seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "heightened senses seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "heightened senses seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "heightened senses seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "heightened senses seed must not CREATE TABLE");
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
    void ensuresSelfContainedHeroAttrsWithoutOverwritingEntityMetadata() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile("(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Quinn)");
        for (String attr : List.of(
            "hp", "mana", "ad", "attack_speed", "armor", "magic_resist",
            "hp_regen", "mana_regen")) {
            assertTrue(
                Pattern.compile("(?is)attr_key\\s*=\\s*'" + attr + "'")
                    .matcher(sqlNoLineComments)
                    .find()
                    || sql.contains("'" + attr + "'"),
                "must preflight or write attr_key=" + attr);
        }
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            sql.contains("565") && sql.contains("269") && sql.contains("59")
                && sql.contains("0.668") && sql.contains("28") && sql.contains("30")
                && sql.contains("5.5") && sql.contains("'mana_regen', 7"),
            "must seed Quinn level-1 panel numbers");
    }

    @Test
    void seedsBasicAttackGraphWithBasicAttackHitEmit() {
        assertContains("provider_hero_quinn_basic_attack");
        assertContains("ability_hero_quinn_basic_attack");
        assertContains("phase_hero_quinn_basic_attack_impact");
        assertContains("sequence_hero_quinn_basic_attack_damage");
        assertContains("step_hero_quinn_basic_attack_damage");
        assertContains("step_hero_quinn_basic_attack_emit_hit");
        assertContains("event_ref_hero_quinn_basic_attack_hit");
        assertContains("INSERT INTO public.ability_phases");
        assertContains("INSERT INTO public.ability_phase_effect_sequences");
        assertContains("event_effect_details");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_basic_attack_damage'\\s*,\\s*"
                        + "'sequence_hero_quinn_basic_attack_damage'\\s*,\\s*0\\s*,\\s*20150")
                .matcher(sql)
                .find(),
            "BA damage step must be order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_basic_attack_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_quinn_basic_attack_damage'\\s*,\\s*1\\s*,\\s*20158")
                .matcher(sql)
                .find(),
            "emit_event step must be order 1 after damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_basic_attack_emit_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "'event_ref_hero_quinn_basic_attack_hit'")
                .matcher(sql)
                .find(),
            "emit detail must use event/basic_attack_hit and stable event_ref");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_quinn'\\s*,\\s*'provider_hero_quinn_basic_attack'")
                .matcher(sql)
                .find(),
            "must mount BA provider to hero_quinn");
    }

    @Test
    void mountsHeightenedSensesProviderCoexistingWithBasicAttack() {
        assertContains("provider_hero_quinn_heightened_senses");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_quinn'\\s*,\\s*'provider_hero_quinn_heightened_senses'")
                .matcher(sql)
                .find(),
            "must mount heightened senses provider to hero_quinn");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_quinn_heightened_senses'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "provider kind must be passive 20120");
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount BA + W providers via entity_provider_mounts");
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly two providers (BA + Heightened Senses)");
    }

    @Test
    void declaresProviderTargetHarrierVulnerableSchemaWithoutForgingMarkSource() {
        assertContains("20252");
        assertContains("state_scope/provider_target");
        assertContains("provider.target_state.harrier_vulnerable");
        assertTrue(
            Pattern.compile(
                    "(?s)'harrier_vulnerable'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1"
                        + "[\\s\\S]{0,40}NULL[\\s\\S]{0,20}NULL")
                .matcher(sql)
                .find(),
            "harrier_vulnerable must be max1 / untimed (NULL duration / NULL refresh)");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value (runtime initial 0)");
        assertFalse(
            Pattern.compile(
                    "(?s)'harrier_vulnerable'\\s*,\\s*'[^']+'\\s*,\\s*2017[02]")
                .matcher(sqlNoLineComments)
                .find(),
            "must not forge harrier_vulnerable mark source via state_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?s)state_effect_details[\\s\\S]{0,400}'harrier_vulnerable'")
                .matcher(sqlNoLineComments)
                .find(),
            "state_effect_details must not write harrier_vulnerable in this seed");
    }

    @Test
    void definesTimedHeightenedSensesActiveAndStateDrivenAttackSpeedPercentAdd() {
        assertTrue(
            Pattern.compile(
                    "(?s)'heightened_senses_active'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1"
                        + "[\\s\\S]{0,20}2000[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "heightened_senses_active max1 / 2000ms / refresh_duration");
        assertContains(AS_BONUS);
        assertContains("\"value\":0.80");
        assertContains("20173");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_quinn_heightened_senses_attack_speed'[\\s\\S]{0,300}"
                        + "'attack_speed'[\\s\\S]{0,120}20173\\s*,\\s*"
                        + "'heightened_senses_attack_speed'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "AS modifier must be percent_add with NULL condition_formula_key");
    }

    @Test
    void basicAttackHitListenerArmsActiveWhenTargetHarrierVulnerable() {
        assertContains("listener_hero_quinn_heightened_senses_basic_attack_hit");
        assertContains("sequence_hero_quinn_heightened_senses_arm");
        assertContains("step_hero_quinn_heightened_senses_active_arm");
        assertContains(ARM_CONDITION);
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_quinn_heightened_senses_basic_attack_hit'\\s*,\\s*"
                        + "'provider_hero_quinn_heightened_senses'\\s*,\\s*"
                        + "'heightened_senses_on_basic_attack_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "NULL")
                .matcher(sql)
                .find(),
            "listener must bind basic_attack_hit without ability filter");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_quinn_heightened_senses_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20211 basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_quinn_heightened_senses_basic_attack_hit'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_heightened_senses_active_arm'\\s*,\\s*"
                        + "'sequence_hero_quinn_heightened_senses_arm'\\s*,\\s*0\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*'heightened_senses_arm_condition'")
                .matcher(sql)
                .find(),
            "arm step must condition on heightened_senses_arm_condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_quinn_heightened_senses_active_arm'\\s*,\\s*20250\\s*,\\s*"
                        + "'heightened_senses_active'\\s*,\\s*"
                        + "'heightened_senses_active_arm'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "listener sequence must override/set heightened_senses_active=1 on provider scope");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesVisionMoveSpeedHarrierDamageMarkConsumeAndOtherRanks() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_cooldowns\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_cooldowns (W active OOS)");
        assertFalse(
            Pattern.compile(
                    "(?i)move_speed|移速|\\bvision\\b|视野|\\breveal\\b|ghost|幽灵|"
                        + "harrier_damage|额外伤害|consume.?mark|消费.?标记|"
                        + "ability_hero_quinn_[pqer]|skill_quinn")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded Heightened Senses surfaces");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
        assertTrue(
            Pattern.compile("(?i)\\bpartial\\b").matcher(sql).find(),
            "seed must document partial boundary");
        assertTrue(
            sql.contains("W 主动视野") || sql.contains("移速") || sql.contains("Harrier"),
            "seed header must document OOS / gap boundaries");
    }

    @Test
    void citesWikiRevisionHashAndValidatesStableIds() {
        assertContains("Template:Data Quinn/Heightened Senses");
        assertContains("4024767");
        assertContains("d7ac8dad4099a83a2cd898fa4a913fd6700f6dcd459271d2fe93090778b323d3");
        assertContains("normalized/generic/quinn-w.json");
        assertContains("28 to 80");
        assertTrue(
            Pattern.compile("(?i)无截图|无.*OCR|screenshot|OCR").matcher(sql).find()
                && Pattern.compile(
                        "(?i)无截图|不含截图|无.*OCR|不.*OCR|without.*screenshot|"
                            + "no screenshot|截图 / OCR|不是数值溯源")
                    .matcher(sql)
                    .find(),
            "seed comments must explicitly disclaim screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon").matcher(sql).find(),
            "must not cite DDragon / Data Dragon as numeric provenance");
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
        assertContains("partial");
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
