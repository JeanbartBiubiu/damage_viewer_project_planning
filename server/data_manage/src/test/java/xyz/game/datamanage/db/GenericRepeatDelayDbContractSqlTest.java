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
 * Static DB/API contract for {@code delay_ms} on repeat detail main/log
 * tables, compatibility migration, and mapper publish-copy. Does not connect
 * to a live database.
 */
class GenericRepeatDelayDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/generic_repeat_delay_compatibility_migration.sql";
    private static final String MAPPER_RESOURCE =
        "/mapper/combatdata/repeat_effect_details/CombatRepeatEffectDetailsMapper.xml";

    private static String schemaSql;
    private static String migrationSql;
    private static String mapperXml;
    private static Document mapperDoc;

    @BeforeAll
    static void loadArtifacts() throws Exception {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
        try (InputStream in =
            GenericRepeatDelayDbContractSqlTest.class.getResourceAsStream(MAPPER_RESOURCE)) {
            assertNotNull(in, "mapper xml missing on classpath: " + MAPPER_RESOURCE);
            byte[] bytes = in.readAllBytes();
            mapperXml = new String(bytes, StandardCharsets.UTF_8);
            mapperDoc = parseXmlWithoutExternalDtd(bytes);
        }
    }

    @Test
    void repeatEffectDetailsAndLogHaveDelayMsDefaultZeroNonNegative() {
        String main = extractCreateTable(schemaSql, "repeat_effect_details");
        String log = extractCreateTable(schemaSql, "repeat_effect_details_log");
        assertTrue(
            Pattern.compile("delay_ms\\s+int\\s+NOT\\s+NULL\\s+DEFAULT\\s+0\\s+CHECK\\s*\\(\\s*delay_ms\\s*>=\\s*0\\s*\\)")
                .matcher(main)
                .find(),
            "repeat_effect_details.delay_ms must default 0 and be >= 0");
        assertTrue(
            Pattern.compile("delay_ms\\s+int\\s+NOT\\s+NULL\\s+DEFAULT\\s+0\\s+CHECK\\s*\\(\\s*delay_ms\\s*>=\\s*0\\s*\\)")
                .matcher(log)
                .find(),
            "repeat_effect_details_log.delay_ms must default 0 and be >= 0");
        assertTrue(
            Pattern.compile("threshold\\s+numeric\\s+NOT\\s+NULL\\s+CHECK\\s*\\(\\s*threshold\\s*>\\s*0\\s*\\)")
                .matcher(main)
                .find(),
            "threshold must remain on repeat_effect_details");
        assertTrue(
            Pattern.compile("threshold\\s+numeric\\s+NOT\\s+NULL\\s+CHECK\\s*\\(\\s*threshold\\s*>\\s*0\\s*\\)")
                .matcher(log)
                .find(),
            "threshold must remain on repeat_effect_details_log");
    }

    @Test
    void compatibilityMigrationIsIdempotentAndNonDestructive() {
        String migrationNoComments = stripLineComments(migrationSql);
        assertTrue(
            migrationNoComments.contains(
                "ADD COLUMN IF NOT EXISTS delay_ms int NOT NULL DEFAULT 0"));
        assertTrue(migrationNoComments.contains("public.repeat_effect_details"));
        assertTrue(migrationNoComments.contains("public.repeat_effect_details_log"));
        assertEquals(
            2,
            countOccurrences(
                migrationNoComments,
                "ADD COLUMN IF NOT EXISTS delay_ms int NOT NULL DEFAULT 0"),
            "migration must ADD COLUMN IF NOT EXISTS on both main and log");
        assertTrue(
            migrationNoComments.contains("ck_repeat_effect_details_delay_ms"),
            "migration must add named check on main");
        assertTrue(
            migrationNoComments.contains("ck_repeat_effect_details_log_delay_ms"),
            "migration must add named check on log");
        assertTrue(
            Pattern.compile("CHECK\\s*\\(\\s*delay_ms\\s*>=\\s*0\\s*\\)")
                .matcher(migrationNoComments)
                .find(),
            "named checks must enforce delay_ms >= 0");

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
    void mapperSelectUpsertAndPublishCopyIncludeDelayMs() {
        assertTrue(mapperXml.contains("delay_ms AS \"delayMs\""));
        assertTrue(mapperXml.contains("#{delayMs}"));
        assertTrue(mapperXml.contains("delay_ms = EXCLUDED.delay_ms"));

        assertStatementContains("select", "list", "delay_ms AS \"delayMs\"");
        assertStatementContains("select", "findById", "delay_ms AS \"delayMs\"");
        assertStatementContains("select", "listChangedSince", "delay_ms AS \"delayMs\"");
        assertStatementContains("update", "upsert", "delay_ms");
        assertStatementContains("update", "upsert", "#{delayMs}");

        String copySql = statementSql("insert", "copyChangedToLog");
        assertTrue(copySql.contains("delay_ms"), "copyChangedToLog must select/insert delay_ms");
        assertTrue(
            copySql.contains("delay_ms = EXCLUDED.delay_ms")
                || copySql.contains("delay_ms=EXCLUDED.delay_ms"),
            "copyChangedToLog conflict update must set delay_ms");
    }

    private static void assertStatementContains(String tag, String id, String needle) {
        String sql = statementSql(tag, id);
        assertTrue(sql.contains(needle), tag + "#" + id + " must contain: " + needle);
    }

    private static String statementSql(String tag, String id) {
        NodeList nodes = mapperDoc.getElementsByTagName(tag);
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
