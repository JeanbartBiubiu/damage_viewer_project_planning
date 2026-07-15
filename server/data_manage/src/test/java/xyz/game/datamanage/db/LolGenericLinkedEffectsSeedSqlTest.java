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
 * Static contract for {@code lol_generic_linked_effects_seed.sql} Carve v2 and
 * related reserved-type vocabulary rows. Does not connect to a live database.
 */
class LolGenericLinkedEffectsSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_linked_effects_seed.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3071_black_cleaver_carve",
        "listener_item_3071_black_cleaver_carve",
        "sequence_item_3071_black_cleaver_carve_v2",
        "step_item_3071_carve_stack_v2",
        "modifier_item_3071_black_cleaver_carve_armor",
        "carve_stacks_add",
        "carve_armor_percent",
        "black_cleaver_carve_v2",
        "carve_stacks");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20113, 20122, 20160, 20170, 20173, 20181, 20190,
        20200, 20212, 20214, 20252);

    private static final List<Integer> ACTIVE_MATCHERS = List.of(20200, 20214, 20212);

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
    void allowsOnlyExactObsoleteBasicAttackMatcherDelete() {
        assertEquals(
            1,
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).results().count(),
            "seed may contain exactly one DELETE (obsolete matcher cleanup)");
        assertTrue(
            Pattern.compile(
                    "(?is)DELETE\\s+FROM\\s+public\\.listener_match_types\\s+"
                        + "WHERE\\s+game_id\\s*=\\s*v_game_id\\s+"
                        + "AND\\s+listener_id\\s*=\\s*'listener_item_3071_black_cleaver_carve'\\s+"
                        + "AND\\s+match_mode_type_id\\s*=\\s*20181\\s+"
                        + "AND\\s+type_id\\s*=\\s*20215\\s*;")
                .matcher(sqlNoLineComments)
                .find(),
            "must DELETE only obsolete ALL/20215 matcher for carve listener");
        assertTrue(
            Pattern.compile(
                    "(?is)DELETE\\s+FROM\\s+public\\.listener_match_types[\\s\\S]{0,400}?"
                        + "GET\\s+DIAGNOSTICS\\s+v_rowcount\\s*=\\s*ROW_COUNT;\\s*"
                        + "IF\\s+v_rowcount\\s*>\\s*0\\s+THEN\\s+v_changed\\s*:=\\s*true;")
                .matcher(sqlNoLineComments)
                .find(),
            "obsolete matcher DELETE rowcount > 0 must set v_changed");
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
        assertFalse(
            Pattern.compile("(?is)DELETE\\s+FROM\\s+public\\.(effect_sequences|effect_steps|"
                    + "attribute_effect_details|state_effect_details|provider_formulas|"
                    + "listener_effect_sequences)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not DELETE historical sequence/step/detail/formula/link rows");
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
        assertTrue(
            Pattern.compile("\\(20214,\\s*10019\\)").matcher(reservedNoLineComments).find(),
            "20214 must relate to event group 10019");
        assertTrue(
            Pattern.compile("\\(20215,\\s*10019\\)").matcher(reservedNoLineComments).find(),
            "20215 must relate to event group 10019");
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
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not mutate item_3071 static attributes");
        assertFalse(
            Pattern.compile("(?is)UPDATE\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not UPDATE entity_attribute_values");
    }

    @Test
    void carveStacksStateFieldMaxFiveDurationSixThousandRefreshOnWrite() {
        assertContains("provider_state_fields");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3071_black_cleaver_carve'\\s*,\\s*"
                        + "'carve_stacks'\\s*,\\s*20100\\s*,\\s*5\\s*,\\s*6000\\s*,\\s*20190")
                .matcher(sqlNoLineComments)
                .find(),
            "carve_stacks must be number/max5/6000ms/refresh 20190");
    }

    @Test
    void listenerAllMatchersWithoutBasicAttackAndLinksV2Sequence() {
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
        for (int matcher : ACTIVE_MATCHERS) {
            assertTrue(
                Pattern.compile(
                        "(?s)'listener_item_3071_black_cleaver_carve'\\s*,\\s*20181\\s*,\\s*"
                            + matcher)
                    .matcher(sqlNoLineComments)
                    .find(),
                "listener must ALL-match " + matcher);
        }
        assertFalse(
            Pattern.compile(
                    "(?s)INSERT\\s+INTO\\s+public\\.listener_match_types[\\s\\S]*?"
                        + "'listener_item_3071_black_cleaver_carve'\\s*,\\s*20181\\s*,\\s*20215")
                .matcher(sqlNoLineComments)
                .find(),
            "active matcher INSERT must not include basic_attack 20215");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3071_black_cleaver_carve'\\s*,\\s*"
                        + "'sequence_item_3071_black_cleaver_carve_v2'")
                .matcher(sqlNoLineComments)
                .find(),
            "active listener must link v2 sequence");
        assertFalse(
            Pattern.compile(
                    "(?s)INSERT\\s+INTO\\s+public\\.listener_effect_sequences[\\s\\S]*?"
                        + "'listener_item_3071_black_cleaver_carve'\\s*,\\s*"
                        + "'sequence_item_3071_black_cleaver_carve'")
                .matcher(sqlNoLineComments)
                .find(),
            "active listener must not INSERT-link legacy v1 sequence");
        assertTrue(
            Pattern.compile(
                    "(?is)UPDATE\\s+public\\.listener_effect_sequences[\\s\\S]*?"
                        + "sequence_id\\s*=\\s*'sequence_item_3071_black_cleaver_carve_v2'"
                        + "[\\s\\S]*?sequence_id\\s*=\\s*'sequence_item_3071_black_cleaver_carve'")
                .matcher(sqlNoLineComments)
                .find(),
            "upgrade must repoint legacy v1 listener link to v2");
    }

    @Test
    void v2SequenceExactlyOneStateChangeAddOneNoConditionNoActiveAttributeChange() {
        assertContains("sequence_item_3071_black_cleaver_carve_v2");
        assertContains("step_item_3071_carve_stack_v2");
        assertContains("state_effect_details");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3071_carve_stack_v2'\\s*,\\s*"
                        + "'sequence_item_3071_black_cleaver_carve_v2'\\s*,\\s*0\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "v2 step 0 must be state_change self with no condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3071_carve_stack_v2'\\s*,\\s*"
                        + "20252\\s*,\\s*'carve_stacks'\\s*,\\s*'carve_stacks_add'\\s*,\\s*20170")
                .matcher(sqlNoLineComments)
                .find(),
            "state detail must be provider_target / carve_stacks / add");
        assertTrue(
            Pattern.compile("(?s)\\{\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*1\\}")
                .matcher(sqlNoLineComments)
                .find(),
            "stack amount formula must be const 1");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_steps"),
            "active graph must define exactly one effect_steps insert");
        assertEquals(
            1,
            countStepInsertsForSequence("sequence_item_3071_black_cleaver_carve_v2"),
            "v2 sequence must have exactly one effect step");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.attribute_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "active graph must not INSERT attribute_change details");
        assertFalse(
            Pattern.compile(
                    "(?s)'step_item_3071_carve_stack_v2'[\\s\\S]{0,120}'carve_stacks_lt_5'")
                .matcher(sqlNoLineComments)
                .find(),
            "v2 step must not use <5 condition");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            sql.contains("sequence_item_3071_black_cleaver_carve")
                && sql.contains("orphan"),
            "seed may document legacy v1 sequence as orphan evidence only");
    }

    @Test
    void opponentArmorPercentAddModifierUsesExactCarveStacksFormula() {
        assertContains("provider_modifiers");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3071_black_cleaver_carve_armor'\\s*,\\s*"
                        + "'provider_item_3071_black_cleaver_carve'\\s*,\\s*"
                        + "'carve_armor_percent'\\s*,\\s*NULL\\s*,\\s*20113\\s*,\\s*"
                        + "'armor'[\\s\\S]{0,120}20173\\s*,\\s*'carve_armor_percent'\\s*,\\s*NULL")
                .matcher(sqlNoLineComments)
                .find(),
            "modifier must target opponent armor with percent_add and no condition");
        assertTrue(
            Pattern.compile(
                    "(?s)\\{\"op\"\\s*:\\s*\"mul\"\\s*,\\s*\"args\"\\s*:\\s*\\["
                        + "\\{\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*-0\\.06\\}"
                        + "\\s*,\\s*"
                        + "\\{\"op\"\\s*:\\s*\"read\"\\s*,\\s*\"path\"\\s*:\\s*"
                        + "\"provider\\.target_state\\.carve_stacks\"\\}"
                        + "\\]\\}")
                .matcher(sqlNoLineComments)
                .find(),
            "formula must be -0.06 * provider.target_state.carve_stacks");
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
        Matcher requiredArray =
            Pattern.compile(
                    "(?is)v_required_reserved\\s+int\\[\\]\\s*:=\\s*ARRAY\\[(.*?)\\]\\s*;")
                .matcher(sqlNoLineComments);
        assertTrue(requiredArray.find(), "must declare v_required_reserved ARRAY");
        String requiredBody = requiredArray.group(1);
        assertFalse(
            Pattern.compile("\\b20215\\b").matcher(requiredBody).find(),
            "required reserved list must not require basic_attack 20215");
        assertFalse(
            Pattern.compile("\\b20153\\b").matcher(requiredBody).find(),
            "required reserved list must not require attribute_change 20153");
    }

    private static int countStepInsertsForSequence(String sequenceId) {
        Matcher m =
            Pattern.compile(
                    "'" + Pattern.quote("step_item_3071_carve_stack_v2") + "'\\s*,\\s*"
                        + "'" + Pattern.quote(sequenceId) + "'")
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
