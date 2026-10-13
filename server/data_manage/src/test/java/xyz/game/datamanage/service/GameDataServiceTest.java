package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.CacheManager;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;

@ExtendWith(MockitoExtension.class)
class GameDataServiceTest {

    @Mock private PostgresReadStore readStore;
    @Mock private PostgresWriteStore writeStore;

    @Test
    void oldCachedGameUrlsCannotBypassTheNewPublicResponse() {
        ArrayNode legacy = JsonNodeFactory.instance.arrayNode();
        legacy.addObject().put("gameId", "lol").put("gameName", "英雄联盟")
            .put("gameImgUrl", "https://example/old-cover.png");
        ArrayNode current = JsonNodeFactory.instance.arrayNode();
        current.addObject().put("gameId", "lol").put("gameName", "英雄联盟")
            .put("representativeImageKey", "lol_cover");
        when(readStore.listGames()).thenReturn(current);

        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.registerBean(PostgresReadStore.class, () -> readStore);
            context.registerBean(PostgresWriteStore.class, () -> writeStore);
            context.register(CacheConfiguration.class, GameDataService.class);
            context.refresh();
            var cache = context.getBean(CacheManager.class).getCache("games");
            cache.put("all", legacy);
            GameDataService cachedService = context.getBean(GameDataService.class);

            ArrayNode first = cachedService.listGames();
            ArrayNode second = cachedService.listGames();

            assertEquals("lol_cover", first.get(0).get("representativeImageKey").asText());
            assertFalse(first.get(0).has("gameImgUrl"));
            assertSame(first, second);
            assertSame(current, cache.get("all:stage9").get());
            assertSame(legacy, cache.get("all").get());
            assertEquals("https://example/old-cover.png", legacy.get(0).get("gameImgUrl").asText());
            verify(readStore, times(1)).listGames();
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    @EnableCaching
    static class CacheConfiguration {
        @Bean
        CacheManager cacheManager() {
            return new ConcurrentMapCacheManager("games");
        }
    }
}
