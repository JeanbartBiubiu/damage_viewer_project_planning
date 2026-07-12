package xyz.game.datamanage.mapper;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.io.InputStream;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.NodeList;

/**
 * Static contract for combatdata mappers: JSONB columns must use real schema names
 * ({@code extend}/{@code expression}/{@code payload}), never a bare placeholder column
 * {@code text}. Select projections that expose JSONB as a string must keep
 * {@code col::text AS col}. Legitimate PostgreSQL casts {@code ::text} are allowed.
 */
class CombatDataMapperXmlJsonbTextContractTest {

    /**
     * Bare identifier {@code text} as a column (not substring of another word, and not the
     * PostgreSQL cast suffix {@code ::text}).
     */
    private static final Pattern BARE_TEXT_COLUMN =
        Pattern.compile("(?i)(?<!::)(?<![A-Za-z0-9_])text(?![A-Za-z0-9_])");

    @Test
    void noCombatdataMapperReferencesBareTextColumn() throws Exception {
        Path combatdataRoot = resolveCombatdataMapperRoot();
        assertTrue(Files.isDirectory(combatdataRoot), "combatdata mapper root missing: " + combatdataRoot);

        List<String> violations = new ArrayList<>();
        try (Stream<Path> files = Files.walk(combatdataRoot)) {
            files.filter(p -> p.getFileName().toString().endsWith(".xml"))
                .sorted()
                .forEach(path -> {
                    String sql;
                    try {
                        sql = Files.readString(path, StandardCharsets.UTF_8);
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                    if (BARE_TEXT_COLUMN.matcher(sql).find()) {
                        violations.add(combatdataRoot.relativize(path).toString());
                    }
                });
        }

        if (!violations.isEmpty()) {
            fail(
                "combatdata mappers must not reference a bare text column (use real JSONB column + optional ::text cast). Found:\n  "
                    + String.join("\n  ", violations));
        }
    }

    @Test
    void providerFormulasSelectsCastExpressionToText() throws Exception {
        assertSelectUsesJsonbTextAlias(
            "/mapper/combatdata/provider_formulas/CombatProviderFormulasMapper.xml",
            "expression");
        assertCopyChangedToLogUsesColumn(
            "/mapper/combatdata/provider_formulas/CombatProviderFormulasMapper.xml",
            "expression");
    }

    @Test
    void eventEffectDetailsSelectsCastPayloadToText() throws Exception {
        assertSelectUsesJsonbTextAlias(
            "/mapper/combatdata/event_effect_details/CombatEventEffectDetailsMapper.xml",
            "payload");
        assertCopyChangedToLogUsesColumn(
            "/mapper/combatdata/event_effect_details/CombatEventEffectDetailsMapper.xml",
            "payload");
    }

    @Test
    void typeRelationsSelectsCastExtendToText() throws Exception {
        assertSelectUsesJsonbTextAlias(
            "/mapper/combatdata/type_relations/CombatTypeRelationsMapper.xml",
            "extend");
        assertCopyChangedToLogUsesColumn(
            "/mapper/combatdata/type_relations/CombatTypeRelationsMapper.xml",
            "extend");
    }

    private static void assertSelectUsesJsonbTextAlias(String resource, String column) throws Exception {
        String expected = column + "::text AS " + column;
        try (InputStream in = CombatDataMapperXmlJsonbTextContractTest.class.getResourceAsStream(resource)) {
            assertNotNull(in, resource);
            Document doc = parseXmlWithoutExternalDtd(in);
            for (String id : List.of("list", "findById", "listChangedSince")) {
                String sql = statementSql(doc, "select", id);
                assertTrue(sql.contains(expected), id + " must project " + expected + ": " + sql);
                assertFalse(BARE_TEXT_COLUMN.matcher(sql).find(), id + " must not reference column text: " + sql);
            }
        }
    }

    private static void assertCopyChangedToLogUsesColumn(String resource, String column) throws Exception {
        try (InputStream in = CombatDataMapperXmlJsonbTextContractTest.class.getResourceAsStream(resource)) {
            assertNotNull(in, resource);
            Document doc = parseXmlWithoutExternalDtd(in);
            String sql = statementSql(doc, "insert", "copyChangedToLog");
            assertTrue(sql.contains(column), "copyChangedToLog must use column " + column + ": " + sql);
            assertTrue(
                sql.contains("EXCLUDED." + column) || sql.contains("excluded." + column),
                "copyChangedToLog must update EXCLUDED." + column + ": " + sql);
            assertFalse(
                BARE_TEXT_COLUMN.matcher(sql).find(),
                "copyChangedToLog must not reference text: " + sql);
        }
    }

    private static String statementSql(Document doc, String tag, String id) {
        NodeList nodes = doc.getElementsByTagName(tag);
        for (int i = 0; i < nodes.getLength(); i++) {
            var element = (org.w3c.dom.Element) nodes.item(i);
            if (id.equals(element.getAttribute("id"))) {
                return element.getTextContent();
            }
        }
        throw new AssertionError(tag + " id=" + id + " not found");
    }

    /** Parse mapper XML offline: block external DTD/entities so CI without network does not hang. */
    private static Document parseXmlWithoutExternalDtd(InputStream in) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setValidating(false);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setExpandEntityReferences(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.parse(in);
    }

    private static Path resolveCombatdataMapperRoot() throws URISyntaxException {
        URL sample =
            CombatDataMapperXmlJsonbTextContractTest.class.getResource(
                "/mapper/combatdata/type_relations/CombatTypeRelationsMapper.xml");
        if (sample == null) {
            fail("CombatTypeRelationsMapper.xml not on test classpath under /mapper/combatdata/");
        }
        Path typeRelationsMapper = Paths.get(sample.toURI());
        return typeRelationsMapper.getParent().getParent();
    }
}
