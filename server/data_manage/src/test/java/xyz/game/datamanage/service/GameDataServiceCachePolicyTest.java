package xyz.game.datamanage.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;

@ExtendWith(MockitoExtension.class)
class GameDataServiceCachePolicyTest {

    @Mock
    private PostgresReadStore readStore;

    @Mock
    private PostgresWriteStore writeStore;

    @Mock
    private PostgresJsonSupport jsonSupport;

    @Mock
    private CacheManager cacheManager;

    @Mock
    private Cache gamesCache;

    @Mock
    private Cache currentVersionCache;

    @Mock
    private Cache bundleCache;

    @Mock
    private Cache imagesCache;

    @Mock
    private Cache ownerCategoriesCache;

    private GameDataService service;

    @BeforeEach
    void setUp() {
        service = new GameDataService(readStore, writeStore, jsonSupport, cacheManager);

        when(readStore.gameExists(anyString())).thenReturn(true);
    }

    @Test
    void upsertHeroDoesNotEvictCurrentVersionOrBundle() {
        ObjectNode body = JsonNodeFactory.instance.objectNode().put("name", "Ahri");
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        when(writeStore.upsertHero(anyString(), anyString(), any(ObjectNode.class), anyBoolean())).thenReturn(response);
        when(cacheManager.getCache("games")).thenReturn(gamesCache);
        when(cacheManager.getCache("images")).thenReturn(imagesCache);
        when(cacheManager.getCache("ownerCategories")).thenReturn(ownerCategoriesCache);

        service.upsertHero("lol", "hero_ahri", body, false);

        verify(gamesCache).clear();
        verify(imagesCache).clear();
        verify(ownerCategoriesCache).clear();
        verify(currentVersionCache, never()).clear();
        verify(bundleCache, never()).clear();
    }

    @Test
    void upsertImageOnlyEvictsImagesCache() {
        ObjectNode body = JsonNodeFactory.instance.objectNode().put("imageBase64", "data:image/png;base64,AAAA");
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        when(writeStore.upsertImage(anyString(), anyString(), any(ObjectNode.class))).thenReturn(response);
        when(cacheManager.getCache("images")).thenReturn(imagesCache);

        service.upsertImage("lol", "hero_ahri", body);

        verify(imagesCache).clear();
        verify(gamesCache, never()).clear();
        verify(ownerCategoriesCache, never()).clear();
        verify(currentVersionCache, never()).clear();
        verify(bundleCache, never()).clear();
    }

    @Test
    void publishEvictsAllReadCaches() {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        when(writeStore.publishVersion("lol", 2L)).thenReturn(response);
        when(cacheManager.getCache("games")).thenReturn(gamesCache);
        when(cacheManager.getCache("currentVersion")).thenReturn(currentVersionCache);
        when(cacheManager.getCache("bundle")).thenReturn(bundleCache);
        when(cacheManager.getCache("images")).thenReturn(imagesCache);
        when(cacheManager.getCache("ownerCategories")).thenReturn(ownerCategoriesCache);

        service.publishVersion("lol", 2L);

        verify(gamesCache).clear();
        verify(imagesCache).clear();
        verify(ownerCategoriesCache).clear();
        verify(currentVersionCache).clear();
        verify(bundleCache).clear();
    }
}
