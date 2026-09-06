package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class PostgresReadStoreTest {

    @Mock private GamesMapper gamesMapper;

    private PostgresReadStore store;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = new ObjectMapper();
        store = new PostgresReadStore(gamesMapper, objectMapper);
    }

    @Test
    void listGamesEmitsFrozenFieldsAndOmitsProgressionSchema() {
        when(gamesMapper.listGames()).thenReturn(List.of(
            Map.of("gameId", "lol", "gameName", "英雄联盟", "gameImgUrl", "https://example/old-lol.png"),
            Map.of("gameId", "dota2", "gameName", "Dota 2", "representativeImageKey", "dota_cover",
                "representativeImageDangling", false)
        ));

        ArrayNode games = store.listGames();

        ObjectNode first = (ObjectNode) games.get(0);
        assertEquals("lol", first.get("gameId").asText());
        assertEquals("英雄联盟", first.get("gameName").asText());
        assertTrue(first.has("representativeImageKey"));
        assertTrue(first.get("representativeImageKey").isNull());
        assertFalse(first.has("gameImgUrl"));
        assertFalse(first.has("progressionSchema"));
        assertEquals(Set.of("gameId", "gameName", "representativeImageKey"), fieldNames(first));

        ObjectNode second = (ObjectNode) games.get(1);
        assertEquals("dota_cover", second.get("representativeImageKey").asText());
        assertEquals(Set.of("gameId", "gameName", "representativeImageKey"), fieldNames(second));
        verify(gamesMapper).listGames();
    }

    @Test
    void danglingImageFailsWithRelationshipLocationInsteadOfEmptyCover() {
        when(gamesMapper.listGames()).thenReturn(List.of(Map.of(
            "gameId", "lol", "gameName", "英雄联盟",
            "representativeImageKey", "missing_cover", "representativeImageDangling", true
        )));

        ApiException exception = assertThrows(ApiException.class, store::listGames);

        assertEquals(HttpStatus.CONFLICT, exception.getStatus());
        assertEquals("409.RELATION_DANGLING", exception.getCode());
        assertEquals(Map.of(
            "gameId", "lol", "sourceType", "GAME", "sourceParentKey", "",
            "sourceKey", "lol", "imageKey", "missing_cover"
        ), exception.getDetails());
    }

    @Test
    void constructorDoesNotDependOnLegacyMappers() {
        Class<?>[] params = PostgresReadStore.class.getDeclaredConstructors()[0].getParameterTypes();
        assertEquals(2, params.length);
        assertEquals(GamesMapper.class, params[0]);
        assertEquals(ObjectMapper.class, params[1]);
    }

    @Test
    void gameExistsUsesCount() {
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        assertTrue(store.gameExists("lol"));
        when(gamesMapper.countGames("missing")).thenReturn(0L);
        assertFalse(store.gameExists("missing"));
    }
    private static Set<String> fieldNames(ObjectNode node) {
        LinkedHashSet<String> names = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
