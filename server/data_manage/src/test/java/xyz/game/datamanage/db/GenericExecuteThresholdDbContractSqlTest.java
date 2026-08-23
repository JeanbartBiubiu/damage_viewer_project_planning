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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static DB contract for Execute Threshold schema + compatibility migration +
 * reserved types. Does not connect to a live database.
 */
class GenericExecuteThresholdDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String TRIGGERS_RELATIVE = "db/game_manage/triggers.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/generic_execute_threshold_compatibility_migration.sql";

    private static final List<String> NINE_OTHER_DETAILS = List.of(
        "damage_effect_details",
        "heal_effect_details",
        "attribute_effect_details",
        "shield_effect_details",
        "provider_effect_details",
        "event_effect_details",
        "ability_control_effect_details",
        "state_effect_details",
        "repeat_effect_details");

    private static String schemaSql;
    private static String triggersSql;
    private static String reservedSql;
    private static String migrationSql;

    @BeforeAll
    static void loadSqlArtifacts() throws IOException {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        triggersSql = readRelative(TRIGGERS_RELATIVE);
        reservedSql = readRelative(RESERVED_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
    }

    @Test
    void executeEffectDetailsMatchDetailPatternWithRatioThreshold() {
        String main = extractCreateTable(schemaSql, "execute_effect_details");
        String log = extractCreateTable(schemaSql, "execute_effect_details_log");

        for (String body : List.of(main, log)) {
            assertTrue(
                Pattern.compile(
                        "threshold\\s+numeric\\s+NOT\\s+NULL\\s+CHECK\\s*\\(\\s*threshold\\s*>\\s*0\\s+AND\\s+threshold\\s*<=\\s*1\\s*\\)")
                    .matcher(body)
                    .find(),
                "threshold must be numeric > 0 and <= 1");
            assertFalse(
                Pattern.compile("threshold\\s+int\\b").matcher(body).find(),
                "threshold must not be integer");
        }

        assertTrue(main.contains("CONSTRAINT pk_execute_effect_details PRIMARY KEY (game_id, step_id)"));
        assertTrue(main.contains("CONSTRAINT fk_execute_effect_details_step FOREIGN KEY (game_id, step_id)"));
        assertTrue(main.contains("REFERENCES public.effect_steps (game_id, step_id)"));
        assertTrue(main.contains("change_revision bigint NOT NULL CHECK (change_revision > 0)"));
        assertTrue(main.contains("updated_at timestamp NOT NULL DEFAULT NOW()"));
        assertTrue(main.contains("PARTITION BY"));

        assertTrue(log.contains("CONSTRAINT pk_execute_effect_details_log PRIMARY KEY (game_id, step_id, version_id)"));
        assertTrue(log.contains("version_id bigint NOT NULL"));
        assertTrue(log.contains("change_revision bigint NOT NULL"));
        assertTrue(log.contains("PARTITION BY"));
        assertFalse(log.contains("updated_at"), "log tables should not carry updated_at");
    }

    @Test
    void triggersIncludeExecuteInPartitionsAndExactlyOneListsWithoutDroppingOthers() {
        String parentsArray = extractArrayLiteral(triggersSql, "v_parents text\\[\\]");
        assertTrue(parentsArray.contains("'execute_effect_details'"));
        assertTrue(parentsArray.contains("'execute_effect_details_log'"));
        for (String detail : NINE_OTHER_DETAILS) {
            assertTrue(parentsArray.contains("'" + detail + "'"), "partition list missing " + detail);
            assertTrue(parentsArray.contains("'" + detail + "_log'"), "partition list missing " + detail + "_log");
        }

        assertTrue(
            triggersSql.contains(
                "(SELECT COUNT(*) FROM public.execute_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)"),
            "count_effect_step_details must include execute");
        for (String detail : NINE_OTHER_DETAILS) {
            assertTrue(
                triggersSql.contains(
                    "(SELECT COUNT(*) FROM public." + detail + " d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)"),
                "exactly-one count must still include " + detail);
        }

        String detailsArray = extractArrayLiteral(triggersSql, "v_details text\\[\\]");
        assertTrue(detailsArray.contains("'execute_effect_details'"));
        for (String detail : NINE_OTHER_DETAILS) {
            assertTrue(detailsArray.contains("'" + detail + "'"), "detail trigger list missing " + detail);
        }
        assertEquals(
            10,
            countOccurrences(detailsArray, "_effect_details'"),
            "exactly-one detail trigger list must cover ten families");
    }

    @Test
    void migrationIsIdempotentAndNonDestructive() {
        assertTrue(migrationSql.contains("CREATE TABLE IF NOT EXISTS"));
        assertTrue(migrationSql.contains("CREATE TABLE IF NOT EXISTS public.execute_effect_details"));
        assertTrue(migrationSql.contains("CREATE TABLE IF NOT EXISTS public.execute_effect_details_log"));
        assertTrue(
            Pattern.compile(
                    "threshold\\s+numeric\\s+NOT\\s+NULL\\s+CHECK\\s*\\(\\s*threshold\\s*>\\s*0\\s+AND\\s+threshold\\s*<=\\s*1\\s*\\)")
                .matcher(extractCreateTable(migrationSql, "execute_effect_details"))
                .find());

        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(migrationSql).find(),
            "migration must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+TABLE\\b").matcher(migrationSql).find(),
            "migration must not DROP TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+COLUMN\\b").matcher(migrationSql).find(),
            "migration must not DROP COLUMN");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(migrationSql).find(),
            "migration must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+CONSTRAINT\\b").matcher(migrationSql).find(),
            "migration must not DROP CONSTRAINT");
        assertFalse(
            Pattern.compile("(?is)ALTER\\s+TABLE[^;]*\\bDROP\\s+CONSTRAINT\\b").matcher(migrationSql).find(),
            "migration must not alter-drop constraints");
    }

    @Test
    void migrationAndSchemaAgreeOnExecuteShape() {
        assertTrue(
            extractCreateTable(migrationSql, "execute_effect_details")
                .contains("CONSTRAINT pk_execute_effect_details PRIMARY KEY (game_id, step_id)"));
        assertTrue(
            extractCreateTable(migrationSql, "execute_effect_details_log")
                .contains("CONSTRAINT pk_execute_effect_details_log PRIMARY KEY (game_id, step_id, version_id)"));
        assertTrue(migrationSql.contains("execute_effect_details_log"));
        assertTrue(migrationSql.contains("trg_execute_effect_details_exactly_one_detail"));
        assertTrue(migrationSql.contains("ensure_game_partitions"));
    }

    @Test
    void reservedTypesDefineExecuteThresholdIdKeyAndRelationUniquely() {
        assertReservedRow(20162, "斩杀阈值", "operation/execute_threshold");
        assertTrue(
            Pattern.compile("\\(20162,\\s*10015\\)").matcher(reservedSql).find(),
            "20162 must parent under operation 10015");
        assertTrue(
            Pattern.compile("\\(20160,\\s*10015\\)").matcher(reservedSql).find(),
            "20160 must remain under operation 10015");
        assertTrue(
            Pattern.compile("\\(20161,\\s*10015\\)").matcher(reservedSql).find(),
            "20161 must remain under operation 10015");

        assertUniqueReservedTypeIdsAndKeys();
        assertUniqueReservedRelations();
    }

    private static void assertReservedRow(int typeId, String name, String typeKey) {
        Pattern row = Pattern.compile(
            "\\(" + typeId + ",\\s*'" + Pattern.quote(name) + "',\\s*'" + Pattern.quote(typeKey) + "'\\)");
        assertTrue(row.matcher(reservedSql).find(), "missing reserved row " + typeId + "/" + typeKey);
    }

    private static void assertUniqueReservedTypeIdsAndKeys() {
        Pattern insertBlock = Pattern.compile(
            "(?s)INSERT INTO public\\.reserved_type \\(type_id, name, type_key\\)\\s*VALUES(.*?)ON CONFLICT");
        Matcher blockMatcher = insertBlock.matcher(reservedSql);
        assertTrue(blockMatcher.find(), "reserved_type insert block missing");
        String values = blockMatcher.group(1);

        Pattern row = Pattern.compile("\\((\\d+)\\s*,\\s*'([^']*)'\\s*,\\s*'([^']*)'\\)");
        Matcher rowMatcher = row.matcher(values);
        Map<Integer, String> idToKey = new HashMap<>();
        Map<String, Integer> keyToId = new HashMap<>();
        while (rowMatcher.find()) {
            int id = Integer.parseInt(rowMatcher.group(1));
            String key = rowMatcher.group(3);
            String previousKey = idToKey.put(id, key);
            assertTrue(previousKey == null, "duplicate reserved type_id " + id);
            Integer previousId = keyToId.put(key, id);
            assertTrue(previousId == null, "duplicate reserved type_key " + key);
        }
        assertTrue(idToKey.containsKey(20162));
        assertEquals("operation/execute_threshold", idToKey.get(20162));
    }

    private static void assertUniqueReservedRelations() {
        Pattern insertBlock = Pattern.compile(
            "(?s)INSERT INTO public\\.reserved_type_relation \\(type_id, parent_type_id\\)\\s*VALUES(.*?)ON CONFLICT");
        Matcher blockMatcher = insertBlock.matcher(reservedSql);
        assertTrue(blockMatcher.find(), "reserved_type_relation insert block missing");
        String values = blockMatcher.group(1);
        Pattern row = Pattern.compile("\\((\\d+)\\s*,\\s*(\\d+)\\)");
        Matcher rowMatcher = row.matcher(values);
        Set<String> pairs = new HashSet<>();
        while (rowMatcher.find()) {
            String pair = rowMatcher.group(1) + "->" + rowMatcher.group(2);
            assertTrue(pairs.add(pair), "duplicate reserved relation " + pair);
        }
        assertTrue(pairs.contains("20162->10015"));
    }

    private static String extractCreateTable(String sql, String table) {
        Pattern pattern = Pattern.compile(
            "(?is)CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+public\\." + Pattern.quote(table)
                + "\\s*\\((.*?)\\)\\s*PARTITION BY");
        Matcher matcher = pattern.matcher(sql);
        assertTrue(matcher.find(), "missing CREATE TABLE for " + table);
        return matcher.group(0);
    }

    private static String extractArrayLiteral(String sql, String declRegex) {
        Pattern pattern = Pattern.compile("(?is)" + declRegex + "\\s*:=\\s*ARRAY\\[(.*?)]\\s*;");
        Matcher matcher = pattern.matcher(sql);
        assertTrue(matcher.find(), "missing array declaration matching " + declRegex);
        return matcher.group(1);
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

    private static String readRelative(String relative) throws IOException {
        Path path = resolveRelative(relative);
        assertTrue(Files.isRegularFile(path), "missing sql artifact: " + path);
        return Files.readString(path, StandardCharsets.UTF_8);
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
