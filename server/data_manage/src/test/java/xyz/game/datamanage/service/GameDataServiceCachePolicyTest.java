package xyz.game.datamanage.service;

import static org.mockito.ArgumentMatchers.any;
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
    private Cache wasmCatalogCache;

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
        when(writeStore.upsertHero(anyString(), anyString(), any(ObjectNode.class))).thenReturn(response);
        when(cacheManager.getCache("games")).thenReturn(gamesCache);
        when(cacheManager.getCache("images")).thenReturn(imagesCache);
        when(cacheManager.getCache("ownerCategories")).thenReturn(ownerCategoriesCache);

        service.upsertHero("lol", "hero_ahri", body);

        verify(gamesCache).clear();
        verify(imagesCache).clear();
        verify(ownerCategoriesCache).clear();
        verify(currentVersionCache, never()).clear();
        verify(bundleCache, never()).clear();
    }

    @Test
    void replaceTypeRelationsDoesNotEvictCurrentVersionOrBundle() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.putArray("relations").addObject().put("typeId", 1001);
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        when(writeStore.replaceTypeRelationsForTarget(anyString(), anyString(), anyString(), any(ObjectNode.class))).thenReturn(response);
        when(cacheManager.getCache("games")).thenReturn(gamesCache);
        when(cacheManager.getCache("images")).thenReturn(imagesCache);
        when(cacheManager.getCache("ownerCategories")).thenReturn(ownerCategoriesCache);

        service.replaceTypeRelationsForTarget("lol", "character", "hero_ahri", body);

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
        ObjectNode body = JsonNodeFactory.instance.objectNode().put("versionCode", "1.0.0");
        when(writeStore.publishVersion("lol", body)).thenReturn(response);
        when(cacheManager.getCache("games")).thenReturn(gamesCache);
        when(cacheManager.getCache("currentVersion")).thenReturn(currentVersionCache);
        when(cacheManager.getCache("bundle")).thenReturn(bundleCache);
        when(cacheManager.getCache("wasmCatalog")).thenReturn(wasmCatalogCache);
        when(cacheManager.getCache("images")).thenReturn(imagesCache);
        when(cacheManager.getCache("ownerCategories")).thenReturn(ownerCategoriesCache);

        service.publishVersion("lol", body);

        verify(gamesCache).clear();
        verify(imagesCache).clear();
        verify(ownerCategoriesCache).clear();
        verify(currentVersionCache).clear();
        verify(bundleCache).clear();
        verify(wasmCatalogCache).clear();
    }

    @Test
    void upsertWasmCatalogSourceDoesNotEvictPublicCatalogCache() {
        ObjectNode body = JsonNodeFactory.instance.objectNode().put("schemaVersion", "generic-p0");
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        when(writeStore.upsertWasmCatalogSource(anyString(), any(ObjectNode.class))).thenReturn(response);

        service.upsertWasmCatalogSource("lol", body);

        verify(cacheManager, never()).getCache("wasmCatalog");
        verify(cacheManager, never()).getCache("bundle");
        verify(cacheManager, never()).getCache("currentVersion");
    }

    @Test
    void bootstrapLegacyAdcDoesNotEvictPublicCatalogCache() {
        ObjectNode body = JsonNodeFactory.instance.objectNode().put("sourceVersionCode", "v1");
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        when(writeStore.insertWasmCatalogSourceIfAbsent(anyString(), any(ObjectNode.class))).thenReturn(response);
        when(readStore.getWasmCatalogSource("lol")).thenReturn(null);
        when(readStore.getPublishedBundleSnapshot("lol", "v1")).thenReturn(minimalLegacyBundle());
        when(jsonSupport.requireText(body, "sourceVersionCode", "bootstrap")).thenReturn("v1");

        service.bootstrapLegacyAdcWasmCatalogSource("lol", body);

        verify(cacheManager, never()).getCache("wasmCatalog");
        verify(cacheManager, never()).getCache("bundle");
        verify(cacheManager, never()).getCache("currentVersion");
        verify(writeStore, never()).publishVersion(anyString(), any(ObjectNode.class));
    }

    private ObjectNode minimalLegacyBundle() {
        ObjectNode bundle = JsonNodeFactory.instance.objectNode();
        var heroes = bundle.putArray("heroes");
        for (String heroId : WasmLegacyAdcBootstrapAdapter.HERO_IDS) {
            var hero = heroes.addObject();
            hero.put("heroId", heroId);
            hero.put("name", heroId);
            hero.putObject("baseStats").put("hp", 1).put("ad", 1);
        }
        for (String dummyId : WasmLegacyAdcBootstrapAdapter.DUMMY_IDS) {
            var hero = heroes.addObject();
            hero.put("heroId", dummyId);
            hero.put("name", dummyId);
            hero.putObject("baseStats").put("hp", 1).put("ad", 0);
        }
        bundle.putArray("skills");
        return bundle;
    }
}
