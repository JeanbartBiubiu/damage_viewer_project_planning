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
 * Static DB/API contract for {@code cast_condition_formula_key} on ability
 * definition main/log tables, compatibility migration, and mapper publish-copy.
 * Does not connect to a live database.
 */
class GenericAbilityCastConditionDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/generic_ability_cast_condition_compatibility_migration.sql";
    private static final String MAPPER_RESOURCE =
        "/mapper/combatdata/ability_definitions/CombatAbilityDefinitionsMapper.xml";

    private static String schemaSql;
    private static String migrationSql;
    private static String mapperXml;
    private static Document mapperDoc;

    @BeforeAll
    static void loadArtifacts() throws Exception {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
        try (InputStream in =
            GenericAbilityCastConditionDbContractSqlTest.class.getResourceAsStream(MAPPER_RESOURCE)) {
            assertNotNull(in, "mapper xml missing on classpath: " + MAPPER_RESOURCE);
            byte[] bytes = in.readAllBytes();
            mapperXml = new String(bytes, StandardCharsets.UTF_8);
            mapperDoc = parseXmlWithoutExternalDtd(bytes);
        }
    }

    @Test
    void abilityDefinitionsAndLogHaveNullableCastConditionFormulaKey() {
        String main = extractCreateTable(schemaSql, "ability_definitions");
        String log = extractCreateTable(schemaSql, "ability_definitions_log");
        assertTrue(
            Pattern.compile("cast_condition_formula_key\\s+varchar\\(128\\)")
                .matcher(main)
                .find(),
            "ability_definitions.cast_condition_formula_key must be varchar(128)");
        assertTrue(
            Pattern.compile("cast_condition_formula_key\\s+varchar\\(128\\)")
                .matcher(log)
                .find(),
            "ability_definitions_log.cast_condition_formula_key must be varchar(128)");
        assertFalse(
            Pattern.compile("cast_condition_formula_key\\s+varchar\\(128\\)\\s+NOT\\s+NULL")
                .matcher(main)
                .find(),
            "cast_condition_formula_key must remain nullable on ability_definitions");
        assertFalse(
            Pattern.compile("cast_condition_formula_key\\s+varchar\\(128\\)\\s+NOT\\s+NULL")
                .matcher(log)
                .find(),
            "cast_condition_formula_key must remain nullable on ability_definitions_log");
        assertTrue(
            Pattern.compile("display_name\\s+varchar\\(100\\)\\s+NOT\\s+NULL")
                .matcher(main)
                .find(),
            "display_name must remain on ability_definitions");
        assertTrue(
            Pattern.compile("display_name\\s+varchar\\(100\\)\\s+NOT\\s+NULL")
                .matcher(log)
                .find(),
            "display_name must remain on ability_definitions_log");
    }

    @Test
    void compatibilityMigrationIsIdempotentAndNonDestructive() {
        String migrationNoComments = stripLineComments(migrationSql);
        assertTrue(
            migrationNoComments.contains(
                "ADD COLUMN IF NOT EXISTS cast_condition_formula_key varchar(128)"));
        assertTrue(migrationNoComments.contains("public.ability_definitions"));
        assertTrue(migrationNoComments.contains("public.ability_definitions_log"));
        assertEquals(
            2,
            countOccurrences(
                migrationNoComments,
                "ADD COLUMN IF NOT EXISTS cast_condition_formula_key varchar(128)"),
            "migration must ADD COLUMN IF NOT EXISTS on both main and log");

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
    void mapperSelectUpsertAndPublishCopyIncludeCastConditionFormulaKey() {
        assertTrue(mapperXml.contains("cast_condition_formula_key AS \"castConditionFormulaKey\""));
        assertTrue(mapperXml.contains("#{castConditionFormulaKey}"));
        assertTrue(
            mapperXml.contains(
                "cast_condition_formula_key = EXCLUDED.cast_condition_formula_key"));

        assertStatementContains(
            "select", "list", "cast_condition_formula_key AS \"castConditionFormulaKey\"");
        assertStatementContains(
            "select", "findById", "cast_condition_formula_key AS \"castConditionFormulaKey\"");
        assertStatementContains(
            "select",
            "listChangedSince",
            "cast_condition_formula_key AS \"castConditionFormulaKey\"");
        assertStatementContains("update", "upsert", "cast_condition_formula_key");
        assertStatementContains("update", "upsert", "#{castConditionFormulaKey}");
        assertStatementContains("update", "upsert", "display_name");
        assertStatementContains("update", "upsert", "#{displayName}");

        String copySql = statementSql("insert", "copyChangedToLog");
        assertTrue(
            copySql.contains("cast_condition_formula_key"),
            "copyChangedToLog must select/insert cast_condition_formula_key");
        assertTrue(
            copySql.contains("display_name"),
            "copyChangedToLog must preserve display_name");
        assertTrue(
            copySql.contains("cast_condition_formula_key = EXCLUDED.cast_condition_formula_key")
                || copySql.contains(
                    "cast_condition_formula_key=EXCLUDED.cast_condition_formula_key"),
            "copyChangedToLog conflict update must set cast_condition_formula_key");
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
