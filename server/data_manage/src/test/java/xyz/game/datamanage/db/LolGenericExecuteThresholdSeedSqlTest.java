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
 * Static contract for {@code lol_generic_execute_threshold_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericExecuteThresholdSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_execute_threshold_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_6676_collector_execute",
        "listener_item_6676_collector_execute",
        "sequence_item_6676_collector_execute",
        "step_item_6676_collector_execute",
        "collector_execute");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20162, 20181, 20211, 20212);

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
            "execute seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "execute seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "execute seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "execute seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "execute seed must not CREATE TABLE");
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
    }

    @Test
    void mountsCollectorExecuteProviderOnItem6676() {
        assertContains("provider_item_6676_collector_execute");
        assertContains("item_6676");
        assertTrue(
            Pattern.compile("(?s)'item_6676'\\s*,\\s*'provider_item_6676_collector_execute'")
                .matcher(sql)
                .find(),
            "must mount execute provider to item_6676");
        assertTrue(
            Pattern.compile("(?s)'provider_item_6676_collector_execute'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "execute provider kind must be passive 20120");
    }

    @Test
    void singleListenerAndSequenceWithExecuteStep() {
        assertContains("listener_item_6676_collector_execute");
        assertContains("sequence_item_6676_collector_execute");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6676_collector_execute'\\s*,\\s*"
                        + "'provider_item_6676_collector_execute'")
                .matcher(sql)
                .find(),
            "single listener must belong to collector execute provider");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6676_collector_execute'[\\s\\S]{0,200}20211[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "listener must be basic_attack_hit 20211 with max_triggers_per_event=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6676_collector_execute'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6676_collector_execute'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20212");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6676_collector_execute'\\s*,\\s*"
                        + "'sequence_item_6676_collector_execute'")
                .matcher(sql)
                .find(),
            "listener must link the single execute sequence");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6676_collector_execute'\\s*,\\s*"
                        + "'sequence_item_6676_collector_execute'\\s*,\\s*0\\s*,\\s*20162\\s*,\\s*20111\\s*,\\s*"
                        + "NULL")
                .matcher(sql)
                .find(),
            "step 0 must be execute_threshold targeting opponent");

        assertFalse(
            Pattern.compile("listener_item_6676_collector_execute_").matcher(sql).find(),
            "must not define extra execute listeners beyond the single listener");
        assertFalse(
            Pattern.compile("sequence_item_6676_collector_execute_").matcher(sql).find(),
            "must not define extra execute sequences beyond the single sequence");
    }

    @Test
    void executeDetailThresholdIsFivePercent() {
        assertContains("execute_effect_details");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6676_collector_execute'\\s*,\\s*0\\.05")
                .matcher(sql)
                .find(),
            "execute_effect_details.threshold must be 0.05");
    }

    @Test
    void validatesPrerequisitesAndStableIds() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_6676");
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
