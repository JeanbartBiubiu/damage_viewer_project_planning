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
 * Static contract for {@code lol_generic_linked_effects_seed.sql} and related
 * reserved-type vocabulary rows. Does not connect to a live database.
 */
class LolGenericLinkedEffectsSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_linked_effects_seed.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3071_black_cleaver_carve",
        "listener_item_3071_black_cleaver_carve",
        "sequence_item_3071_black_cleaver_carve",
        "step_item_3071_carve_armor",
        "step_item_3071_carve_stack",
        "carve_stacks_lt_5",
        "carve_armor_amount",
        "carve_stacks_add",
        "black_cleaver_carve",
        "carve_stacks");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20110, 20113, 20122, 20153, 20160, 20170, 20181,
        20200, 20212, 20214, 20215, 20252);

    private static String sql;
    private static String sqlNoLineComments;
    private static String reservedSql;
    private static String reservedNoLineComments;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        Path reservedPath = resolveRelative(RESERVED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        assertTrue(Files.isRegularFile(reservedPath), "reserved seed missing: " + reservedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        reservedSql = Files.readString(reservedPath, StandardCharsets.UTF_8);
        reservedNoLineComments = stripLineComments(reservedSql);
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
            "linked effects seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "linked effects seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bTRUNCATE\\b").matcher(sqlNoLineComments).find(),
            "linked effects seed must not TRUNCATE");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "linked effects seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "linked effects seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "linked effects seed must not CREATE TABLE");
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
    void reservedSeedDefinesDamageDealtPhysicalAndBasicAttackUniqueUnderEventGroup() {
        assertTrue(
            Pattern.compile(
                    "\\(20214,\\s*'造成物理伤害',\\s*'event/damage_dealt/physical'\\)")
                .matcher(reservedNoLineComments)
                .find(),
            "reserved seed must define 20214 event/damage_dealt/physical");
        assertTrue(
            Pattern.compile(
                    "\\(20215,\\s*'造成普攻伤害',\\s*'event/damage_dealt/basic_attack'\\)")
                .matcher(reservedNoLineComments)
                .find(),
            "reserved seed must define 20215 event/damage_dealt/basic_attack");
        assertEquals(
            1,
            countOccurrences(
                reservedNoLineComments, "(20214, '造成物理伤害', 'event/damage_dealt/physical')"),
            "20214 reserved type row must be unique");
        assertEquals(
            1,
            countOccurrences(
                reservedNoLineComments, "(20215, '造成普攻伤害', 'event/damage_dealt/basic_attack')"),
            "20215 reserved type row must be unique");
        assertEquals(
            1,
            countOccurrences(reservedNoLineComments, "'event/damage_dealt/physical'"),
            "event/damage_dealt/physical type_key must be unique");
        assertEquals(
            1,
            countOccurrences(reservedNoLineComments, "'event/damage_dealt/basic_attack'"),
            "event/damage_dealt/basic_attack type_key must be unique");
        assertTrue(
            Pattern.compile("\\(20214,\\s*10019\\)").matcher(reservedNoLineComments).find(),
            "20214 must relate to event group 10019");
        assertTrue(
            Pattern.compile("\\(20215,\\s*10019\\)").matcher(reservedNoLineComments).find(),
            "20215 must relate to event group 10019");
        assertEquals(
            1,
            countOccurrences(reservedNoLineComments, "(20214, 10019)"),
            "20214→10019 relation must be unique");
        assertEquals(
            1,
            countOccurrences(reservedNoLineComments, "(20215, 10019)"),
            "20215→10019 relation must be unique");
    }

    @Test
    void mountsBlackCleaverCarveProviderOnItem3071AsEquipment() {
        assertContains("provider_item_3071_black_cleaver_carve");
        assertContains("item_3071");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3071'\\s*,\\s*'provider_item_3071_black_cleaver_carve'")
                .matcher(sqlNoLineComments)
                .find(),
            "must mount carve provider to item_3071");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3071_black_cleaver_carve'[\\s\\S]{0,80}20122")
                .matcher(sqlNoLineComments)
                .find(),
            "carve provider kind must be equipment 20122");
        assertFalse(
            Pattern.compile("(?i)provider_state_fields").matcher(sqlNoLineComments).find(),
            "must not create provider_state_fields");
        assertFalse(
            Pattern.compile("(?i)provider_modifiers").matcher(sqlNoLineComments).find(),
            "must not create provider_modifiers");
    }

    @Test
    void listenerAllMatchersAndMaxTriggersContract() {
        assertContains("listener_item_3071_black_cleaver_carve");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3071_black_cleaver_carve'\\s*,\\s*"
                        + "'provider_item_3071_black_cleaver_carve'")
                .matcher(sqlNoLineComments)
                .find(),
            "listener must belong to carve provider");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3071_black_cleaver_carve'[\\s\\S]{0,200}"
                        + "20200[\\s\\S]{0,80}1")
                .matcher(sqlNoLineComments)
                .find(),
            "listener must be damage_dealt 20200 with max_triggers_per_event=1");
        for (int matcher : List.of(20200, 20214, 20215, 20212)) {
            assertTrue(
                Pattern.compile(
                        "(?s)'listener_item_3071_black_cleaver_carve'\\s*,\\s*20181\\s*,\\s*"
                            + matcher)
                    .matcher(sqlNoLineComments)
                    .find(),
                "listener must ALL-match " + matcher);
        }
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3071_black_cleaver_carve'\\s*,\\s*"
                        + "'sequence_item_3071_black_cleaver_carve'")
                .matcher(sqlNoLineComments)
                .find(),
            "listener must link the single carve sequence");
    }

    @Test
    void twoStepsAttributeThenStateWithSharedLtFiveCondition() {
        assertContains("sequence_item_3071_black_cleaver_carve");
        assertContains("step_item_3071_carve_armor");
        assertContains("step_item_3071_carve_stack");
        assertContains("attribute_effect_details");
        assertContains("state_effect_details");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3071_carve_armor'\\s*,\\s*"
                        + "'sequence_item_3071_black_cleaver_carve'\\s*,\\s*0\\s*,\\s*"
                        + "20153\\s*,\\s*20113\\s*,\\s*'carve_stacks_lt_5'")
                .matcher(sqlNoLineComments)
                .find(),
            "step 0 must be attribute_change targeting selector/target with shared condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3071_carve_stack'\\s*,\\s*"
                        + "'sequence_item_3071_black_cleaver_carve'\\s*,\\s*1\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*'carve_stacks_lt_5'")
                .matcher(sqlNoLineComments)
                .find(),
            "step 1 must be state_change targeting selector/self with shared condition");

        int armorOrder = indexOfStepOrder("step_item_3071_carve_armor");
        int stackOrder = indexOfStepOrder("step_item_3071_carve_stack");
        assertTrue(armorOrder >= 0 && stackOrder >= 0, "both step orders must be present");
        assertTrue(armorOrder < stackOrder, "attribute_change must precede state_change");

        assertTrue(
            Pattern.compile(
                    "(?s)\\{\"op\"\\s*:\\s*\"lt\"\\s*,\\s*\"args\"\\s*:\\s*\\["
                        + "\\{\"op\"\\s*:\\s*\"read\"\\s*,\\s*\"path\"\\s*:\\s*"
                        + "\"provider\\.target_state\\.carve_stacks\"\\}"
                        + "\\s*,\\s*"
                        + "\\{\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*5\\}"
                        + "\\]\\}")
                .matcher(sqlNoLineComments)
                .find(),
            "condition formula must be lt(provider.target_state.carve_stacks, 5)");
        assertTrue(
            sqlNoLineComments.contains("'carve_stacks_lt_5'"),
            "must define and reference carve_stacks_lt_5");
        assertEquals(
            2,
            countStepConditionRefs("carve_stacks_lt_5"),
            "exactly two effect_steps must reference carve_stacks_lt_5");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3071_carve_armor'\\s*,\\s*"
                        + "'armor'\\s*,\\s*'carve_armor_amount'\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "attribute detail must be armor / carve_armor_amount / add");
        assertTrue(
            Pattern.compile("(?s)\\{\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*-4\\}")
                .matcher(sqlNoLineComments)
                .find(),
            "armor amount formula must be const -4");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3071_carve_stack'\\s*,\\s*"
                        + "20252\\s*,\\s*'carve_stacks'\\s*,\\s*'carve_stacks_add'\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "state detail must be provider_target / carve_stacks / add");
        assertTrue(
            Pattern.compile("(?s)\\{\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*1\\}")
                .matcher(sqlNoLineComments)
                .find(),
            "stack amount formula must be const 1");

        assertTrue(
            sqlNoLineComments.indexOf("INSERT INTO public.effect_steps")
                < sqlNoLineComments.indexOf("INSERT INTO public.attribute_effect_details"),
            "attribute details must follow effect_steps insert");
        assertTrue(
            sqlNoLineComments.indexOf("INSERT INTO public.effect_steps")
                < sqlNoLineComments.indexOf("INSERT INTO public.state_effect_details"),
            "state details must follow effect_steps insert");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void validatesPrerequisitesAndStableIds() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_3071");
        assertContains("attr_key=armor");
        assertContains("INSERT INTO public.types");
        assertTrue(
            Pattern.compile(
                    "(?is)IF\\s+NOT\\s+EXISTS\\s*\\(.*?FROM\\s+public\\.games\\b.*?game_id")
                .matcher(sqlNoLineComments)
                .find(),
            "must guard missing game_id in public.games");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
    }

    private static int indexOfStepOrder(String stepId) {
        Matcher m =
            Pattern.compile(
                    "'" + Pattern.quote(stepId) + "'\\s*,\\s*"
                        + "'sequence_item_3071_black_cleaver_carve'\\s*,\\s*(\\d+)")
                .matcher(sqlNoLineComments);
        if (!m.find()) {
            return -1;
        }
        return Integer.parseInt(m.group(1));
    }

    private static int countStepConditionRefs(String formulaKey) {
        Matcher m =
            Pattern.compile(
                    "(?s)'step_item_3071_carve_(?:armor|stack)'\\s*,\\s*"
                        + "'sequence_item_3071_black_cleaver_carve'\\s*,\\s*\\d+\\s*,\\s*"
                        + "\\d+\\s*,\\s*\\d+\\s*,\\s*'" + Pattern.quote(formulaKey) + "'")
                .matcher(sqlNoLineComments);
        int count = 0;
        while (m.find()) {
            count++;
        }
        return count;
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
