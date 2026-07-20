package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_focused_will_3161_seed.sql}.
 * Does not connect to a live database.
 *
 * <p>Stable IDs (Focused Will / item_3161):
 * <ul>
 *   <li>{@code provider_item_3161_focused_will}</li>
 *   <li>{@code listener_item_3161_focused_will_champion}</li>
 *   <li>{@code listener_item_3161_focused_will_pet}</li>
 *   <li>{@code sequence_item_3161_focused_will_grant}</li>
 *   <li>{@code step_item_3161_focused_will_stack_add}</li>
 *   <li>{@code modifier_item_3161_focused_will_amp}</li>
 *   <li>state {@code focused_will_stacks}</li>
 * </ul>
 */
class LolGenericFocusedWill3161SeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_focused_will_3161_seed.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final String AMP_VALUE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.03},"
            + "{\"op\":\"read\",\"path\":\"provider.state.focused_will_stacks\"}]}]}";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3161_focused_will",
        "listener_item_3161_focused_will_champion",
        "listener_item_3161_focused_will_pet",
        "sequence_item_3161_focused_will_grant",
        "step_item_3161_focused_will_stack_add",
        "modifier_item_3161_focused_will_amp",
        "focused_will_stacks",
        "focused_will_stack_add",
        "focused_will_amp_value",
        "focused_will_amp_condition",
        "item_3161");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20160, 20170, 20171, 20180, 20181, 20182, 20190,
        20212, 20217, 20250, 20264, 20265, 20267, 20269, 20272, 20273, 20274,
        20275, 20276);

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
    void documentsExactWikiProvenanceAndExclusions() {
        assertContains("7449-7452");
        assertContains("4030984");
        assertContains("e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d");
        assertTrue(
            Pattern.compile("(?i)Focused\\s+Will|专注意志").matcher(sql).find(),
            "must name Focused Will");
        assertTrue(
            Pattern.compile("(?i)default0").matcher(sql).find(),
            "must document default0 for stacks");
        assertTrue(
            Pattern.compile("(?i)Dragonforce").matcher(sql).find(),
            "must explicitly exclude Dragonforce");
        assertFalse(
            Pattern.compile("(?i)ddragon").matcher(sqlNoLineComments).find(),
            "must not reference DDragon in executable SQL");
        assertTrue(
            Pattern.compile("(?i)no\\s+DDragon|不使用\\s*DDragon|不.*DDragon").matcher(sql).find()
                || sql.contains("不使用 DDragon"),
            "comments must forbid DDragon");
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
    }

    @Test
    void assertsStateStacksThrottleMatchersFormulasAndMount() {
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
                    "(?is)focused_will_stacks[\\s\\S]*?20100[\\s\\S]*?4[\\s\\S]*?6000[\\s\\S]*?20190")
                .matcher(sqlNoLineComments)
                .find(),
            "focused_will_stacks must be number/max4/6000ms/refresh_duration");
        assertTrue(
            sqlNoLineComments.contains("per_cast_throttle_ms")
                && Pattern.compile("(?is)per_cast_throttle_ms[\\s\\S]*?1000")
                    .matcher(sqlNoLineComments)
                    .find(),
            "both listeners must set per_cast_throttle_ms=1000");

        // champion All: damage_instance / source_owner / cast_origin/champion
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3161_focused_will_champion', 20181, 20217"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3161_focused_will_champion', 20181, 20212"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3161_focused_will_champion', 20181, 20273"));
        // Any ability|pet
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3161_focused_will_champion', 20180, 62005"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3161_focused_will_champion', 20180, 62008"));
        // None basic_attack|item|innate
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3161_focused_will_champion', 20182, 62003"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3161_focused_will_champion', 20182, 20274"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3161_focused_will_champion', 20182, 20276"));

        // pet All cast_origin/pet
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3161_focused_will_pet', 20181, 20275"));

        assertTrue(
            sqlNoLineComments.contains(AMP_VALUE)
                || sqlNoLineComments.replace(" ", "").contains(AMP_VALUE.replace(" ", "")),
            "amp value formula must be 1+0.03*focused_will_stacks");
        assertTrue(
            sqlNoLineComments.contains("damage.trait.ability")
                && sqlNoLineComments.contains("damage.trait.pet")
                && sqlNoLineComments.contains("damage.trait.proc")
                && sqlNoLineComments.contains("damage.cast_origin.champion")
                && sqlNoLineComments.contains("damage.cast_origin.pet")
                && sqlNoLineComments.contains("damage.ability_type.basic_attack"),
            "amp condition must cover traits / cast origins / basic_attack==0");
        assertTrue(
            Pattern.compile(
                    "(?is)20264\\s*,\\s*20110\\s*,\\s*'hp'\\s*,\\s*20265\\s*,\\s*20272\\s*,\\s*"
                        + "20269\\s*,\\s*20267")
                .matcher(sqlNoLineComments)
                .find(),
            "modifier must be pipeline/damage/all_damage/all_instances/outgoing_pre_mitigation");
        assertTrue(
            sqlNoLineComments.contains("20171")
                && sqlNoLineComments.contains("'focused_will_amp_value'")
                && sqlNoLineComments.contains("'focused_will_amp_condition'"),
            "modifier must multiply with amp value+condition formulas");
        assertTrue(
            sqlNoLineComments.contains("entity_provider_mounts")
                && sqlNoLineComments.contains("'item_3161'")
                && sqlNoLineComments.contains("'provider_item_3161_focused_will'"),
            "must mount provider on item_3161");
        assertTrue(
            Pattern.compile("(?is)ON CONFLICT\\s*\\(game_id,\\s*entity_id\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "entity ensure must not overwrite existing item_3161 rows");
        assertFalse(
            Pattern.compile("(?i)ability_haste|Dragonforce\\s+haste").matcher(sqlNoLineComments).find(),
            "must not write Dragonforce haste attributes");
        assertTrue(
            reservedSql.contains("(10031,")
                && reservedSql.contains("(20273,")
                && reservedSql.contains("(20276, 10031)"),
            "reserved_types_seed must define cast_origin catalog used by seed");
        assertTrue(
            sqlNoLineComments.contains("62009")
                && sqlNoLineComments.contains("'damage_trait/proc'"),
            "must ensure damage_trait/proc for amp path documentation/catalog");
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "missing: " + needle);
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
