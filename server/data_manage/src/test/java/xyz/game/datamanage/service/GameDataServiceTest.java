package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.Cacheable;

@ExtendWith(MockitoExtension.class)
class GameDataServiceTest {

    @Mock private PostgresReadStore readStore;
    @Mock private PostgresWriteStore writeStore;
    @Mock private CacheManager cacheManager;
    @Mock private Cache imagesCache;

    private GameDataService service;
    private PostgresJsonSupport jsonSupport;

    @BeforeEach
    void setUp() {
        jsonSupport = new PostgresJsonSupport(new ObjectMapper());
        service = new GameDataService(readStore, writeStore, jsonSupport, cacheManager);
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
    void getImagesRequiresExistingGame() {
        when(readStore.gameExists("lol")).thenReturn(true);
        ObjectNode images = JsonNodeFactory.instance.objectNode();
        images.put("gameId", "lol");
        images.putArray("images");
        when(readStore.getImages(eq("lol"), isNull())).thenReturn(images);

        ObjectNode result = service.getImages("lol", null);

        assertEquals("lol", result.get("gameId").asText());
        verify(readStore).getImages("lol", null);
    }

    @Test
    void upsertImageEvictsOnlyImagesCache() {
        when(readStore.gameExists("lol")).thenReturn(true);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("imageBase64", "data:image/png;base64,abc");
        ObjectNode stored = JsonNodeFactory.instance.objectNode();
        stored.put("uri", "icon");
        when(writeStore.upsertImage(eq("lol"), eq("icon"), any())).thenReturn(stored);
        when(cacheManager.getCache("images")).thenReturn(imagesCache);

        ObjectNode result = service.upsertImage("lol", "icon", body);

        assertEquals("icon", result.get("uri").asText());
        verify(imagesCache).clear();
        verify(cacheManager, never()).getCache("currentVersion");
        verify(cacheManager, never()).getCache("games");
    }

    @Test
    void publicApiDoesNotExposeCurrentVersionOrPublish() {
        Set<String> names = Arrays.stream(GameDataService.class.getDeclaredMethods())
            .map(Method::getName)
            .collect(Collectors.toSet());
        assertFalse(names.contains("getCurrentVersion"));
        assertFalse(names.contains("publishVersion"));
        assertFalse(names.contains("evictReadCaches"));

        Cacheable listGames = method("listGames").getAnnotation(Cacheable.class);
        assertEquals("games", listGames.cacheNames()[0]);

        Cacheable getImages = method("getImages").getAnnotation(Cacheable.class);
        assertEquals("images", getImages.cacheNames()[0]);
    }

    @Test
    void constructorDoesNotDependOnLegacyPublishService() {
        assertEquals(4, GameDataService.class.getDeclaredConstructors()[0].getParameterCount());
        Class<?>[] params = GameDataService.class.getDeclaredConstructors()[0].getParameterTypes();
        assertEquals(PostgresReadStore.class, params[0]);
        assertEquals(PostgresWriteStore.class, params[1]);
        assertEquals(PostgresJsonSupport.class, params[2]);
        assertEquals(CacheManager.class, params[3]);
    }

    private static Method method(String name) {
        return Arrays.stream(GameDataService.class.getDeclaredMethods())
            .filter(candidate -> candidate.getName().equals(name))
            .findFirst()
            .orElseThrow();
    }
}
