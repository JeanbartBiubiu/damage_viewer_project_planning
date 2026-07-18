package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
 * Static DB/API contract for revisioned {@code image_uri} on game_entities /
 * attribute_definitions (main + log), named composite FKs to images, compatibility
 * migration invariants, and mapper select/upsert/copy. Does not connect to a live DB.
 */
class GenericCombatDataImageReferenceDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/generic_combat_data_image_reference_compatibility_migration.sql";
    private static final String ENTITIES_MAPPER_RESOURCE =
        "/mapper/combatdata/game_entities/CombatGameEntitiesMapper.xml";
    private static final String ATTR_MAPPER_RESOURCE =
        "/mapper/combatdata/attribute_definitions/CombatAttributeDefinitionsMapper.xml";

    private static final List<String> TABLES = List.of(
        "game_entities",
        "game_entities_log",
        "attribute_definitions",
        "attribute_definitions_log"
    );
    private static final List<String> FK_NAMES = List.of(
        "fk_game_entities_image",
        "fk_game_entities_log_image",
        "fk_attribute_definitions_image",
        "fk_attribute_definitions_log_image"
    );

    private static String schemaSql;
    private static String migrationSql;
    private static String entitiesMapperXml;
    private static String attrMapperXml;
    private static Document entitiesMapperDoc;
    private static Document attrMapperDoc;

    @BeforeAll
    static void loadArtifacts() throws Exception {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
        entitiesMapperXml = loadMapper(ENTITIES_MAPPER_RESOURCE);
        attrMapperXml = loadMapper(ATTR_MAPPER_RESOURCE);
        entitiesMapperDoc = parseXmlWithoutExternalDtd(entitiesMapperXml.getBytes(StandardCharsets.UTF_8));
        attrMapperDoc = parseXmlWithoutExternalDtd(attrMapperXml.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void schemaDeclaresNullableImageUriAndNamedCompositeFks() {
        for (String table : TABLES) {
            String ddl = extractCreateTable(schemaSql, table);
            assertTrue(
                Pattern.compile("image_uri\\s+varchar\\(255\\)").matcher(ddl).find(),
                table + " must declare nullable image_uri varchar(255)");
            assertFalse(
                Pattern.compile("image_uri\\s+varchar\\(255\\)\\s+NOT\\s+NULL").matcher(ddl).find(),
                table + ".image_uri must remain nullable");
        }
        for (String fk : FK_NAMES) {
            assertTrue(schemaSql.contains("CONSTRAINT " + fk), "schema must name " + fk);
            assertTrue(
                Pattern.compile(
                        "(?is)CONSTRAINT\\s+"
                            + Pattern.quote(fk)
                            + "\\s+FOREIGN\\s+KEY\\s*\\(\\s*game_id\\s*,\\s*image_uri\\s*\\)\\s*"
                            + "REFERENCES\\s+public\\.images\\s*\\(\\s*game_id\\s*,\\s*uri\\s*\\)")
                    .matcher(schemaSql)
                    .find(),
                fk + " must be composite (game_id, image_uri) -> images(game_id, uri)");
        }
        assertTrue(
            schemaSql.contains("COMMENT ON COLUMN public.game_entities.image_uri"),
            "fresh DDL must comment game_entities.image_uri");
        assertTrue(
            schemaSql.contains("COMMENT ON COLUMN public.attribute_definitions.image_uri"),
            "fresh DDL must comment attribute_definitions.image_uri");
        assertTrue(
            schemaSql.contains("COMMENT ON COLUMN public.game_entities_log.image_uri"),
            "fresh DDL must comment game_entities_log.image_uri");
        assertTrue(
            schemaSql.contains("COMMENT ON COLUMN public.attribute_definitions_log.image_uri"),
            "fresh DDL must comment attribute_definitions_log.image_uri");
    }

    @Test
    void compatibilityMigrationIsIdempotentAndNonDestructive() {
        String migrationNoComments = stripLineComments(migrationSql);
        assertEquals(
            4,
            countOccurrences(migrationNoComments, "ADD COLUMN IF NOT EXISTS image_uri varchar(255)"),
            "migration must ADD COLUMN IF NOT EXISTS on all four tables");
        for (String table : TABLES) {
            assertTrue(
                migrationNoComments.contains("public." + table),
                "migration must touch public." + table);
        }
        for (String fk : FK_NAMES) {
            assertTrue(migrationNoComments.contains(fk), "migration must guard/add " + fk);
            assertTrue(
                migrationNoComments.contains("c.conname = '" + fk + "'"),
                "migration must pg_constraint-guard " + fk);
        }
        assertTrue(
            Pattern.compile("(?is)\\bDO\\s+\\$\\$").matcher(migrationNoComments).find(),
            "migration must use DO $$ block for FK guards");
        assertTrue(
            migrationNoComments.contains("REFERENCES public.images (game_id, uri)"),
            "migration FKs must reference images(game_id, uri)");

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
        assertFalse(
            Pattern.compile("(?is)\\bUPDATE\\s+").matcher(migrationNoComments).find(),
            "migration must not rewrite row data");
    }

    @Test
    void entityMapperSelectUpsertAndPublishCopyIncludeImageUri() {
        assertMapperCarriesImageUri(entitiesMapperDoc, entitiesMapperXml);
    }

    @Test
    void attributeMapperSelectUpsertAndPublishCopyIncludeImageUri() {
        assertMapperCarriesImageUri(attrMapperDoc, attrMapperXml);
    }

    private static void assertMapperCarriesImageUri(Document doc, String xml) {
        assertTrue(xml.contains("image_uri AS \"imageUri\""));
        assertTrue(xml.contains("#{imageUri}"));
        assertTrue(xml.contains("image_uri = EXCLUDED.image_uri"));
        assertFalse(
            Pattern.compile("(?is)image_base64").matcher(xml).find(),
            "mapper must not copy image bytes into combat-data paths");

        assertStatementContains(doc, "select", "list", "image_uri AS \"imageUri\"");
        assertStatementContains(doc, "select", "findById", "image_uri AS \"imageUri\"");
        assertStatementContains(doc, "select", "listChangedSince", "image_uri AS \"imageUri\"");
        assertStatementContains(doc, "update", "upsert", "image_uri");
        assertStatementContains(doc, "update", "upsert", "#{imageUri}");

        String copySql = statementSql(doc, "insert", "copyChangedToLog");
        assertTrue(copySql.contains("image_uri"), "copyChangedToLog must select/insert image_uri");
        assertTrue(
            copySql.contains("image_uri = EXCLUDED.image_uri")
                || copySql.contains("image_uri=EXCLUDED.image_uri"),
            "copyChangedToLog conflict update must set image_uri");
        assertFalse(
            Pattern.compile("(?is)image_base64").matcher(copySql).find(),
            "copyChangedToLog must not include image bytes");
    }

    private static void assertStatementContains(Document doc, String tag, String id, String needle) {
        String sql = statementSql(doc, tag, id);
        assertTrue(sql.contains(needle), tag + "#" + id + " must contain: " + needle);
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

    private static String loadMapper(String resource) throws IOException {
        try (InputStream in = GenericCombatDataImageReferenceDbContractSqlTest.class.getResourceAsStream(resource)) {
            if (in == null) {
                fail("mapper xml missing on classpath: " + resource);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
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
