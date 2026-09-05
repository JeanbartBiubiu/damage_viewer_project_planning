package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.annotation.Cacheable;

@ExtendWith(MockitoExtension.class)
class GameDataServiceTest {

    @Mock private PostgresReadStore readStore;
    @Mock private PostgresWriteStore writeStore;

    private GameDataService service;

    @BeforeEach
    void setUp() {
        service = new GameDataService(readStore, writeStore);
    }

    @Test
    void listGamesDelegatesWithoutLegacyFields() {
        ArrayNode games = JsonNodeFactory.instance.arrayNode();
        ObjectNode row = games.addObject();
        row.put("gameId", "lol");
        row.put("gameName", "英雄联盟");
        row.putNull("gameImgUrl");
        when(readStore.listGames()).thenReturn(games);

        ArrayNode result = service.listGames();

        assertEquals("lol", result.get(0).get("gameId").asText());
        assertFalse(result.get(0).has("progressionSchema"));
        verify(readStore).listGames();
    }

    @Test
    void serviceDoesNotOwnImagesOrLegacyPublishing() {
        Set<String> names = Arrays.stream(GameDataService.class.getDeclaredMethods())
            .map(Method::getName)
            .collect(Collectors.toSet());
        assertFalse(names.contains("getImages"));
        assertFalse(names.contains("upsertImage"));
        assertFalse(names.contains("getCurrentVersion"));
        assertFalse(names.contains("publishVersion"));
        assertFalse(names.contains("evictReadCaches"));

        Cacheable listGames = method("listGames").getAnnotation(Cacheable.class);
        assertEquals("games", listGames.cacheNames()[0]);
    }

    @Test
    void constructorDoesNotDependOnLegacyPublishService() {
        assertEquals(2, GameDataService.class.getDeclaredConstructors()[0].getParameterCount());
        Class<?>[] params = GameDataService.class.getDeclaredConstructors()[0].getParameterTypes();
        assertEquals(PostgresReadStore.class, params[0]);
        assertEquals(PostgresWriteStore.class, params[1]);
    }

    private static Method method(String name) {
        return Arrays.stream(GameDataService.class.getDeclaredMethods())
            .filter(candidate -> candidate.getName().equals(name))
            .findFirst()
            .orElseThrow();
    }
}
