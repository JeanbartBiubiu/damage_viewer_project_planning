package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.ImagesMapper;

@ExtendWith(MockitoExtension.class)
class PostgresReadStoreTest {

    @Mock private GamesMapper gamesMapper;
    @Mock private ImagesMapper imagesMapper;

    private PostgresReadStore store;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = new ObjectMapper();
        store = new PostgresReadStore(gamesMapper, imagesMapper, objectMapper, new PostgresJsonSupport(objectMapper));
    }

    @Test
    void listGamesEmitsFrozenFieldsAndOmitsProgressionSchema() {
        when(gamesMapper.listGames()).thenReturn(List.of(
            Map.of("gameId", "lol", "gameName", "英雄联盟"),
            Map.of("gameId", "dota2", "gameName", "Dota 2", "gameImgUrl", "https://example/dota.png")
        ));

        ArrayNode games = store.listGames();

        ObjectNode first = (ObjectNode) games.get(0);
        assertEquals("lol", first.get("gameId").asText());
        assertEquals("英雄联盟", first.get("gameName").asText());
        assertTrue(first.has("gameImgUrl"));
        assertTrue(first.get("gameImgUrl").isNull());
        assertFalse(first.has("progressionSchema"));
        assertEquals(Set.of("gameId", "gameName", "gameImgUrl"), fieldNames(first));

        ObjectNode second = (ObjectNode) games.get(1);
        assertEquals("https://example/dota.png", second.get("gameImgUrl").asText());
        verify(gamesMapper).listGames();
    }

    @Test
    void constructorDoesNotDependOnLegacyMappers() {
        Class<?>[] params = PostgresReadStore.class.getDeclaredConstructors()[0].getParameterTypes();
        assertEquals(4, params.length);
        assertEquals(GamesMapper.class, params[0]);
        assertEquals(ImagesMapper.class, params[1]);
        assertEquals(ObjectMapper.class, params[2]);
        assertEquals(PostgresJsonSupport.class, params[3]);
    }

    @Test
    void gameExistsUsesCount() {
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        assertTrue(store.gameExists("lol"));
        when(gamesMapper.countGames("missing")).thenReturn(0L);
        assertFalse(store.gameExists("missing"));
    }

    @Test
    void getImagesMapsStoredRows() {
        when(imagesMapper.listImages("lol")).thenReturn(List.of(
            Map.of("uri", "icon", "imageBase64", "data:image/png;base64,abc")
        ));

        ObjectNode response = store.getImages("lol", null);

        assertEquals("lol", response.get("gameId").asText());
        assertEquals("icon", response.get("images").get(0).get("uri").asText());
        when(imagesMapper.findImageByUri("lol", "missing")).thenReturn(null);
        assertNull(store.loadImage("lol", "missing"));
    }

    private static Set<String> fieldNames(ObjectNode node) {
        LinkedHashSet<String> names = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
