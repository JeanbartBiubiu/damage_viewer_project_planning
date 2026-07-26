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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_fiendhunter_bolts_2512_seed.sql}.
 * Does not connect to a live database.
 *
 * <p>Stable IDs (Opening Barrage / item_2512):
 * <ul>
 *   <li>{@code provider_item_2512_opening_barrage}</li>
 *   <li>{@code ability_item_2512_opening_barrage_ultimate}</li>
 *   <li>{@code listener_item_2512_opening_barrage_arm/true/hit}</li>
 *   <li>{@code modifier_item_2512_opening_barrage_as/crit_chance/crit_forced}</li>
 * </ul>
 */
class LolGenericFiendhunterBolts2512SeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_fiendhunter_bolts_2512_seed.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final String COOLDOWN_ZERO =
        "{\"op\":\"eq\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.opening_barrage_cooldown\"},"
            + "{\"op\":\"const\",\"value\":0}]}";
    private static final String OPENING_BARRAGE_ACTIVE =
        "{\"op\":\"min\",\"args\":[{\"op\":\"gte\",\"args\":[{\"op\":\"read\","
            + "\"path\":\"provider.state.opening_barrage_window\"},{\"op\":\"const\",\"value\":1}]},"
            + "{\"op\":\"gte\",\"args\":[{\"op\":\"read\","
            + "\"path\":\"provider.state.opening_barrage_charges\"},{\"op\":\"const\",\"value\":1}]}]}";
    private static final String OPENING_BARRAGE_ATTACK_SPEED =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.50},{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"provider.state.opening_barrage_window\"},"
            + "{\"op\":\"gte\",\"args\":[{\"op\":\"read\","
            + "\"path\":\"provider.state.opening_barrage_charges\"},{\"op\":\"const\",\"value\":1}]}]}]}";
    private static final String OPENING_BARRAGE_TRUE_AMOUNT =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.15},{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"event.damage.naturalBranchRawAmount\"},"
            + "{\"op\":\"read\",\"path\":\"event.damage.originalCritChance\"}]}]}";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_2512_opening_barrage",
        "ability_item_2512_opening_barrage_ultimate",
        "listener_item_2512_opening_barrage_arm",
        "listener_item_2512_opening_barrage_true",
        "listener_item_2512_opening_barrage_hit",
        "sequence_item_2512_opening_barrage_arm",
        "sequence_item_2512_opening_barrage_true",
        "sequence_item_2512_opening_barrage_hit",
        "step_item_2512_opening_barrage_arm_window",
        "step_item_2512_opening_barrage_arm_charges",
        "step_item_2512_opening_barrage_arm_cooldown",
        "step_item_2512_opening_barrage_true",
        "step_item_2512_opening_barrage_hit_consume",
        "modifier_item_2512_opening_barrage_as",
        "modifier_item_2512_opening_barrage_crit_chance",
        "modifier_item_2512_opening_barrage_crit_forced",
        "opening_barrage_window",
        "opening_barrage_charges",
        "opening_barrage_cooldown",
        "opening_barrage_ultimate",
        "item_2512");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20150, 20160, 20170, 20171, 20172, 20173,
        20181, 20190, 20205, 20211, 20212, 20217, 20222, 20250, 20264, 20266, 20269,
        20277, 20278, 20279, 20280);

    private static String sql;
    private static String sqlNoLineComments;
    private static String reservedSql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        reservedSql = Files.readString(resolveRelative(RESERVED_RELATIVE), StandardCharsets.UTF_8);
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
            Pattern.compile("(?i)live\\s*migration").matcher(sqlNoLineComments).find(),
            "must not perform live migration");
        assertFalse(
            Pattern.compile("(?i)migrations/").matcher(sqlNoLineComments).find(),
            "must not reference migration paths in executable SQL");
        assertFalse(
            Pattern.compile("(?i)ddragon").matcher(sqlNoLineComments).find(),
            "must not reference DDragon in executable SQL");
    }

    @Test
    void documentsWikiManifestRawLuaHashAndClassicStats() {
        assertContains("4030984");
        assertContains("e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d");
        assertTrue(
            Pattern.compile("(?i)current-items\\.raw\\.lua|raw\\s+Lua|manifest\\.json")
                .matcher(sql)
                .find(),
            "comments must name League Wiki manifest/raw Lua");
        assertTrue(
            Pattern.compile("(?i)Opening\\s+Barrage|开战弹幕").matcher(sql).find(),
            "must name Opening Barrage");
        assertTrue(
            Pattern.compile("(?i)Fiendhunter|猎魔人").matcher(sql).find(),
            "must name Fiendhunter Bolts");
        assertTrue(
            sqlNoLineComments.contains("'attack_speed', 0.45")
                || sqlNoLineComments.contains("'attack_speed',0.45"),
            "must upsert Wiki attack_speed=0.45");
        assertTrue(
            sqlNoLineComments.contains("'crit_chance', 0.25")
                || sqlNoLineComments.contains("'crit_chance',0.25"),
            "must upsert Wiki crit_chance=0.25");
        assertTrue(
            sqlNoLineComments.contains("'ms_pct', 0.04")
                || sqlNoLineComments.contains("'ms_pct',0.04"),
            "must upsert Wiki ms_pct=0.04");
        assertTrue(
            Pattern.compile("(?i)default0").matcher(sql).find(),
            "must document runtime default0 for state fields");
        assertTrue(
            Pattern.compile("(?i)no\\s+DDragon|不使用\\s*DDragon|不.*DDragon").matcher(sql).find()
                || sql.contains("不使用 DDragon"),
            "comments must forbid DDragon");
        assertTrue(
            Pattern.compile("(?i)Night\\s+Vigil|222512").matcher(sql).find(),
            "must explicitly exclude Night Vigil / Arena 222512");
    }

    @Test
    void reservedSeedDefinesCritCommandAndStages() {
        assertTrue(
            Pattern.compile("\\(20277,\\s*'[^']*',\\s*'command/crit'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20277 command/crit");
        assertTrue(
            Pattern.compile(
                    "\\(20278,\\s*'[^']*',\\s*'stage/crit_chance_pre_settlement'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20278 stage/crit_chance_pre_settlement");
        assertTrue(
            Pattern.compile(
                    "\\(20279,\\s*'[^']*',\\s*'stage/crit_multiplier_forced_branch'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20279 stage/crit_multiplier_forced_branch");
        assertTrue(
            Pattern.compile(
                    "\\(20280,\\s*'[^']*',\\s*'stage/crit_multiplier_natural_branch'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20280 stage/crit_multiplier_natural_branch");
        assertTrue(reservedSql.contains("(20277, 10027)"), "20277 parent must be 10027");
        assertTrue(reservedSql.contains("(20278, 10029)"), "20278 parent must be 10029");
        assertTrue(reservedSql.contains("(20279, 10029)"), "20279 parent must be 10029");
        assertTrue(reservedSql.contains("(20280, 10029)"), "20280 parent must be 10029");
        assertTrue(
            reservedSql.contains("ON CONFLICT (type_id) DO UPDATE SET"),
            "reserved seed must preserve ON CONFLICT update behavior");
        assertTrue(
            reservedSql.contains("ON CONFLICT (type_id, parent_type_id) DO NOTHING"),
            "reserved relations must preserve ON CONFLICT DO NOTHING");
    }

    @Test
    void ensuresGameLocalBasicAttackAndUltimateTypes() {
        assertTrue(
            Pattern.compile("(?is)type_id\\s*=\\s*62003[\\s\\S]*?ability/basic_attack")
                .matcher(sqlNoLineComments)
                .find(),
            "must ensure 62003 ability/basic_attack");
        assertTrue(
            Pattern.compile("(?is)type_id\\s*=\\s*62010[\\s\\S]*?ability/ultimate")
                .matcher(sqlNoLineComments)
                .find(),
            "must ensure 62010 ability/ultimate");
        assertTrue(
            sqlNoLineComments.contains("62003")
                && sqlNoLineComments.contains("'ability/basic_attack'")
                && Pattern.compile("(?is)62003[\\s\\S]{0,200}NULL").matcher(sqlNoLineComments).find(),
            "62003 reserved_type_id must be NULL");
        assertTrue(
            sqlNoLineComments.contains("62010")
                && sqlNoLineComments.contains("'ability/ultimate'")
                && Pattern.compile("(?is)62010[\\s\\S]{0,200}NULL").matcher(sqlNoLineComments).find(),
            "62010 reserved_type_id must be NULL");
        assertTrue(
            Pattern.compile("(?i)already bound to type_key").matcher(sql).find(),
            "must raise on type_id collision");
        assertTrue(
            Pattern.compile("(?i)already bound to type_id").matcher(sql).find(),
            "must raise on type_key collision");
        assertFalse(
            Pattern.compile("(?is)ability_kind_type_id\\s*,?[\\s\\S]{0,40}62010")
                .matcher(sqlNoLineComments)
                .find(),
            "must not put 62010 in ability_kind_type_id");
        assertTrue(
            sqlNoLineComments.contains("'ability_item_2512_opening_barrage_ultimate'")
                && sqlNoLineComments.contains("20130")
                && sqlNoLineComments.contains("'champion'"),
            "ultimate ability must be kind 20130 with cast_origin champion");
        assertTrue(
            Pattern.compile(
                    "(?is)62010\\s*,\\s*'ability'\\s*,\\s*"
                        + "'ability_item_2512_opening_barrage_ultimate'")
                .matcher(sqlNoLineComments)
                .find(),
            "must type_relations 62010 → ultimate ability");
    }

    @Test
    void assertsProviderStatesFormulasAndMount() {
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
        for (Integer reservedId : REQUIRED_RESERVED) {
            assertTrue(
                sqlNoLineComments.contains(String.valueOf(reservedId)),
                "must reference reserved id " + reservedId);
        }

        assertTrue(
            Pattern.compile(
                    "(?s)'opening_barrage_window'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}8000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "window must be number/max1/8000ms/refresh_duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'opening_barrage_charges'[\\s\\S]{0,120}20100[\\s\\S]{0,40}3"
                        + "[\\s\\S]{0,40}NULL[\\s\\S]{0,40}NULL")
                .matcher(sql)
                .find(),
            "charges must be number/max3/NULL duration/NULL refresh");
        assertTrue(
            Pattern.compile(
                    "(?s)'opening_barrage_cooldown'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}45000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "cooldown must be number/max1/45000ms/refresh_duration");

        assertTrue(
            sqlNoLineComments.contains(COOLDOWN_ZERO)
                || sqlNoLineComments.replace(" ", "").contains(COOLDOWN_ZERO.replace(" ", "")),
            "cooldown_zero formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(OPENING_BARRAGE_ACTIVE)
                || sqlNoLineComments.replace(" ", "")
                    .contains(OPENING_BARRAGE_ACTIVE.replace(" ", "")),
            "opening_barrage_active formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(OPENING_BARRAGE_ATTACK_SPEED)
                || sqlNoLineComments.replace(" ", "")
                    .contains(OPENING_BARRAGE_ATTACK_SPEED.replace(" ", "")),
            "opening_barrage_attack_speed formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(OPENING_BARRAGE_TRUE_AMOUNT)
                || sqlNoLineComments.replace(" ", "")
                    .contains(OPENING_BARRAGE_TRUE_AMOUNT.replace(" ", "")),
            "opening_barrage_true_amount formula must match contract");
        assertContains("event.damage.naturalBranchRawAmount");
        assertContains("event.damage.originalCritChance");
        assertContains("{\"op\":\"const\",\"value\":0.80}");
        assertContains("{\"op\":\"const\",\"value\":-1}");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_2512'\\s*,\\s*'provider_item_2512_opening_barrage'")
                .matcher(sql)
                .find(),
            "must mount Opening Barrage provider to item_2512");
        assertTrue(
            Pattern.compile("(?is)ON CONFLICT\\s*\\(game_id,\\s*entity_id\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "entity ensure must not overwrite existing item_2512 rows");
    }

    @Test
    void assertsThreeModifiersAndNoNaturalStageOverride() {
        assertTrue(
            Pattern.compile(
                    "(?is)modifier_item_2512_opening_barrage_as[\\s\\S]*?20110[\\s\\S]*?"
                        + "'attack_speed'[\\s\\S]*?20173")
                .matcher(sqlNoLineComments)
                .find(),
            "AS modifier must be self/attack_speed/percent_add 20173");
        assertTrue(
            Pattern.compile(
                    "(?is)modifier_item_2512_opening_barrage_crit_chance[\\s\\S]*?"
                        + "20264[\\s\\S]*?20110[\\s\\S]*?'hp'[\\s\\S]*?20277[\\s\\S]*?"
                        + "20266[\\s\\S]*?20269[\\s\\S]*?20278[\\s\\S]*?20172")
                .matcher(sqlNoLineComments)
                .find(),
            "crit chance pipeline must use hp placeholder + command/crit stages");
        assertTrue(
            Pattern.compile(
                    "(?is)modifier_item_2512_opening_barrage_crit_forced[\\s\\S]*?"
                        + "20264[\\s\\S]*?20110[\\s\\S]*?'hp'[\\s\\S]*?20277[\\s\\S]*?"
                        + "20266[\\s\\S]*?20269[\\s\\S]*?20279[\\s\\S]*?20171")
                .matcher(sqlNoLineComments)
                .find(),
            "forced branch pipeline must multiply at stage 20279");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b[\\s\\S]*?20280")
                .matcher(sqlNoLineComments)
                .find(),
            "must not seed stage 20280 natural override modifier");
        assertEquals(
            3,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define exactly three provider_modifiers insert blocks");
    }

    @Test
    void assertsArmTrueHitListenersAndSteps() {
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2512_opening_barrage_arm'[\\s\\S]{0,200}20205")
                .matcher(sql)
                .find(),
            "arm listener event_type_id must be 20205");
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_2512_opening_barrage_arm', 20181, 20205"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_2512_opening_barrage_arm', 20181, 62010"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_2512_opening_barrage_arm', 20181, 20212"));

        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2512_opening_barrage_true'[\\s\\S]{0,240}20217"
                        + "[\\s\\S]{0,120}1")
                .matcher(sql)
                .find(),
            "true listener must be damage_instance with per_cast_throttle_ms=1");
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_2512_opening_barrage_true', 20181, 20217"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_2512_opening_barrage_true', 20181, 62003"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_2512_opening_barrage_true', 20181, 20212"));

        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2512_opening_barrage_hit'[\\s\\S]{0,200}20211")
                .matcher(sql)
                .find(),
            "hit listener event_type_id must be 20211");
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_2512_opening_barrage_hit', 20181, 20211"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_2512_opening_barrage_hit', 20181, 20212"));

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2512_opening_barrage_arm_window'\\s*,\\s*"
                        + "'sequence_item_2512_opening_barrage_arm'\\s*,\\s*0\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "arm step 0 must override window");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2512_opening_barrage_arm_charges'\\s*,\\s*"
                        + "'sequence_item_2512_opening_barrage_arm'\\s*,\\s*1\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "arm step 1 must override charges");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2512_opening_barrage_arm_cooldown'\\s*,\\s*"
                        + "'sequence_item_2512_opening_barrage_arm'\\s*,\\s*2\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "arm step 2 must override cooldown");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2512_opening_barrage_true'\\s*,\\s*"
                        + "'sequence_item_2512_opening_barrage_true'\\s*,\\s*0\\s*,\\s*20150\\s*,"
                        + "\\s*20111")
                .matcher(sql)
                .find(),
            "true step must damage opponent");
        assertTrue(
            Pattern.compile(
                    "(?is)step_item_2512_opening_barrage_true[\\s\\S]*?"
                        + "copyable_on_hit[\\s\\S]*?false[\\s\\S]*?crit_eligible[\\s\\S]*?false")
                .matcher(sqlNoLineComments)
                .find()
                || (sqlNoLineComments.contains("'step_item_2512_opening_barrage_true'")
                    && Pattern.compile(
                            "(?s)'step_item_2512_opening_barrage_true'[\\s\\S]{0,200}"
                                + "false[\\s\\S]{0,40}false")
                        .matcher(sql)
                        .find()),
            "true damage must be copyable_on_hit=false and crit_eligible=false");
        Matcher typeRelationsValues =
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b[\\s\\S]*?VALUES"
                        + "([\\s\\S]*?)ON CONFLICT")
                .matcher(sqlNoLineComments);
        assertTrue(typeRelationsValues.find(), "must insert type_relations for ultimate tag");
        assertTrue(
            typeRelationsValues.group(1).contains("ability_item_2512_opening_barrage_ultimate"),
            "type_relations must target ultimate ability");
        assertFalse(
            typeRelationsValues.group(1).contains("step_item_2512_opening_barrage_true"),
            "true damage must not attach type_relations");
        assertFalse(typeRelationsValues.find(), "must have exactly one type_relations insert");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2512_opening_barrage_hit_consume'[\\s\\S]{0,200}"
                        + "20170[\\s\\S]{0,80}opening_barrage_consume")
                .matcher(sql)
                .find()
                || (sqlNoLineComments.contains("'opening_barrage_consume'")
                    && sqlNoLineComments.contains("20170")
                    && sqlNoLineComments.contains(
                        "'step_item_2512_opening_barrage_hit_consume'")),
            "hit consume must add policy 20170 with consume amount -1");
        assertContains("{\"op\":\"const\",\"value\":-1}");
    }

    @Test
    void stableIdsAreUniqueInSeed() {
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "duplicate stable id in test list: " + id);
            assertTrue(sql.contains(id), "missing stable id: " + id);
        }
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider_definitions insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_definitions"),
            "must define exactly one ability_definitions insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_listeners"),
            "must define exactly one provider_listeners insert block");
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
