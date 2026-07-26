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
 * Static contract for {@code lol_generic_kindred_mark_of_kindred_max_marks_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKindredMarkOfKindredMaxMarksSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kindred_mark_of_kindred_max_marks_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_kindred",
        "provider_hero_kindred_mark_of_kindred_max_marks",
        "modifier_hero_kindred_p_max_marks_attack_range",
        "modifier_hero_kindred_p_q_as_probe_attack_speed",
        "kindred_p_q_as_active",
        "kindred_p_q_as_active_arm",
        "kindred_p_q_attack_speed",
        "mark_of_kindred_attack_range_bonus",
        "kindred_p_w_champion_probe_damage",
        "kindred_p_e_missing_hp_probe_damage",
        "ability_hero_kindred_p_q_as_probe",
        "ability_hero_kindred_p_w_champion_probe",
        "ability_hero_kindred_p_e_missing_hp_probe",
        "phase_hero_kindred_p_q_as_probe_impact",
        "phase_hero_kindred_p_w_champion_probe_impact",
        "phase_hero_kindred_p_e_missing_hp_probe_impact",
        "sequence_hero_kindred_p_q_as_probe_arm",
        "sequence_hero_kindred_p_w_champion_probe_impact",
        "sequence_hero_kindred_p_e_missing_hp_probe_impact",
        "step_hero_kindred_p_q_as_probe_arm",
        "step_hero_kindred_p_w_champion_probe_damage",
        "step_hero_kindred_p_e_missing_hp_probe_damage",
        "p_q_as_probe",
        "p_w_champion_probe",
        "p_e_missing_hp_probe");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20160, 20170, 20172,
        20173, 20190, 20220, 20221, 20250, 20260);

    private static final String RANGE_BONUS = "{\"op\":\"const\",\"value\":250}";

    private static final String Q_AS_BONUS =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.60},"
            + "{\"op\":\"read\",\"path\":\"provider.state.kindred_p_q_as_active\"}]}";

    private static final String W_PROBE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":45},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.265},"
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.current\"}]}]}";

    private static final String E_PROBE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":200},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.175},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.max\"},"
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.current\"}]}]}]}";

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
    void ensuresSelfContainedHeroAndAttackRangeWithoutOverwritingEntityMetadata() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        assertContains("INSERT INTO public.attribute_definitions");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict");
        assertTrue(
            Pattern.compile(
                    "(?is)'attack_range'[\\s\\S]{0,120}ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*"
                        + "attr_key\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find()
                || Pattern.compile(
                        "(?is)INSERT\\s+INTO\\s+public\\.attribute_definitions[\\s\\S]{0,400}"
                            + "'attack_range'[\\s\\S]{0,200}DO\\s+NOTHING")
                    .matcher(sqlNoLineComments)
                    .find(),
            "must DML-ensure attack_range attribute_definitions without overwriting");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kindred'\\s*,\\s*'attack_range'\\s*,\\s*500")
                .matcher(sql)
                .find(),
            "must seed baseline attack_range=500");
        for (String attr : List.of("hp", "attack_speed", "attack_range")) {
            assertTrue(
                sql.contains("'" + attr + "'"),
                "must preflight or write attr_key=" + attr);
        }
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void mountsSinglePassiveProviderWithBakedRangeBonusAndResolvedMaxMarkRange() {
        assertContains("provider_hero_kindred_mark_of_kindred_max_marks");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kindred'\\s*,\\s*"
                        + "'provider_hero_kindred_mark_of_kindred_max_marks'")
                .matcher(sql)
                .find(),
            "must mount max-marks provider to hero_kindred");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kindred_mark_of_kindred_max_marks'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "provider kind must be passive 20120");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider");
        assertContains(RANGE_BONUS);
        assertContains("\"value\":250");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_kindred_p_max_marks_attack_range'[\\s\\S]{0,300}"
                        + "'attack_range'[\\s\\S]{0,120}20170\\s*,\\s*"
                        + "'mark_of_kindred_attack_range_bonus'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "range modifier must be permanent add +250 with NULL condition");
        assertTrue(
            sql.contains("750") || sql.contains("500 + 250") || sql.contains("500 +250"),
            "comments must document resolved max-mark range 750");
        assertFalse(
            Pattern.compile("(?i)kindred_marks").matcher(sqlNoLineComments).find(),
            "executable SQL must not introduce kindred_marks state/key");
        assertFalse(
            Pattern.compile("(?i)kindred_marks").matcher(sql).find(),
            "seed must not contain kindred_marks anywhere including comments");
    }

    @Test
    void definesQProbeStateRefreshOnWriteAndAttackSpeedPercentAdd160() {
        assertTrue(
            Pattern.compile(
                    "(?s)'kindred_p_q_as_active'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1"
                        + "[\\s\\S]{0,20}4000[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "kindred_p_q_as_active must be max1 / 4000ms / refresh_on_write");
        assertContains(Q_AS_BONUS);
        assertContains("\"value\":1.60");
        assertContains("20173");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_kindred_p_q_as_probe_attack_speed'[\\s\\S]{0,300}"
                        + "'attack_speed'[\\s\\S]{0,120}20173\\s*,\\s*"
                        + "'kindred_p_q_attack_speed'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "AS modifier must be percent_add 1.60 * state with NULL condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kindred_p_q_as_probe_arm'\\s*,\\s*20250\\s*,\\s*"
                        + "'kindred_p_q_as_active'\\s*,\\s*"
                        + "'kindred_p_q_as_active_arm'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "Q probe must override kindred_p_q_as_active=1 on provider scope");
        assertFalse(
            Pattern.compile("(?is)provider_state_fields[\\s\\S]{0,400}default_value")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_state_fields.default_value (runtime default 0)");
    }

    @Test
    void seedsWEProbeFormulasExactlyAndExcludesCritBranch() {
        assertContains(W_PROBE_DAMAGE);
        assertContains(E_PROBE_DAMAGE);
        assertContains("target.attr.hp.current");
        assertContains("target.attr.hp.max");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kindred_p_w_champion_probe_damage'[\\s\\S]{0,80}"
                        + "'kindred_p_w_champion_probe_damage'\\s*,\\s*20221")
                .matcher(sql)
                .find(),
            "W probe damage must be magic 20221");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kindred_p_e_missing_hp_probe_damage'[\\s\\S]{0,80}"
                        + "'kindred_p_e_missing_hp_probe_damage'\\s*,\\s*20220")
                .matcher(sql)
                .find(),
            "E probe damage must be physical 20220");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kindred_p_e_missing_hp_probe_damage'[\\s\\S]{0,200}"
                        + "crit_eligible[\\s\\S]{0,40}false")
                .matcher(sqlNoLineComments)
                .find()
                || Pattern.compile(
                        "(?s)'step_hero_kindred_p_e_missing_hp_probe_damage'\\s*,\\s*"
                            + "'kindred_p_e_missing_hp_probe_damage'\\s*,\\s*20220\\s*,\\s*"
                            + "20170\\s*,\\s*false\\s*,\\s*false")
                    .matcher(sql)
                    .find(),
            "E probe must set crit_eligible=false (crit branch excluded)");
        assertFalse(
            Pattern.compile("(?i)source\\.attr\\.(ad|ap)").matcher(sqlNoLineComments).find(),
            "probe damage formulas must keep bonus AD/AP at zero (no source AD/AP reads)");
    }

    @Test
    void documentsProbeOnlyQWEBoundaryAndForbidsFullSkillClaims() {
        assertContains("ability_hero_kindred_p_q_as_probe");
        assertContains("ability_hero_kindred_p_w_champion_probe");
        assertContains("ability_hero_kindred_p_e_missing_hp_probe");
        assertTrue(
            Pattern.compile("(?i)probe-only|probe only|非完整技能|partial").matcher(sql).find(),
            "seed must document Q/W/E probe-only / partial boundary");
        assertFalse(
            Pattern.compile(
                    "(?i)ability_hero_kindred_[qwe]\\b|ability_hero_kindred_dance|"
                        + "ability_hero_kindred_wolf|ability_hero_kindred_mounting|"
                        + "skill_kindred")
                .matcher(sqlNoLineComments)
                .find(),
            "must not reuse full production Q/W/E ability ids");
        assertFalse(
            Pattern.compile(
                    "(?i)hunting|takedown|\\bkill\\b|中间印|monster\\s+branch|多目标|"
                        + "pet\\s+schedul|第三下|third.?hit|crit\\s+branch\\s+included")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded hunting/takedown/marks progress/monster/multi/E-crit surfaces");
        assertTrue(
            sql.contains("hunting") || sql.contains("takedown") || sql.contains("野怪")
                || sql.contains("crit"),
            "header comments must document OOS / gap boundaries");
    }

    @Test
    void citesWikiRevisionHashesAndValidatesStableIdsWithoutDDragon() {
        assertContains("Mark of the Kindred");
        assertContains("3994253");
        assertContains("9ac60eae427fac9ba279734dba2c01b34852eb0be84a01d95296328794afc14a");
        assertContains("4007746");
        assertContains("283e590573c7df7385cf317dd4bf881f84af6227080f444ead1d3fd11bb9f3a0");
        assertContains("4038396");
        assertContains("0bf8193ea5a15df5822b58d5a5412defe2a26f5fc8524100b14d0fe793f08185");
        assertContains("4022506");
        assertContains("19b3fcaebacc7f41676122e57574eb3e4a91cbc838a915439c02f6cca79bf5b4");
        assertTrue(
            Pattern.compile("(?i)无截图|无.*OCR|screenshot|OCR").matcher(sql).find()
                && Pattern.compile(
                        "(?i)无截图|不含截图|无.*OCR|不.*OCR|without.*screenshot|"
                            + "no screenshot|截图 / OCR|不是数值溯源")
                    .matcher(sql)
                    .find(),
            "seed comments must explicitly disclaim screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon|champion-static")
                .matcher(sqlNoLineComments)
                .find(),
            "executable SQL must not cite DDragon / champion-static as numeric provenance");
        assertFalse(
            Pattern.compile("(?i)screenshot|ocr|截图识别|光学字符")
                .matcher(sqlNoLineComments)
                .find(),
            "executable SQL must not cite screenshot/OCR provenance");
        assertTrue(
            Pattern.compile("(?i)无\\s*DDragon|不含\\s*DDragon|无.*DDragon")
                .matcher(sql)
                .find(),
            "header must explicitly disclaim DDragon numeric provenance");
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
