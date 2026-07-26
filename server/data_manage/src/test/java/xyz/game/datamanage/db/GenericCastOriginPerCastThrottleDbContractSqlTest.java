package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/**
 * Static DB/API contract for {@code cast_origin} on ability definitions and
 * {@code per_cast_throttle_ms} on provider listeners (main/log), compatibility
 * migration, and mapper publish-copy paths. Does not connect to a live database.
 */
class GenericCastOriginPerCastThrottleDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/"
            + "generic_cast_origin_per_cast_throttle_compatibility_migration.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";
    private static final String ABILITY_MAPPER_RESOURCE =
        "/mapper/combatdata/ability_definitions/CombatAbilityDefinitionsMapper.xml";
    private static final String LISTENER_MAPPER_RESOURCE =
        "/mapper/combatdata/provider_listeners/CombatProviderListenersMapper.xml";

    private static String schemaSql;
    private static String migrationSql;
    private static String reservedSql;
    private static String abilityMapperXml;
    private static String listenerMapperXml;
    private static Document abilityMapperDoc;
    private static Document listenerMapperDoc;

    @BeforeAll
    static void loadArtifacts() throws Exception {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
        reservedSql = readRelative(RESERVED_RELATIVE);
        try (InputStream in =
            GenericCastOriginPerCastThrottleDbContractSqlTest.class.getResourceAsStream(
                ABILITY_MAPPER_RESOURCE)) {
            assertNotNull(in, "mapper xml missing on classpath: " + ABILITY_MAPPER_RESOURCE);
            byte[] bytes = in.readAllBytes();
            abilityMapperXml = new String(bytes, StandardCharsets.UTF_8);
            abilityMapperDoc = parseXmlWithoutExternalDtd(bytes);
        }
        try (InputStream in =
            GenericCastOriginPerCastThrottleDbContractSqlTest.class.getResourceAsStream(
                LISTENER_MAPPER_RESOURCE)) {
            assertNotNull(in, "mapper xml missing on classpath: " + LISTENER_MAPPER_RESOURCE);
            byte[] bytes = in.readAllBytes();
            listenerMapperXml = new String(bytes, StandardCharsets.UTF_8);
            listenerMapperDoc = parseXmlWithoutExternalDtd(bytes);
        }
    }

    @Test
    void abilityDefinitionsAndLogHaveNullableCastOriginWithEnumCheck() {
        String main = extractCreateTable(schemaSql, "ability_definitions");
        String log = extractCreateTable(schemaSql, "ability_definitions_log");
        assertTrue(
            Pattern.compile("cast_origin\\s+varchar\\(16\\)").matcher(main).find(),
            "ability_definitions.cast_origin must be varchar(16)");
        assertTrue(
            Pattern.compile("cast_origin\\s+varchar\\(16\\)").matcher(log).find(),
            "ability_definitions_log.cast_origin must be varchar(16)");
        assertFalse(
            Pattern.compile("cast_origin\\s+varchar\\(16\\)\\s+NOT\\s+NULL").matcher(main).find(),
            "cast_origin must remain nullable on ability_definitions");
        assertFalse(
            Pattern.compile("cast_origin\\s+varchar\\(16\\)\\s+NOT\\s+NULL").matcher(log).find(),
            "cast_origin must remain nullable on ability_definitions_log");
        Pattern enumCheck =
            Pattern.compile(
                "cast_origin\\s+IS\\s+NULL\\s+OR\\s+cast_origin\\s+IN\\s*\\(\\s*"
                    + "'champion'\\s*,\\s*'item'\\s*,\\s*'pet'\\s*,\\s*'innate'\\s*\\)",
                Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        assertTrue(enumCheck.matcher(main).find(), "ability_definitions must CHECK cast_origin enum");
        assertTrue(
            enumCheck.matcher(log).find(), "ability_definitions_log must CHECK cast_origin enum");
    }

    @Test
    void providerListenersAndLogHaveNullablePerCastThrottleMsWithNonNegativeCheck() {
        String main = extractCreateTable(schemaSql, "provider_listeners");
        String log = extractCreateTable(schemaSql, "provider_listeners_log");
        assertTrue(
            Pattern.compile(
                    "per_cast_throttle_ms\\s+int(?:eger)?\\s+CHECK\\s*\\(\\s*"
                        + "per_cast_throttle_ms\\s+IS\\s+NULL\\s+OR\\s+per_cast_throttle_ms\\s*>=\\s*0\\s*\\)",
                    Pattern.CASE_INSENSITIVE)
                .matcher(main)
                .find(),
            "provider_listeners.per_cast_throttle_ms must allow null and require >= 0");
        assertTrue(
            Pattern.compile(
                    "per_cast_throttle_ms\\s+int(?:eger)?\\s+CHECK\\s*\\(\\s*"
                        + "per_cast_throttle_ms\\s+IS\\s+NULL\\s+OR\\s+per_cast_throttle_ms\\s*>=\\s*0\\s*\\)",
                    Pattern.CASE_INSENSITIVE)
                .matcher(log)
                .find(),
            "provider_listeners_log.per_cast_throttle_ms must allow null and require >= 0");
        assertFalse(
            Pattern.compile("per_cast_throttle_ms\\s+int(?:eger)?\\s+NOT\\s+NULL", Pattern.CASE_INSENSITIVE)
                .matcher(main)
                .find(),
            "per_cast_throttle_ms must remain nullable on provider_listeners");
    }

    @Test
    void reservedTypesIncludeCastOriginCatalog() {
        assertTrue(reservedSql.contains("(10031,"));
        assertTrue(reservedSql.contains("'cast_origin'"));
        assertTrue(reservedSql.contains("'cast_origin/champion'"));
        assertTrue(reservedSql.contains("'cast_origin/item'"));
        assertTrue(reservedSql.contains("'cast_origin/pet'"));
        assertTrue(reservedSql.contains("'cast_origin/innate'"));
        assertTrue(reservedSql.contains("(20273,"));
        assertTrue(reservedSql.contains("(20274,"));
        assertTrue(reservedSql.contains("(20275,"));
        assertTrue(reservedSql.contains("(20276,"));
        assertTrue(reservedSql.contains("(20273, 10031)"));
        assertTrue(reservedSql.contains("(20274, 10031)"));
        assertTrue(reservedSql.contains("(20275, 10031)"));
        assertTrue(reservedSql.contains("(20276, 10031)"));
    }

    @Test
    void compatibilityMigrationIsIdempotentAndNonDestructive() {
        String migrationNoComments = stripLineComments(migrationSql);
        assertTrue(
            migrationNoComments.contains("ADD COLUMN IF NOT EXISTS cast_origin varchar(16)"));
        assertTrue(
            migrationNoComments.contains(
                "ADD COLUMN IF NOT EXISTS per_cast_throttle_ms integer"));
        assertEquals(
            2,
            countOccurrences(
                migrationNoComments, "ADD COLUMN IF NOT EXISTS cast_origin varchar(16)"),
            "migration must ADD cast_origin on both main and log");
        assertEquals(
            2,
            countOccurrences(
                migrationNoComments, "ADD COLUMN IF NOT EXISTS per_cast_throttle_ms integer"),
            "migration must ADD per_cast_throttle_ms on both main and log");
        assertTrue(migrationNoComments.contains("ck_ability_definitions_cast_origin"));
        assertTrue(migrationNoComments.contains("ck_ability_definitions_log_cast_origin"));
        assertTrue(migrationNoComments.contains("ck_provider_listeners_per_cast_throttle_ms"));
        assertTrue(migrationNoComments.contains("ck_provider_listeners_log_per_cast_throttle_ms"));
        assertTrue(
            Pattern.compile("(?is)IF\\s+NOT\\s+EXISTS").matcher(migrationNoComments).find(),
            "CHECK creation must be guarded with IF NOT EXISTS");
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(migrationNoComments).find(),
            "migration must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+TABLE\\b").matcher(migrationNoComments).find(),
            "migration must not DROP TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+COLUMN\\b").matcher(migrationNoComments).find(),
            "migration must not DROP COLUMN");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(migrationNoComments).find(),
            "migration must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+CONSTRAINT\\b").matcher(migrationNoComments).find(),
            "migration must not DROP CONSTRAINT");
        assertFalse(
            Pattern.compile("(?i)\\bversions:publish\\b").matcher(migrationNoComments).find(),
            "migration must not publish");
    }

    @Test
    void abilityMapperSelectUpsertAndPublishCopyIncludeCastOrigin() {
        assertTrue(abilityMapperXml.contains("cast_origin AS \"castOrigin\""));
        assertTrue(abilityMapperXml.contains("#{castOrigin}"));
        assertTrue(abilityMapperXml.contains("cast_origin = EXCLUDED.cast_origin"));

        assertAbilityStatementContains("select", "list", "cast_origin AS \"castOrigin\"");
        assertAbilityStatementContains("select", "findById", "cast_origin AS \"castOrigin\"");
        assertAbilityStatementContains(
            "select", "listChangedSince", "cast_origin AS \"castOrigin\"");
        assertAbilityStatementContains("update", "upsert", "cast_origin");
        assertAbilityStatementContains("update", "upsert", "#{castOrigin}");

        String copySql = abilityStatementSql("insert", "copyChangedToLog");
        assertTrue(copySql.contains("cast_origin"), "copyChangedToLog must include cast_origin");
        assertTrue(
            copySql.contains("cast_origin = EXCLUDED.cast_origin")
                || copySql.contains("cast_origin=EXCLUDED.cast_origin"),
            "copyChangedToLog conflict update must set cast_origin");
    }

    @Test
    void listenerMapperSelectUpsertAndPublishCopyIncludePerCastThrottleMs() {
        assertTrue(listenerMapperXml.contains("per_cast_throttle_ms AS \"perCastThrottleMs\""));
        assertTrue(listenerMapperXml.contains("#{perCastThrottleMs}"));
        assertTrue(
            listenerMapperXml.contains("per_cast_throttle_ms = EXCLUDED.per_cast_throttle_ms"));

        assertListenerStatementContains(
            "select", "list", "per_cast_throttle_ms AS \"perCastThrottleMs\"");
        assertListenerStatementContains(
            "select", "findById", "per_cast_throttle_ms AS \"perCastThrottleMs\"");
        assertListenerStatementContains(
            "select", "listChangedSince", "per_cast_throttle_ms AS \"perCastThrottleMs\"");
        assertListenerStatementContains("update", "upsert", "per_cast_throttle_ms");
        assertListenerStatementContains("update", "upsert", "#{perCastThrottleMs}");

        String copySql = listenerStatementSql("insert", "copyChangedToLog");
        assertTrue(
            copySql.contains("per_cast_throttle_ms"),
            "copyChangedToLog must include per_cast_throttle_ms");
        assertTrue(
            copySql.contains("per_cast_throttle_ms = EXCLUDED.per_cast_throttle_ms")
                || copySql.contains("per_cast_throttle_ms=EXCLUDED.per_cast_throttle_ms"),
            "copyChangedToLog conflict update must set per_cast_throttle_ms");
    }

    private static void assertAbilityStatementContains(String tag, String id, String needle) {
        String sql = abilityStatementSql(tag, id);
        assertTrue(sql.contains(needle), tag + "#" + id + " must contain: " + needle);
    }

    private static void assertListenerStatementContains(String tag, String id, String needle) {
        String sql = listenerStatementSql(tag, id);
        assertTrue(sql.contains(needle), tag + "#" + id + " must contain: " + needle);
    }

    private static String abilityStatementSql(String tag, String id) {
        return statementSql(abilityMapperDoc, tag, id);
    }

    private static String listenerStatementSql(String tag, String id) {
        return statementSql(listenerMapperDoc, tag, id);
    }

    private static String statementSql(Document doc, String tag, String id) {
        NodeList nodes = doc.getElementsByTagName(tag);
        for (int i = 0; i < nodes.getLength(); i++) {
            Element element = (Element) nodes.item(i);
            if (id.equals(element.getAttribute("id"))) {
                return element.getTextContent();
            }
        }
        fail("mapper statement missing: " + tag + "#" + id);
        return "";
    }

    private static String extractCreateTable(String sql, String tableName) {
        Matcher m =
            Pattern.compile(
                    "(?is)CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\."
                        + Pattern.quote(tableName)
                        + "\\s*\\(")
                .matcher(sql);
        assertTrue(m.find(), "CREATE TABLE public." + tableName + " missing");
        int start = m.start();
        int depth = 0;
        boolean inParens = false;
        for (int i = m.end() - 1; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (c == '(') {
                depth++;
                inParens = true;
            } else if (c == ')') {
                depth--;
                if (inParens && depth == 0) {
                    int end = i + 1;
                    while (end < sql.length() && sql.charAt(end) != ';') {
                        end++;
                    }
                    return sql.substring(start, Math.min(end + 1, sql.length()));
                }
            }
        }
        fail("unable to extract CREATE TABLE body for " + tableName);
        return "";
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

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    private static String readRelative(String relative) throws IOException {
        return Files.readString(resolveRelative(relative), StandardCharsets.UTF_8);
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

    private static Document parseXmlWithoutExternalDtd(byte[] bytes) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setValidating(false);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setExpandEntityReferences(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
        return builder.parse(new java.io.ByteArrayInputStream(bytes));
    }
}
