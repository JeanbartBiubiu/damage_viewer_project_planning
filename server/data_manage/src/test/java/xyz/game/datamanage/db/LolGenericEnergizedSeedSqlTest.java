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
 * Static contract for {@code lol_generic_energized_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericEnergizedSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_energized_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3094_energized",
        "listener_item_3094_energized",
        "sequence_item_3094_energized",
        "step_item_3094_energized_damage",
        "step_item_3094_energized_consume",
        "step_item_3094_energized_charge_add",
        "energized_charge",
        "energized_ready",
        "energized_damage",
        "energized_consume",
        "energized_charge_add");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20150, 20160, 20170, 20172, 20181,
        20211, 20212, 20221, 20250);

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
            "energized seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "energized seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "energized seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "energized seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "energized seed must not CREATE TABLE");
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
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");
    }

    @Test
    void mountsEnergizedProviderOnItem3094() {
        assertContains("provider_item_3094_energized");
        assertContains("item_3094");
        assertTrue(
            Pattern.compile("(?s)'item_3094'\\s*,\\s*'provider_item_3094_energized'")
                .matcher(sql)
                .find(),
            "must mount energized provider to item_3094");
        assertTrue(
            Pattern.compile("(?s)'provider_item_3094_energized'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "energized provider kind must be passive 20120");
    }

    @Test
    void definesUntimedChargeStateMax100WithoutDefaultValue() {
        assertContains("energized_charge");
        assertTrue(
            Pattern.compile(
                    "(?s)'energized_charge'[\\s\\S]{0,120}20100[\\s\\S]{0,40}100[\\s\\S]{0,40}NULL"
                        + "[\\s\\S]{0,40}NULL")
                .matcher(sql)
                .find(),
            "charge state must be value_type 20100 / max 100 / duration NULL / refresh NULL");
        assertContains("20250");
    }

    @Test
    void definesFourFormulasReadyDamageConsumeAndChargeAdd() {
        String ready =
            "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.energized_charge\"},"
                + "{\"op\":\"const\",\"value\":100}]}";
        assertContains(ready);
        assertContains("provider.state.energized_charge");
        assertContains("{\"op\":\"const\",\"value\":40}");
        assertContains("{\"op\":\"const\",\"value\":0}");
        assertContains("{\"op\":\"const\",\"value\":25}");
        assertContains("energized_ready");
        assertContains("energized_damage");
        assertContains("energized_consume");
        assertContains("energized_charge_add");
        assertContains("\"op\":\"gte\"");
    }

    @Test
    void singleListenerAndSequenceWithStrictStepOrder() {
        assertContains("listener_item_3094_energized");
        assertContains("sequence_item_3094_energized");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3094_energized'\\s*,\\s*'provider_item_3094_energized'")
                .matcher(sql)
                .find(),
            "single listener must belong to energized provider");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3094_energized'[\\s\\S]{0,200}20211[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "listener must be basic_attack_hit 20211 with max_triggers_per_event=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3094_energized'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3094_energized'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "listener must ALL-match 20212");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3094_energized'\\s*,\\s*'sequence_item_3094_energized'")
                .matcher(sql)
                .find(),
            "listener must link the single energized sequence");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3094_energized_damage'\\s*,\\s*"
                        + "'sequence_item_3094_energized'\\s*,\\s*0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*"
                        + "'energized_ready'")
                .matcher(sql)
                .find(),
            "step 0 must be damage to opponent gated by energized_ready");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3094_energized_consume'\\s*,\\s*"
                        + "'sequence_item_3094_energized'\\s*,\\s*1\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'energized_ready'")
                .matcher(sql)
                .find(),
            "step 1 must be consume state_change gated by energized_ready");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3094_energized_charge_add'\\s*,\\s*"
                        + "'sequence_item_3094_energized'\\s*,\\s*2\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "NULL")
                .matcher(sql)
                .find(),
            "step 2 must be unconditional charge add");

        assertFalse(
            Pattern.compile("listener_item_3094_energized_").matcher(sql).find(),
            "must not define extra energized listeners beyond the single listener");
        assertFalse(
            Pattern.compile("sequence_item_3094_energized_").matcher(sql).find(),
            "must not define extra energized sequences beyond the single sequence");
    }

    @Test
    void damageIsMagic40NotCopyableConsumeOverride0ThenAdd25() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3094_energized_damage'\\s*,\\s*"
                        + "'energized_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "damage detail must be magic 20221 with add policy");
        assertTrue(
            Pattern.compile("(?is)copyable_on_hit\\s*,").matcher(sqlNoLineComments).find()
                || Pattern.compile("(?is)copyable_on_hit\\s*=")
                    .matcher(sqlNoLineComments)
                    .find(),
            "must explicitly set copyable_on_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3094_energized_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "copyable_on_hit must be explicit false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3094_energized_consume'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,40}'energized_charge'[\\s\\S]{0,40}"
                        + "'energized_consume'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "consume must override charge via provider scope 20250 / policy 20172");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3094_energized_charge_add'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,40}'energized_charge'[\\s\\S]{0,40}"
                        + "'energized_charge_add'[\\s\\S]{0,40}20170")
                .matcher(sql)
                .find(),
            "charge add must use provider scope 20250 / add policy 20170");
    }

    @Test
    void validatesPrerequisitesAndStableIds() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_3094");
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
