package xyz.game.datamanage.service.combatdata.revision;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.InputStream;
import java.io.StringReader;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;
import xyz.game.datamanage.mapper.GameDataStateMapper;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class GameDataRevisionServiceTest {

    private static final String GAME_ID = "lol";

    @Mock
    private GameDataStateMapper gameDataStateMapper;

    private GameDataRevisionService service;

    @BeforeEach
    void setUp() {
        service = new GameDataRevisionService(gameDataStateMapper);
    }

    @Test
    void nextRevisionLocksThenIncrementsExactlyOnce() {
        when(gameDataStateMapper.lockByGameId(GAME_ID)).thenReturn(stateRow(GAME_ID, 3L, 1L));
        when(gameDataStateMapper.incrementCurrentRevision(eq(GAME_ID), any(Timestamp.class))).thenReturn(4L);

        long revision = service.nextRevision(GAME_ID);

        assertEquals(4L, revision);
        InOrder order = inOrder(gameDataStateMapper);
        order.verify(gameDataStateMapper).lockByGameId(GAME_ID);
        order.verify(gameDataStateMapper).incrementCurrentRevision(eq(GAME_ID), any(Timestamp.class));
        verify(gameDataStateMapper, times(1)).incrementCurrentRevision(eq(GAME_ID), any(Timestamp.class));
        verify(gameDataStateMapper, never()).insertInitialState(any());
    }

    @Test
    void nextRevisionInitializesMissingStateBeforeIncrement() {
        when(gameDataStateMapper.lockByGameId(GAME_ID))
            .thenReturn(null)
            .thenReturn(stateRow(GAME_ID, 0L, 0L));
        when(gameDataStateMapper.insertInitialState(GAME_ID)).thenReturn(1);
        when(gameDataStateMapper.incrementCurrentRevision(eq(GAME_ID), any(Timestamp.class))).thenReturn(1L);

        assertEquals(1L, service.nextRevision(GAME_ID));
        verify(gameDataStateMapper).insertInitialState(GAME_ID);
        verify(gameDataStateMapper, times(2)).lockByGameId(GAME_ID);
        verify(gameDataStateMapper, times(1)).incrementCurrentRevision(eq(GAME_ID), any(Timestamp.class));
    }

    @Test
    void getStateReadsCurrentAndPublishedRevision() {
        when(gameDataStateMapper.findByGameId(GAME_ID)).thenReturn(stateRow(GAME_ID, 9L, 7L));

        GameDataRevisionService.GameDataStateView view = service.getState(GAME_ID);

        assertEquals(GAME_ID, view.gameId());
        assertEquals(9L, view.currentRevision());
        assertEquals(7L, view.publishedRevision());
        assertEquals(9L, service.getCurrentRevision(GAME_ID));
        assertEquals(7L, service.getPublishedRevision(GAME_ID));
    }

    @Test
    void markPublishedRejectsRevisionAboveCurrent() {
        when(gameDataStateMapper.lockByGameId(GAME_ID)).thenReturn(stateRow(GAME_ID, 5L, 2L));

        ApiException ex = assertThrows(ApiException.class, () -> service.markPublished(GAME_ID, 6L));
        assertEquals("invalid_published_revision", ex.getCode());
        verify(gameDataStateMapper, never()).updatePublishedRevision(any(), anyLong(), any());
    }

    @Test
    void gameDataStateMapperXmlIsLoadable() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/mapper/game_data_state/GameDataStateMapper.xml")) {
            assertNotNull(in, "GameDataStateMapper.xml must be on test classpath");
            Document doc = parseXmlWithoutExternalDtd(in);
            assertEquals("mapper", doc.getDocumentElement().getNodeName());
            String namespace = doc.getDocumentElement().getAttribute("namespace");
            assertEquals("xyz.game.datamanage.mapper.GameDataStateMapper", namespace);
            assertTrue(doc.getElementsByTagName("select").getLength() >= 3);
            assertTrue(doc.getElementsByTagName("insert").getLength() >= 1);
            assertTrue(doc.getElementsByTagName("update").getLength() >= 1);
        }
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
        builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
        return builder.parse(in);
    }

    private static Map<String, Object> stateRow(String gameId, long current, long published) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", gameId);
        row.put("currentRevision", current);
        row.put("publishedRevision", published);
        row.put("updatedAt", Timestamp.valueOf("2026-07-12 00:00:00"));
        return row;
    }
}
