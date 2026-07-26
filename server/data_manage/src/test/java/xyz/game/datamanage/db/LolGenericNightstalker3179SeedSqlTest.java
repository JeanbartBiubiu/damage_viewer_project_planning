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
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_nightstalker_3179_seed.sql}.
 * Does not connect to a live database.
 *
 * <p>Stable IDs (Nightstalker / item_3179):
 * <ul>
 *   <li>{@code provider_item_3179_nightstalker}</li>
 *   <li>{@code listener_item_3179_nightstalker}</li>
 *   <li>{@code sequence_item_3179_nightstalker}</li>
 *   <li>{@code step_item_3179_nightstalker_damage}</li>
 *   <li>{@code step_item_3179_nightstalker_consume}</li>
 *   <li>state: {@code nightstalker_ready}</li>
 *   <li>formulas: {@code nightstalker_armed} / {@code nightstalker_damage} /
 *       {@code nightstalker_consume}</li>
 * </ul>
 */
class LolGenericNightstalker3179SeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_nightstalker_3179_seed.sql";

    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final String NIGHTSTALKER_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":50},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.5},"
            + "{\"op\":\"read\",\"path\":\"source.attr.armor_pen_flat.resolved\"}]}]}";

    private static final String NIGHTSTALKER_ARMED =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.nightstalker_ready\"},"
            + "{\"op\":\"const\",\"value\":1}]}";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3179_nightstalker",
        "listener_item_3179_nightstalker",
        "sequence_item_3179_nightstalker",
        "step_item_3179_nightstalker_damage",
        "step_item_3179_nightstalker_consume",
        "nightstalker_ready",
        "nightstalker_armed",
        "nightstalker_damage",
        "nightstalker_consume",
        "nightstalker_proc");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20150, 20160, 20170, 20172, 20181,
        20211, 20212, 20222, 20250);

    private static String sql;
    private static String sqlNoLineComments;
    private static String reservedSql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);

        Path reservedPath = resolveRelative(RESERVED_RELATIVE);
        assertTrue(Files.isRegularFile(reservedPath), "reserved seed missing: " + reservedPath);
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
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "nightstalker seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "nightstalker seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "nightstalker seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "nightstalker seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "nightstalker seed must not CREATE TABLE");
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
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b[\\s\\S]*?"
                        + "default_value")
                .matcher(sqlNoLineComments)
                .find(),
            "provider_state_fields has no default column; seed must not invent one");
        assertFalse(
            Pattern.compile("(?i)live\\s*migration").matcher(sqlNoLineComments).find(),
            "must not perform live migration");
        assertFalse(
            Pattern.compile("(?i)migrations/").matcher(sqlNoLineComments).find(),
            "must not reference migration paths");
        assertFalse(
            Pattern.compile("(?i)ddragon").matcher(sqlNoLineComments).find(),
            "must not reference DDragon");
    }

    @Test
    void documentsWikiManifestAndReadyDefaultBoundary() {
        assertContains("8550-8584");
        assertContains("4030984");
        assertContains("e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d");
        assertTrue(
            Pattern.compile("(?i)Nightstalker|夜行者").matcher(sql).find(),
            "must name Nightstalker");
        assertTrue(
            Pattern.compile("(?i)default1").matcher(sql).find(),
            "must document nightstalker_ready default1");
        assertTrue(
            Pattern.compile("(?i)untimed").matcher(sql).find(),
            "must document untimed ready state");
        assertTrue(
            Pattern.compile("(?i)no\\s+refresh\\s+policy|refresh_policy.*NULL").matcher(sql).find()
                || Pattern.compile("(?i)无\\s*refresh").matcher(sql).find(),
            "must document no refresh policy");
        assertTrue(
            sql.contains("0=>50") && sql.contains("18=>77") && sql.contains("20=>80"),
            "must document numeric table 0=>50 / 18=>77 / 20=>80");
        assertTrue(
            Pattern.compile("(?i)bypass(?:es)?\\s+(?:armor|MR|resistance)|旁路抗性|不经护甲")
                .matcher(sql)
                .find(),
            "must document true bypasses armor/MR");
        assertTrue(
            Pattern.compile("(?i)shieldable|仍.*盾|不.*旁路护盾|remains\\s+shieldable")
                .matcher(sql)
                .find(),
            "must document true remains shieldable");
        assertTrue(
            Pattern.compile("(?i)no\\s+recursion|无\\s*recursion|no\\s+phantom")
                .matcher(sql)
                .find(),
            "must document no recursion / no phantom copy");
        assertTrue(
            Pattern.compile("(?i)no\\s+DDragon|不使用\\s*DDragon|不.*DDragon").matcher(sql).find()
                || sql.contains("不使用 DDragon"),
            "comments must forbid DDragon");
    }

    @Test
    void reservedSeedDefinesBasicAttackHitEvent() {
        assertTrue(
            Pattern.compile(
                    "\\(20211,\\s*'普攻命中',\\s*'event/basic_attack_hit'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20211 event/basic_attack_hit");
        assertTrue(
            Pattern.compile("\\(20222,\\s*'真实伤害',\\s*'damage/true'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20222 damage/true");
    }

    @Test
    void excludesOutOfScopeNightstalkerSurfaces() {
        assertFalse(
            Pattern.compile("(?i)\\bblackout\\b|封锁").matcher(sqlNoLineComments).find(),
            "must not model Blackout wards/traps in executable SQL");
        assertFalse(
            Pattern.compile("(?i)visibility|stealth|unseen|4.?second|4000")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model visibility/stealth/unseen/4s window in executable SQL");
        assertFalse(
            Pattern.compile("(?i)re-?arm|recharge|充能|重新武装")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model re-arm/recharge in executable SQL");
        assertFalse(
            Pattern.compile("(?i)multi[-_]?target|多目标").matcher(sqlNoLineComments).find(),
            "must not model multi-target");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "child damage must not attach type_relations");
        assertFalse(
            Pattern.compile("(?i)20190").matcher(sqlNoLineComments).find(),
            "untimed ready must not reference refresh_on_write 20190");
    }

    @Test
    void mountsSingleNightstalkerProviderOnItem3179() {
        assertContains("provider_item_3179_nightstalker");
        assertContains("item_3179");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3179'\\s*,\\s*'provider_item_3179_nightstalker'")
                .matcher(sql)
                .find(),
            "must mount Nightstalker provider to item_3179");
        assertFalse(
            Pattern.compile("provider_item_3179_(?!nightstalker\\b)\\w+")
                .matcher(sqlNoLineComments)
                .find(),
            "item_3179 must not declare a second provider_* id in this seed");
        Matcher mountMatcher =
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_provider_mounts\\b[\\s\\S]*?"
                        + "VALUES[\\s\\S]*?'item_3179'\\s*,\\s*'provider_item_3179_nightstalker'")
                .matcher(sqlNoLineComments);
        assertTrue(mountMatcher.find(), "must INSERT entity_provider_mounts for item_3179");
        assertFalse(mountMatcher.find(), "must mount exactly one provider on item_3179");
        assertEquals(
            1,
            countOccurrences(
                sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider_definitions insert block");
    }

    @Test
    void declaresReadyStateSchemaDefault1Max1Untimed() {
        assertTrue(
            Pattern.compile(
                    "(?s)'nightstalker_ready'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}NULL[\\s\\S]{0,40}NULL")
                .matcher(sql)
                .find(),
            "nightstalker_ready must be number / max1 / untimed (NULL duration + NULL refresh)");
        assertContains("default1");
        assertContains("untimed");
    }

    @Test
    void encodesArmedAndDamageFormulas() {
        assertContains(NIGHTSTALKER_ARMED);
        assertContains(NIGHTSTALKER_DAMAGE);
        assertContains("{\"op\":\"const\",\"value\":0}");
        assertContains("source.attr.armor_pen_flat.resolved");
        assertContains("provider.state.nightstalker_ready");
        assertContains("armor_pen_flat");
        assertTrue(
            Pattern.compile("(?i)18\\s*→\\s*77|18\\s*=>\\s*77|→\\s*77").matcher(sql).find()
                || sql.contains("77"),
            "must document base armor_pen_flat 18 => 77");
    }

    @Test
    void definesDamageThenConsumeSequenceWithMatchers() {
        assertContains("listener_item_3179_nightstalker");
        assertContains("sequence_item_3179_nightstalker");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3179_nightstalker'[\\s\\S]{0,200}20211[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "listener must be basic_attack_hit 20211 with max_triggers_per_event=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3179_nightstalker'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "listener must ALL-match event/basic_attack_hit 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3179_nightstalker'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "listener must ALL-match source_owner 20212");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3179_nightstalker_damage'\\s*,\\s*"
                        + "'sequence_item_3179_nightstalker'\\s*,\\s*0\\s*,\\s*20150\\s*,"
                        + "\\s*20111\\s*,\\s*'nightstalker_armed'")
                .matcher(sql)
                .find(),
            "step 0 must be true damage to opponent gated by nightstalker_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3179_nightstalker_consume'\\s*,\\s*"
                        + "'sequence_item_3179_nightstalker'\\s*,\\s*1\\s*,\\s*20160\\s*,"
                        + "\\s*20110\\s*,\\s*'nightstalker_armed'")
                .matcher(sql)
                .find(),
            "step 1 must consume ready gated by nightstalker_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3179_nightstalker_damage'\\s*,\\s*"
                        + "'nightstalker_damage'\\s*,\\s*20222\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "damage must be true 20222 with add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3179_nightstalker_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "copyable_on_hit must be explicit false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3179_nightstalker_consume'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,40}'nightstalker_ready'[\\s\\S]{0,40}"
                        + "'nightstalker_consume'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "consume must override nightstalker_ready to 0 via provider scope / 20172");
    }

    @Test
    void validatesPrerequisitesAndStableIds() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_3179");
        assertContains("Batch-C prerequisite");
        assertContains("armor_pen_flat");
        assertContains("armor_pen_flat=18");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
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
        assertTrue(sql.contains(needle), "expected seed to contain: " + needle);
    }

    private static Path resolveRelative(String relative) {
        Path direct = Paths.get(relative);
        if (Files.isRegularFile(direct)) {
            return direct.toAbsolutePath().normalize();
        }
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        Path[] candidates =
            new Path[] {
                cwd.resolve(relative),
                cwd.resolve("../" + relative),
                cwd.resolve("../../" + relative),
                cwd.getParent() != null ? cwd.getParent().resolve(relative) : null,
                cwd.getParent() != null && cwd.getParent().getParent() != null
                    ? cwd.getParent().getParent().resolve(relative)
                    : null
            };
        for (Path candidate : candidates) {
            if (candidate != null && Files.isRegularFile(candidate)) {
                return candidate.toAbsolutePath().normalize();
            }
        }
        fail("cannot resolve relative path: " + relative + " from cwd=" + cwd);
        return direct;
    }
}
