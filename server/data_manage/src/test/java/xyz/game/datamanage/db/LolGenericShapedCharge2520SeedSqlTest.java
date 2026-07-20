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
 * Static contract for {@code lol_generic_shaped_charge_2520_seed.sql}.
 * Does not connect to a live database.
 *
 * <p>Stable IDs (Shaped Charge / item_2520):
 * <ul>
 *   <li>{@code provider_item_2520_shaped_charge}</li>
 *   <li>{@code listener_item_2520_shaped_charge}</li>
 *   <li>{@code sequence_item_2520_shaped_charge}</li>
 *   <li>{@code step_item_2520_shaped_charge_damage}</li>
 *   <li>{@code step_item_2520_shaped_charge_consume}</li>
 *   <li>state: {@code shaped_charge_ready}</li>
 *   <li>formulas: {@code shaped_charge_armed} / {@code shaped_charge_damage} /
 *       {@code shaped_charge_consume}</li>
 * </ul>
 */
class LolGenericShapedCharge2520SeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_shaped_charge_2520_seed.sql";

    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final String SHAPED_CHARGE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":15},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.75},"
            + "{\"op\":\"read\",\"path\":\"source.attr.armor_pen_flat.resolved\"}]}]}";

    private static final String SHAPED_CHARGE_ARMED =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.shaped_charge_ready\"},"
            + "{\"op\":\"const\",\"value\":1}]}";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_2520_shaped_charge",
        "listener_item_2520_shaped_charge",
        "sequence_item_2520_shaped_charge",
        "step_item_2520_shaped_charge_damage",
        "step_item_2520_shaped_charge_consume",
        "shaped_charge_ready",
        "shaped_charge_armed",
        "shaped_charge_damage",
        "shaped_charge_consume",
        "shaped_charge_proc");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20150, 20160, 20170, 20172, 20181, 20182, 20190,
        20212, 20217, 20222, 20250);

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
            "shaped charge seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "shaped charge seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "shaped charge seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "shaped charge seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "shaped charge seed must not CREATE TABLE");
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
        assertContains("4030984");
        assertContains("e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d");
        assertTrue(
            Pattern.compile("(?i)default1").matcher(sql).find(),
            "must document shaped_charge_ready default1");
        assertTrue(
            Pattern.compile("(?i)ranged").matcher(sql).find(),
            "must document ranged-only branch");
        assertTrue(
            Pattern.compile("(?i)refresh_on_write").matcher(sql).find(),
            "must document refresh_on_write");
        assertTrue(
            Pattern.compile("(?i)lazy\\s+expir").matcher(sql).find(),
            "must document lazy expiry restoring default1");
        assertTrue(
            sql.contains("31.5") || Pattern.compile("(?i)22\\s*→\\s*31\\.5|22\\s*=>\\s*31\\.5")
                .matcher(sql)
                .find(),
            "must document base armor_pen_flat 22 => 31.5");
        assertTrue(
            Pattern.compile("(?i)bypass(?:es)?\\s+resistance|旁路抗性").matcher(sql).find(),
            "must document true bypasses resistance");
        assertTrue(
            Pattern.compile("(?i)not\\s+shields|不.*护盾|仍扣盾").matcher(sql).find(),
            "must document true does not bypass shields");
        assertTrue(
            Pattern.compile("(?i)no\\s+recursion|无\\s*recursion").matcher(sql).find(),
            "must document no recursion");
    }

    @Test
    void reservedSeedDefinesDamageInstanceEvent() {
        assertTrue(
            Pattern.compile(
                    "\\(20217,\\s*'伤害实例',\\s*'event/damage_instance'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20217 event/damage_instance");
        assertTrue(
            Pattern.compile("\\(20217,\\s*10019\\)").matcher(reservedSql).find(),
            "20217 must parent under event 10019");
    }

    @Test
    void excludesOutOfScopeShapedChargeSurfaces() {
        assertFalse(
            Pattern.compile("(?i)sabotage|破坏").matcher(sqlNoLineComments).find(),
            "must not model Sabotage/破坏");
        assertFalse(
            Pattern.compile("(?i)\\bmelee\\b").matcher(sqlNoLineComments).find(),
            "must not model melee branch in executable SQL");
        assertFalse(
            Pattern.compile("\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*30\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode melee base 30");
        assertFalse(
            Pattern.compile("\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*1\\.5\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode melee 1.5 lethality ratio");
        assertFalse(
            Pattern.compile("(?i)epic\\s*monster|史诗").matcher(sqlNoLineComments).find(),
            "must not model epic-monster-only gate in executable SQL");
        assertFalse(
            Pattern.compile("(?i)\\bpet\\b").matcher(sqlNoLineComments).find(),
            "must not model pet expansion");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "child damage must not attach type_relations / ability trait");
    }

    @Test
    void mountsSingleShapedChargeProviderOnItem2520() {
        assertContains("provider_item_2520_shaped_charge");
        assertContains("item_2520");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_2520'\\s*,\\s*'provider_item_2520_shaped_charge'")
                .matcher(sql)
                .find(),
            "must mount Shaped Charge provider to item_2520");
        assertFalse(
            Pattern.compile("provider_item_2520_(?!shaped_charge\\b)\\w+")
                .matcher(sqlNoLineComments)
                .find(),
            "item_2520 must not declare a second provider_* id in this seed");
        Matcher mountMatcher =
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_provider_mounts\\b[\\s\\S]*?"
                        + "VALUES[\\s\\S]*?'item_2520'\\s*,\\s*'provider_item_2520_shaped_charge'")
                .matcher(sqlNoLineComments);
        assertTrue(mountMatcher.find(), "must INSERT entity_provider_mounts for item_2520");
        assertFalse(mountMatcher.find(), "must mount exactly one provider on item_2520");
        assertEquals(
            1,
            countOccurrences(
                sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider_definitions insert block");
    }

    @Test
    void declaresReadyStateSchemaDefault1Max1Duration45000() {
        assertTrue(
            Pattern.compile(
                    "(?s)'shaped_charge_ready'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}45000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "shaped_charge_ready must be number / max1 / 45000ms / refresh_on_write 20190");
        assertContains("refresh_on_write");
        assertContains("default1");
    }

    @Test
    void encodesArmedAndDamageFormulas() {
        assertContains(SHAPED_CHARGE_ARMED);
        assertContains(SHAPED_CHARGE_DAMAGE);
        assertContains("{\"op\":\"const\",\"value\":0}");
        assertContains("source.attr.armor_pen_flat.resolved");
        assertContains("provider.state.shaped_charge_ready");
        assertContains("armor_pen_flat");
    }

    @Test
    void definesDamageThenConsumeSequenceWithMatchers() {
        assertContains("listener_item_2520_shaped_charge");
        assertContains("sequence_item_2520_shaped_charge");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2520_shaped_charge'[\\s\\S]{0,200}20217[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "listener must be damage_instance 20217 with max_triggers_per_event=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2520_shaped_charge'\\s*,\\s*20181\\s*,\\s*20217")
                .matcher(sql)
                .find(),
            "listener must ALL-match event/damage_instance 20217");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2520_shaped_charge'\\s*,\\s*20181\\s*,\\s*62005")
                .matcher(sql)
                .find(),
            "listener must ALL-match damage_trait/ability 62005");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2520_shaped_charge'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "listener must ALL-match source_owner 20212");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2520_shaped_charge'\\s*,\\s*20182\\s*,\\s*62003")
                .matcher(sql)
                .find(),
            "listener must NONE-match ability/basic_attack 62003");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2520_shaped_charge'\\s*,\\s*20182\\s*,\\s*62006")
                .matcher(sql)
                .find(),
            "listener must NONE-match damage_trait/on_hit 62006");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2520_shaped_charge'\\s*,\\s*20182\\s*,\\s*62007")
                .matcher(sql)
                .find(),
            "listener must NONE-match damage_trait/item 62007");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_2520_shaped_charge'\\s*,\\s*20182\\s*,\\s*62004")
                .matcher(sql)
                .find(),
            "listener must NONE-match damage_trait/dot 62004");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2520_shaped_charge_damage'\\s*,\\s*"
                        + "'sequence_item_2520_shaped_charge'\\s*,\\s*0\\s*,\\s*20150\\s*,"
                        + "\\s*20111\\s*,\\s*'shaped_charge_armed'")
                .matcher(sql)
                .find(),
            "step 0 must be true damage to opponent gated by shaped_charge_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2520_shaped_charge_consume'\\s*,\\s*"
                        + "'sequence_item_2520_shaped_charge'\\s*,\\s*1\\s*,\\s*20160\\s*,"
                        + "\\s*20110\\s*,\\s*'shaped_charge_armed'")
                .matcher(sql)
                .find(),
            "step 1 must consume ready gated by shaped_charge_armed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2520_shaped_charge_damage'\\s*,\\s*"
                        + "'shaped_charge_damage'\\s*,\\s*20222\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "damage must be true 20222 with add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2520_shaped_charge_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "copyable_on_hit must be explicit false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_2520_shaped_charge_consume'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,40}'shaped_charge_ready'[\\s\\S]{0,40}"
                        + "'shaped_charge_consume'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "consume must override shaped_charge_ready to 0 via provider scope / 20172");
    }

    @Test
    void ensuresGameLocalMatcherTypesWithDualUniquenessGuards() {
        assertContains("ability/basic_attack");
        assertContains("damage_trait/ability");
        assertContains("damage_trait/on_hit");
        assertContains("damage_trait/item");
        assertContains("damage_trait/dot");
        assertContains("62003");
        assertContains("62004");
        assertContains("62005");
        assertContains("62006");
        assertContains("62007");
        assertTrue(
            Pattern.compile("(?i)type_id=62005 already bound").matcher(sql).find(),
            "must dual-unique guard damage_trait/ability 62005");
        assertTrue(
            Pattern.compile("(?i)type_key=damage_trait/ability already bound")
                .matcher(sql)
                .find(),
            "must dual-unique guard damage_trait/ability type_key");
    }

    @Test
    void validatesPrerequisitesAndStableIds() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_2520");
        assertContains("Batch-C prerequisite");
        assertContains("armor_pen_flat");
        assertContains("armor_pen_flat=22");
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
