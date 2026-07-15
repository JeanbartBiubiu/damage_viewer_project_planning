package xyz.game.datamanage.mapper.combatdata;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

class CombatExecuteEffectDetailsMapperXmlTest {

    @Test
    void mapperXmlCoversWorkspaceAndPublishStatements() throws Exception {
        byte[] bytes;
        try (InputStream in = getClass().getResourceAsStream(
            "/mapper/combatdata/execute_effect_details/CombatExecuteEffectDetailsMapper.xml"
        )) {
            assertNotNull(in);
            bytes = in.readAllBytes();
        }
        String xml = new String(bytes, StandardCharsets.UTF_8);
        Document doc = parseXmlWithoutExternalDtd(
            new java.io.ByteArrayInputStream(bytes)
        );

        assertTrue(xml.contains("id=\"list\""));
        assertTrue(xml.contains("id=\"findById\""));
        assertTrue(xml.contains("id=\"upsert\""));
        assertTrue(xml.contains("id=\"deleteByStepId\""));
        assertTrue(xml.contains("id=\"listChangedSince\""));
        assertTrue(xml.contains("id=\"copyChangedToLog\""));
        assertTrue(xml.contains("execute_effect_details"));
        assertTrue(xml.contains("execute_effect_details_log"));
        assertTrue(xml.contains("AS \"stepId\""));
        assertTrue(xml.contains("AS \"threshold\""));
        assertFalse(xml.contains("AS stepId"));
        assertFalse(xml.contains("AS threshold\n") || xml.contains("AS threshold "));

        NodeList inserts = doc.getElementsByTagName("insert");
        boolean foundCopy = false;
        for (int i = 0; i < inserts.getLength(); i++) {
            var element = (org.w3c.dom.Element) inserts.item(i);
            if (!"copyChangedToLog".equals(element.getAttribute("id"))) {
                continue;
            }
            foundCopy = true;
            String sql = element.getTextContent();
            assertTrue(
                sql.contains("change_revision > #{previousRevision}")
                    || sql.contains("change_revision &gt; #{previousRevision}")
            );
            assertTrue(
                sql.contains("change_revision <= #{publishRevision}")
                    || sql.contains("change_revision &lt;= #{publishRevision}")
            );
            assertTrue(sql.contains("ON CONFLICT"));
        }
        assertTrue(foundCopy, "copyChangedToLog insert must exist");
    }

    private static Document parseXmlWithoutExternalDtd(InputStream in) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setValidating(false);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setExpandEntityReferences(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
        return builder.parse(in);
    }
}
