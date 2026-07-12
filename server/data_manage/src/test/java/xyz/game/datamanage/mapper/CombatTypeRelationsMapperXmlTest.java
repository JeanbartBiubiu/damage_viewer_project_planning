package xyz.game.datamanage.mapper;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.NodeList;

/**
 * Static contract: CombatTypeRelationsMapper publish SQL must use schema column {@code extend}
 * (jsonb), not legacy {@code text}.
 */
class CombatTypeRelationsMapperXmlTest {

    private static final String MAPPER_RESOURCE =
        "/mapper/combatdata/type_relations/CombatTypeRelationsMapper.xml";

    /**
     * Bare identifier {@code text} as a column (not substring of another word, and not the
     * PostgreSQL cast suffix {@code ::text}).
     */
    private static final Pattern BARE_TEXT_COLUMN =
        Pattern.compile("(?i)(?<!::)(?<![A-Za-z0-9_])text(?![A-Za-z0-9_])");

    @Test
    void listChangedSinceUsesExtendTextAliasLikeList() throws Exception {
        try (InputStream in = getClass().getResourceAsStream(MAPPER_RESOURCE)) {
            assertNotNull(in);
            Document doc = parseXmlWithoutExternalDtd(in);
            String sql = statementSql(doc, "select", "listChangedSince");
            assertTrue(sql.contains("extend::text AS extend"), sql);
            assertFalse(BARE_TEXT_COLUMN.matcher(sql).find(), "must not reference column text: " + sql);
        }
    }

    @Test
    void copyChangedToLogUsesExtendNotText() throws Exception {
        try (InputStream in = getClass().getResourceAsStream(MAPPER_RESOURCE)) {
            assertNotNull(in);
            Document doc = parseXmlWithoutExternalDtd(in);
            String sql = statementSql(doc, "insert", "copyChangedToLog");
            assertTrue(sql.contains("extend"), sql);
            assertTrue(sql.contains("EXCLUDED.extend") || sql.contains("excluded.extend"), sql);
            assertFalse(BARE_TEXT_COLUMN.matcher(sql).find(), "copyChangedToLog must not reference text: " + sql);
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
}
