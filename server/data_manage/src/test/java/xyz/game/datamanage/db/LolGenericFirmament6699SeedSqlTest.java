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
 * Static contract for {@code lol_generic_firmament_6699_seed.sql}.
 * Does not connect to a live database.
 *
 * <p>Stable IDs (Firmament / item_6699):
 * <ul>
 *   <li>{@code provider_item_6699_firmament}</li>
 *   <li>{@code listener_item_6699_firmament}</li>
 *   <li>{@code sequence_item_6699_firmament}</li>
 *   <li>{@code step_item_6699_firmament_lethality_arm}</li>
 *   <li>{@code step_item_6699_firmament_damage}</li>
 *   <li>{@code step_item_6699_firmament_consume}</li>
 *   <li>{@code modifier_item_6699_firmament_armor_pen_flat}</li>
 *   <li>states: {@code energized_charge} / {@code firmament_lethality_active}</li>
 *   <li>formulas: {@code energized_ready} / {@code firmament_lethality_arm} /
 *       {@code firmament_damage} / {@code energized_consume} /
 *       {@code firmament_armor_pen_flat}</li>
 * </ul>
 */
class LolGenericFirmament6699SeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_firmament_6699_seed.sql";

    private static final String FIRMAMENT_DAMAGE =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.07},"
            + "{\"op\":\"read\",\"path\":\"event.target.attr.hp.current\"}]}";

    private static final String FIRMAMENT_ARMOR_PEN =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":12},"
            + "{\"op\":\"read\",\"path\":\"provider.state.firmament_lethality_active\"}]}";

    private static final String ENERGIZED_READY =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.energized_charge\"},"
            + "{\"op\":\"const\",\"value\":100}]}";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_6699_firmament",
        "listener_item_6699_firmament",
        "sequence_item_6699_firmament",
        "step_item_6699_firmament_lethality_arm",
        "step_item_6699_firmament_damage",
        "step_item_6699_firmament_consume",
        "modifier_item_6699_firmament_armor_pen_flat",
        "energized_charge",
        "firmament_lethality_active",
        "energized_ready",
        "firmament_lethality_arm",
        "firmament_damage",
        "energized_consume",
        "firmament_armor_pen_flat",
        "firmament_precharge");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20150, 20160, 20170, 20172, 20181, 20190,
        20211, 20212, 20220, 20250);

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
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "firmament seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "firmament seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "firmament seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "firmament seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "firmament seed must not CREATE TABLE");
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
            Pattern.compile("(?i)energized_charge_and_consume").matcher(sqlNoLineComments).find(),
            "must not revive legacy energized triggerKind");
        assertFalse(
            Pattern.compile("(?i)provider_lifecycles").matcher(sqlNoLineComments).find(),
            "must not use lifecycle for untimed charge");
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
    void documentsWikiManifestAndPrechargedBoundary() {
        assertContains("4030984");
        assertContains("e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d");
        assertTrue(
            sql.contains("assumes_charge_at_threshold_before_dps_window"),
            "must document assumes_charge_at_threshold_before_dps_window");
        assertTrue(
            Pattern.compile("(?i)remaining\\s+gap").matcher(sql).find(),
            "must document charge recovery as remaining gap");
        assertTrue(
            Pattern.compile("(?i)precharg").matcher(sql).find(),
            "must document precharged boundary");
        assertTrue(
            Pattern.compile("(?i)default0|运行时缺省\\s*0").matcher(sql).find(),
            "must document runtime default0 for state fields");
        assertTrue(
            Pattern.compile("(?i)ranged").matcher(sql).find(),
            "must document ranged-only branch");
    }

    @Test
    void excludesOutOfScopeFirmamentSurfaces() {
        assertFalse(
            Pattern.compile("(?i)galvanize").matcher(sqlNoLineComments).find(),
            "must not model Galvanize");
        assertFalse(
            Pattern.compile("(?i)natural\\s+charge|charge_add|energized_charge_add")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model natural charge generation / charge_add");
        assertFalse(
            Pattern.compile("(?i)distance\\s*charge|move(?:ment)?\\s*charge")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model movement/distance charge");
        assertFalse(
            Pattern.compile("(?i)non[-_]?champion").matcher(sqlNoLineComments).find(),
            "must not model non-champion cap in executable SQL");
        assertFalse(
            Pattern.compile("\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*200")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode non-champion cap constant 200");
        assertFalse(
            Pattern.compile("\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*0\\.09")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode melee 9% current-HP damage");
        assertFalse(
            Pattern.compile("\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*15")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode melee 15 lethality");
        assertFalse(
            Pattern.compile("(?i)'lethality'").matcher(sqlNoLineComments).find(),
            "must not create lethality attribute alias string");
        assertFalse(
            Pattern.compile("(?i)target_attr_key[^\\n]*lethality")
                .matcher(sqlNoLineComments)
                .find(),
            "modifier must not target lethality alias");
        assertFalse(sql.contains("item_3087"), "must not mount or alter Statikk seed");
        assertFalse(sql.contains("item_3097"), "must not mount or alter Bolt seed");
        assertFalse(sql.contains("item_3094"), "must not mount or alter RFC seed");
    }

    @Test
    void mountsSingleFirmamentProviderOnItem6699() {
        assertContains("provider_item_6699_firmament");
        assertContains("item_6699");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_6699'\\s*,\\s*'provider_item_6699_firmament'")
                .matcher(sql)
                .find(),
            "must mount Firmament provider to item_6699");
        assertFalse(
            Pattern.compile("provider_item_6699_(?!firmament\\b)\\w+")
                .matcher(sqlNoLineComments)
                .find(),
            "item_6699 must not declare a second provider_* id in this seed");
        Matcher mountMatcher =
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_provider_mounts\\b[\\s\\S]*?"
                        + "VALUES[\\s\\S]*?'item_6699'\\s*,\\s*'provider_item_6699_firmament'")
                .matcher(sqlNoLineComments);
        assertTrue(mountMatcher.find(), "must INSERT entity_provider_mounts for item_6699");
        assertFalse(mountMatcher.find(), "must mount exactly one provider on item_6699");
        assertEquals(
            1,
            countOccurrences(
                sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider_definitions insert block");
    }

    @Test
    void declaresChargeAndLethalityStateSchema() {
        assertTrue(
            Pattern.compile(
                    "(?s)'energized_charge'[\\s\\S]{0,120}20100[\\s\\S]{0,40}100"
                        + "[\\s\\S]{0,40}NULL[\\s\\S]{0,40}NULL")
                .matcher(sql)
                .find(),
            "energized_charge must be number / max 100 / untimed");
        assertTrue(
            Pattern.compile(
                    "(?s)'firmament_lethality_active'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}4000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "firmament_lethality_active must be max1 / 4000ms / refresh_on_write 20190");
        assertContains("refresh_on_write");
    }

    @Test
    void encodesReadyDamageAndArmorPenFormulas() {
        assertContains(ENERGIZED_READY);
        assertContains(FIRMAMENT_DAMAGE);
        assertContains(FIRMAMENT_ARMOR_PEN);
        assertContains("{\"op\":\"const\",\"value\":1}");
        assertContains("{\"op\":\"const\",\"value\":0}");
        assertContains("event.target.attr.hp.current");
        assertContains("provider.state.firmament_lethality_active");
        assertContains("armor_pen_flat");
        assertTrue(
            sql.contains("22") || Pattern.compile("(?i)resolved\\s*22|观察\\s*22").matcher(sql).find(),
            "must document Batch-C base 10 + modifier 12 => resolved 22");
    }

    @Test
    void definesArmDamageConsumeSequenceOrder() {
        assertContains("listener_item_6699_firmament");
        assertContains("sequence_item_6699_firmament");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6699_firmament'\\s*,\\s*"
                        + "'provider_item_6699_firmament'")
                .matcher(sql)
                .find(),
            "listener must bind to Firmament provider");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6699_firmament'[\\s\\S]{0,200}20211[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "listener must be basic_attack_hit 20211 with max_triggers_per_event=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6699_firmament'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6699_firmament'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "listener must ALL-match source_owner 20212");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6699_firmament'\\s*,\\s*"
                        + "'sequence_item_6699_firmament'")
                .matcher(sql)
                .find(),
            "listener must bind Firmament sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6699_firmament_lethality_arm'\\s*,\\s*"
                        + "'sequence_item_6699_firmament'\\s*,\\s*0\\s*,\\s*20160\\s*,"
                        + "\\s*20110\\s*,\\s*'energized_ready'")
                .matcher(sql)
                .find(),
            "step 0 must arm lethality active gated by energized_ready");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6699_firmament_damage'\\s*,\\s*"
                        + "'sequence_item_6699_firmament'\\s*,\\s*1\\s*,\\s*20150\\s*,"
                        + "\\s*20111\\s*,\\s*'energized_ready'")
                .matcher(sql)
                .find(),
            "step 1 must be physical damage to opponent gated by energized_ready");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6699_firmament_consume'\\s*,\\s*"
                        + "'sequence_item_6699_firmament'\\s*,\\s*2\\s*,\\s*20160\\s*,"
                        + "\\s*20110\\s*,\\s*'energized_ready'")
                .matcher(sql)
                .find(),
            "step 2 must consume charge gated by energized_ready");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6699_firmament_damage'\\s*,\\s*"
                        + "'firmament_damage'\\s*,\\s*20220\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "damage must be physical 20220 with add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6699_firmament_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "copyable_on_hit must be explicit false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6699_firmament_lethality_arm'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,40}'firmament_lethality_active'[\\s\\S]{0,40}"
                        + "'firmament_lethality_arm'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "arm must override firmament_lethality_active to 1 via provider scope / 20172");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6699_firmament_consume'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,40}'energized_charge'[\\s\\S]{0,40}"
                        + "'energized_consume'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "consume must override charge to 0 via provider scope / policy 20172");
        assertFalse(
            Pattern.compile("(?i)step_item_6699_firmament_charge").matcher(sql).find(),
            "must not define a charge-add step");
    }

    @Test
    void modifierAddsFlatTwelveToCanonicalArmorPenFlat() {
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_6699_firmament_armor_pen_flat'[\\s\\S]*?"
                        + "'armor_pen_flat'[\\s\\S]*?20170[\\s\\S]*?"
                        + "'firmament_armor_pen_flat'")
                .matcher(sql)
                .find(),
            "modifier must flat-add firmament_armor_pen_flat onto armor_pen_flat");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_6699_firmament_armor_pen_flat'[\\s\\S]{0,200}20110")
                .matcher(sql)
                .find(),
            "modifier must target self selector 20110");
    }

    @Test
    void validatesPrerequisitesAndStableIds() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_6699");
        assertContains("Batch-C prerequisite");
        assertContains("armor_pen_flat");
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
