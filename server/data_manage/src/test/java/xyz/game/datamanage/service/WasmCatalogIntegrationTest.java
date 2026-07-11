package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.CacheManager;
import xyz.game.datamanage.mapper.AttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.CoefficientBucketsMapper;
import xyz.game.datamanage.mapper.ControlStateProfilesMapper;
import xyz.game.datamanage.mapper.EditLogMapper;
import xyz.game.datamanage.mapper.FormulaBindingsMapper;
import xyz.game.datamanage.mapper.FormulaProfilesMapper;
import xyz.game.datamanage.mapper.GameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.HeroesMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.ItemStatModifiersMapper;
import xyz.game.datamanage.mapper.ItemsMapper;
import xyz.game.datamanage.mapper.OwnerCategoriesMapper;
import xyz.game.datamanage.mapper.PublishedBundleSnapshotsMapper;
import xyz.game.datamanage.mapper.PublishedWasmCatalogSnapshotsMapper;
import xyz.game.datamanage.mapper.SkillMountsMapper;
import xyz.game.datamanage.mapper.SkillsMapper;
import xyz.game.datamanage.mapper.StatusActionControlRulesMapper;
import xyz.game.datamanage.mapper.StatusAttributeModifiersMapper;
import xyz.game.datamanage.mapper.StatusDefinitionsMapper;
import xyz.game.datamanage.mapper.StatusModifierGroupsMapper;
import xyz.game.datamanage.mapper.StatusPeriodicHpEffectsMapper;
import xyz.game.datamanage.mapper.TypeRelationsMapper;
import xyz.game.datamanage.mapper.TypesMapper;
import xyz.game.datamanage.mapper.WasmCatalogSourcesMapper;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class WasmCatalogIntegrationTest {

    @Mock private HeroesMapper heroesMapper;
    @Mock private SkillsMapper skillsMapper;
    @Mock private SkillMountsMapper skillMountsMapper;
    @Mock private DefaultBasicAttackProvisioner defaultBasicAttackProvisioner;
    @Mock private ItemsMapper itemsMapper;
    @Mock private ItemStatModifiersMapper itemStatModifiersMapper;
    @Mock private FormulaProfilesMapper formulaProfilesMapper;
    @Mock private FormulaBindingsMapper formulaBindingsMapper;
    @Mock private CoefficientBucketsMapper coefficientBucketsMapper;
    @Mock private StatusActionControlRulesMapper statusActionControlRulesMapper;
    @Mock private StatusDefinitionsMapper statusDefinitionsMapper;
    @Mock private StatusModifierGroupsMapper statusModifierGroupsMapper;
    @Mock private StatusAttributeModifiersMapper statusAttributeModifiersMapper;
    @Mock private StatusPeriodicHpEffectsMapper statusPeriodicHpEffectsMapper;
    @Mock private ControlStateProfilesMapper controlStateProfilesMapper;
    @Mock private AttributeDefinitionsMapper attributeDefinitionsMapper;
    @Mock private TypesMapper typesMapper;
    @Mock private TypeRelationsMapper typeRelationsMapper;
    @Mock private ImagesMapper imagesMapper;
    @Mock private OwnerCategoriesMapper ownerCategoriesMapper;
    @Mock private PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper;
    @Mock private PublishedWasmCatalogSnapshotsMapper publishedWasmCatalogSnapshotsMapper;
    @Mock private WasmCatalogSourcesMapper wasmCatalogSourcesMapper;
    @Mock private GamesMapper gamesMapper;
    @Mock private GameProgressionSchemaMapper gameProgressionSchemaMapper;
    @Mock private GameVersionsMapper gameVersionsMapper;
    @Mock private EditLogMapper editLogMapper;
    @Mock private PostgresReadStore readStore;
    @Mock private CacheManager cacheManager;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private PostgresWriteStore writeStore;
    private GameDataService gameDataService;
    private PostgresJsonSupport jsonSupport;

    @BeforeEach
    void setUp() {
        jsonSupport = new PostgresJsonSupport(objectMapper);
        writeStore = new PostgresWriteStore(
            heroesMapper,
            skillsMapper,
            skillMountsMapper,
            defaultBasicAttackProvisioner,
            itemsMapper,
            itemStatModifiersMapper,
            formulaProfilesMapper,
            formulaBindingsMapper,
            statusActionControlRulesMapper,
            statusDefinitionsMapper,
            statusModifierGroupsMapper,
            statusAttributeModifiersMapper,
            statusPeriodicHpEffectsMapper,
            controlStateProfilesMapper,
            coefficientBucketsMapper,
            attributeDefinitionsMapper,
            typesMapper,
            typeRelationsMapper,
            imagesMapper,
            ownerCategoriesMapper,
            publishedBundleSnapshotsMapper,
            publishedWasmCatalogSnapshotsMapper,
            wasmCatalogSourcesMapper,
            gamesMapper,
            gameProgressionSchemaMapper,
            gameVersionsMapper,
            editLogMapper,
            objectMapper,
            readStore,
            jsonSupport,
            new WasmCatalogValidator()
        );
        gameDataService = new GameDataService(readStore, writeStore, jsonSupport, cacheManager);
    }

    @Test
    void upsertSourcePersistsBodyWithoutSchemaVersionAndReconstructsResponse() throws Exception {
        when(readStore.gameExists("lol")).thenReturn(true);
        when(readStore.findVersionByCode("lol", "__workspace__"))
            .thenReturn(new PostgresReadStore.VersionRecord(9L, "__workspace__", null, Instant.now(), null));
        ObjectNode body = minimalValidSource();
        ObjectNode reconstructed = body.deepCopy();
        reconstructed.put("updatedAt", "2026-07-11T00:00:00Z");
        when(readStore.getWasmCatalogSource("lol")).thenReturn(reconstructed);

        ObjectNode response = gameDataService.upsertWasmCatalogSource("lol", body);

        ArgumentCaptor<String> jsonCaptor = ArgumentCaptor.forClass(String.class);
        verify(wasmCatalogSourcesMapper).upsertSource(eq("lol"), eq(9L), eq("generic-p0"), jsonCaptor.capture());
        ObjectNode storedBody = (ObjectNode) objectMapper.readTree(jsonCaptor.getValue());
        assertTrue(!storedBody.has("schemaVersion"));
        assertTrue(!storedBody.has("meta"));
        assertTrue(!storedBody.has("updatedAt"));
        assertTrue(storedBody.has("typeCatalog"));
        assertEquals("generic-p0", response.path("schemaVersion").asText());
        assertEquals("2026-07-11T00:00:00Z", response.path("updatedAt").asText());
        verify(cacheManager, never()).getCache("wasmCatalog");
        verify(cacheManager, never()).getCache("bundle");
        verify(publishedWasmCatalogSnapshotsMapper, never())
            .upsertCatalogSnapshot(anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void invalidSemanticSourceReturns422AndDoesNotSave() throws Exception {
        when(readStore.gameExists("lol")).thenReturn(true);
        ObjectNode body = minimalValidSource();
        ((ObjectNode) body.path("combatantTemplates").get(0).path("providers").get(0))
            .put("definitionRef", "missing");

        ApiException ex = assertThrows(
            ApiException.class,
            () -> gameDataService.upsertWasmCatalogSource("lol", body)
        );
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
        verify(wasmCatalogSourcesMapper, never()).upsertSource(anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    void invalidBodyShapeReturns400AndDoesNotSave() throws Exception {
        when(readStore.gameExists("lol")).thenReturn(true);
        ObjectNode body = minimalValidSource();
        body.putObject("meta").put("gameId", "lol");

        ApiException ex = assertThrows(
            ApiException.class,
            () -> gameDataService.upsertWasmCatalogSource("lol", body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(wasmCatalogSourcesMapper, never()).upsertSource(anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    void getWasmCatalogSourceReturns404WhenAbsent() {
        when(readStore.gameExists("lol")).thenReturn(true);
        when(readStore.getWasmCatalogSource("lol")).thenReturn(null);

        ApiException ex = assertThrows(ApiException.class, () -> gameDataService.getWasmCatalogSource("lol"));
        assertEquals("404.NOT_FOUND", ex.getCode());
    }

    @Test
    void publicReadIsSnapshotOnlyAndNotFoundWhenAbsent() {
        when(readStore.gameExists("lol")).thenReturn(true);
        when(readStore.getPublishedWasmCatalogSnapshot("lol", "14.1")).thenReturn(null);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> gameDataService.getWasmCatalog("lol", "14.1")
        );
        assertEquals("404.NOT_FOUND", ex.getCode());
        verify(readStore).getPublishedWasmCatalogSnapshot("lol", "14.1");
        verify(readStore, never()).getWasmCatalogSource(anyString());
    }

    @Test
    void publicReadReturnsPublishedSnapshotOnly() {
        when(readStore.gameExists("lol")).thenReturn(true);
        ObjectNode snapshot = JsonNodeFactory.instance.objectNode();
        ObjectNode meta = snapshot.putObject("meta");
        meta.put("gameId", "lol");
        meta.put("versionCode", "14.1");
        meta.put("schemaVersion", "generic-p0");
        meta.put("schemaHash", WasmCatalogCanonicalHash.schemaHash());
        meta.put("rulesHash", "sha256:abc");
        when(readStore.getPublishedWasmCatalogSnapshot("lol", "14.1")).thenReturn(snapshot);

        ObjectNode response = gameDataService.getWasmCatalog("lol", "14.1");

        assertEquals("lol", response.path("meta").path("gameId").asText());
        assertEquals("14.1", response.path("meta").path("versionCode").asText());
        verify(readStore).getPublishedWasmCatalogSnapshot("lol", "14.1");
        verify(readStore, never()).getWasmCatalogSource(anyString());
        verify(readStore, never()).findWasmCatalogSourceRow(anyString());
    }

    @Test
    void publishWithChangedSourceWritesSnapshotAndSourceLogUsingSamePublishedAt() throws Exception {
        PostgresReadStore.VersionRecord targetVersion = publishTargetVersion("14.5", 3L);
        stubLegacyPublishHappyPath(targetVersion);
        ObjectNode sourceRoot = minimalValidSource();
        ObjectNode catalogBody = sourceRoot.deepCopy();
        catalogBody.remove("schemaVersion");
        String bodyJson = objectMapper.writeValueAsString(catalogBody);
        when(wasmCatalogSourcesMapper.findByGameId("lol")).thenReturn(sourceRow("generic-p0", bodyJson));
        when(wasmCatalogSourcesMapper.listChangedSince(eq("lol"), any(Timestamp.class)))
            .thenReturn(List.of(sourceRow("generic-p0", bodyJson)));
        when(wasmCatalogSourcesMapper.updateVersionRange("lol", 3L)).thenReturn(1);

        ObjectNode request = JsonNodeFactory.instance.objectNode();
        request.put("versionCode", "14.5");
        ObjectNode response = writeStore.publishVersion("lol", request);
        String publishedAt = response.path("publishedAt").asText();
        assertFalse(publishedAt.isBlank());

        ArgumentCaptor<String> snapshotCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> schemaHashCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> rulesHashCaptor = ArgumentCaptor.forClass(String.class);
        verify(publishedWasmCatalogSnapshotsMapper).upsertCatalogSnapshot(
            eq("lol"),
            eq(3L),
            eq("14.5"),
            eq("generic-p0"),
            schemaHashCaptor.capture(),
            rulesHashCaptor.capture(),
            snapshotCaptor.capture()
        );
        assertEquals(WasmCatalogCanonicalHash.schemaHash(), schemaHashCaptor.getValue());
        ObjectNode expectedHashPayload = WasmCatalogCanonicalHash.buildHashPayload("generic-p0", catalogBody);
        assertEquals(WasmCatalogCanonicalHash.rulesHash(expectedHashPayload), rulesHashCaptor.getValue());
        assertTrue(schemaHashCaptor.getValue().startsWith("sha256:"));
        assertTrue(rulesHashCaptor.getValue().startsWith("sha256:"));

        ObjectNode snapshot = (ObjectNode) objectMapper.readTree(snapshotCaptor.getValue());
        assertEquals("lol", snapshot.path("meta").path("gameId").asText());
        assertEquals("14.5", snapshot.path("meta").path("versionCode").asText());
        assertEquals(publishedAt, snapshot.path("meta").path("publishedAt").asText());
        assertEquals(publishedAt, snapshot.path("meta").path("generatedAt").asText());
        assertEquals("generic-p0", snapshot.path("meta").path("schemaVersion").asText());
        assertEquals(schemaHashCaptor.getValue(), snapshot.path("meta").path("schemaHash").asText());
        assertEquals(rulesHashCaptor.getValue(), snapshot.path("meta").path("rulesHash").asText());
        assertFalse(snapshot.has("schemaVersion"));
        assertTrue(snapshot.has("typeCatalog"));
        assertTrue(snapshot.has("combatantTemplates"));

        ArgumentCaptor<Timestamp> markCaptor = ArgumentCaptor.forClass(Timestamp.class);
        verify(gameVersionsMapper).markVersionCurrent(markCaptor.capture(), eq("lol"), eq(3L));
        assertEquals(publishedAt, markCaptor.getValue().toInstant().toString());

        verify(wasmCatalogSourcesMapper).updateVersionRange("lol", 3L);
        verify(wasmCatalogSourcesMapper).upsertSourceLog(eq("lol"), eq(3L), eq("generic-p0"), anyString());
        verify(publishedBundleSnapshotsMapper).upsertBundleSnapshot(eq("lol"), eq(3L), eq("14.5"), anyString());
    }

    @Test
    void publishWithUnchangedSourceWritesSnapshotButSkipsSourceRangeAndLog() throws Exception {
        PostgresReadStore.VersionRecord targetVersion = publishTargetVersion("14.5", 3L);
        stubLegacyPublishHappyPath(targetVersion);
        ObjectNode sourceRoot = minimalValidSource();
        ObjectNode catalogBody = sourceRoot.deepCopy();
        catalogBody.remove("schemaVersion");
        String bodyJson = objectMapper.writeValueAsString(catalogBody);
        when(wasmCatalogSourcesMapper.findByGameId("lol")).thenReturn(sourceRow("generic-p0", bodyJson));
        when(wasmCatalogSourcesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());

        writeStore.publishVersion("lol", JsonNodeFactory.instance.objectNode().put("versionCode", "14.5"));

        verify(publishedWasmCatalogSnapshotsMapper).upsertCatalogSnapshot(
            eq("lol"), eq(3L), eq("14.5"), eq("generic-p0"), anyString(), anyString(), anyString()
        );
        verify(wasmCatalogSourcesMapper, never()).updateVersionRange(anyString(), anyLong());
        verify(wasmCatalogSourcesMapper, never()).upsertSourceLog(anyString(), anyLong(), anyString(), anyString());
        verify(publishedBundleSnapshotsMapper).upsertBundleSnapshot(eq("lol"), eq(3L), eq("14.5"), anyString());
    }

    @Test
    void publishWithNullChangedListStillWritesSnapshotAndSkipsSourceLog() throws Exception {
        PostgresReadStore.VersionRecord targetVersion = publishTargetVersion("14.5", 3L);
        stubLegacyPublishHappyPath(targetVersion);
        ObjectNode sourceRoot = minimalValidSource();
        ObjectNode catalogBody = sourceRoot.deepCopy();
        catalogBody.remove("schemaVersion");
        String bodyJson = objectMapper.writeValueAsString(catalogBody);
        when(wasmCatalogSourcesMapper.findByGameId("lol")).thenReturn(sourceRow("generic-p0", bodyJson));
        when(wasmCatalogSourcesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(null);

        writeStore.publishVersion("lol", JsonNodeFactory.instance.objectNode().put("versionCode", "14.5"));

        verify(publishedWasmCatalogSnapshotsMapper).upsertCatalogSnapshot(
            eq("lol"), eq(3L), eq("14.5"), eq("generic-p0"), anyString(), anyString(), anyString()
        );
        verify(wasmCatalogSourcesMapper, never()).updateVersionRange(anyString(), anyLong());
        verify(wasmCatalogSourcesMapper, never()).upsertSourceLog(anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    void publishWithoutSourceWritesLegacyBundleOnly() {
        PostgresReadStore.VersionRecord targetVersion = publishTargetVersion("14.5", 3L);
        stubLegacyPublishHappyPath(targetVersion);
        when(wasmCatalogSourcesMapper.findByGameId("lol")).thenReturn(null);

        writeStore.publishVersion("lol", JsonNodeFactory.instance.objectNode().put("versionCode", "14.5"));

        verify(publishedBundleSnapshotsMapper).upsertBundleSnapshot(eq("lol"), eq(3L), eq("14.5"), anyString());
        verify(publishedWasmCatalogSnapshotsMapper, never())
            .upsertCatalogSnapshot(anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyString());
        verify(wasmCatalogSourcesMapper, never()).upsertSourceLog(anyString(), anyLong(), anyString(), anyString());
        verify(wasmCatalogSourcesMapper, never()).updateVersionRange(anyString(), anyLong());
        verify(wasmCatalogSourcesMapper, never()).listChangedSince(anyString(), any());
        verify(gameVersionsMapper).markVersionCurrent(any(Timestamp.class), eq("lol"), eq(3L));
    }

    @Test
    void publishWithInvalidPersistedSourceAbortsBeforeLegacySnapshotAndCurrentPointer() throws Exception {
        PostgresReadStore.VersionRecord targetVersion = publishTargetVersion("14.5", 3L);
        stubLegacyPublishUpToBundleValidation(targetVersion);
        ObjectNode invalidBody = minimalValidSource();
        invalidBody.remove("schemaVersion");
        ((ObjectNode) invalidBody.path("combatantTemplates").get(0).path("providers").get(0))
            .put("definitionRef", "missing_provider");
        when(wasmCatalogSourcesMapper.findByGameId("lol"))
            .thenReturn(sourceRow("generic-p0", objectMapper.writeValueAsString(invalidBody)));

        ApiException ex = assertThrows(
            ApiException.class,
            () -> writeStore.publishVersion("lol", JsonNodeFactory.instance.objectNode().put("versionCode", "14.5"))
        );
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());

        verify(publishedWasmCatalogSnapshotsMapper, never())
            .upsertCatalogSnapshot(anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyString());
        verify(publishedBundleSnapshotsMapper, never())
            .upsertBundleSnapshot(anyString(), anyLong(), anyString(), anyString());
        verify(gameVersionsMapper, never()).clearCurrentVersion(anyString());
        verify(gameVersionsMapper, never()).markVersionCurrent(any(), anyString(), anyLong());
        verify(wasmCatalogSourcesMapper, never()).upsertSourceLog(anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    void publishWithEmptyPersistedSourceAbortsBeforeLegacyAndWasmSnapshots() {
        PostgresReadStore.VersionRecord targetVersion = publishTargetVersion("14.5", 3L);
        stubLegacyPublishUpToBundleValidation(targetVersion);
        when(wasmCatalogSourcesMapper.findByGameId("lol"))
            .thenReturn(sourceRow("generic-p0", "{}"));

        ApiException ex = assertThrows(
            ApiException.class,
            () -> writeStore.publishVersion("lol", JsonNodeFactory.instance.objectNode().put("versionCode", "14.5"))
        );
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());

        verify(publishedWasmCatalogSnapshotsMapper, never())
            .upsertCatalogSnapshot(anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyString());
        verify(publishedBundleSnapshotsMapper, never())
            .upsertBundleSnapshot(anyString(), anyLong(), anyString(), anyString());
        verify(gameVersionsMapper, never()).clearCurrentVersion(anyString());
        verify(gameVersionsMapper, never()).markVersionCurrent(any(), anyString(), anyLong());
        verify(wasmCatalogSourcesMapper, never()).upsertSourceLog(anyString(), anyLong(), anyString(), anyString());
        verify(wasmCatalogSourcesMapper, never()).updateVersionRange(anyString(), anyLong());
        verify(wasmCatalogSourcesMapper, never()).listChangedSince(anyString(), any());
    }

    private void stubLegacyPublishHappyPath(PostgresReadStore.VersionRecord targetVersion) {
        stubLegacyPublishUpToBundleValidation(targetVersion);
        when(gameVersionsMapper.markVersionCurrent(any(), eq("lol"), eq(targetVersion.versionId()))).thenReturn(1);
    }

    private void stubLegacyPublishUpToBundleValidation(PostgresReadStore.VersionRecord targetVersion) {
        PostgresReadStore.VersionRecord currentVersion = new PostgresReadStore.VersionRecord(
            1L,
            "14.1",
            null,
            Instant.parse("2026-07-10T01:00:00Z"),
            Instant.parse("2026-07-10T01:00:00Z")
        );
        when(readStore.findVersionByCode("lol", targetVersion.versionCode())).thenReturn(null);
        when(gameVersionsMapper.createVersion(eq("lol"), eq(targetVersion.versionCode()), any()))
            .thenReturn(targetVersion.versionId());
        when(readStore.findVersionById("lol", targetVersion.versionId())).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(currentVersion);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), any(Instant.class)))
            .thenReturn(emptyBundle("lol", targetVersion));
        when(attributeDefinitionsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(typesMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(heroesMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(skillsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(itemsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(itemStatModifiersMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(statusDefinitionsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(controlStateProfilesMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(statusModifierGroupsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(statusAttributeModifiersMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(statusPeriodicHpEffectsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
        when(skillMountsMapper.listChangedSince(anyString(), any())).thenReturn(List.of());
    }

    private PostgresReadStore.VersionRecord publishTargetVersion(String versionCode, long versionId) {
        return new PostgresReadStore.VersionRecord(
            versionId,
            versionCode,
            null,
            Instant.parse("2026-07-11T01:00:00Z"),
            null
        );
    }

    private Map<String, Object> sourceRow(String schemaVersion, String catalogJson) {
        Map<String, Object> row = new HashMap<>();
        row.put("schemaVersion", schemaVersion);
        row.put("catalogJson", catalogJson);
        row.put("updatedAt", Timestamp.from(Instant.parse("2026-07-11T00:30:00Z")));
        return row;
    }

    private ObjectNode emptyBundle(String gameId, PostgresReadStore.VersionRecord version) {
        ObjectNode bundle = JsonNodeFactory.instance.objectNode();
        ObjectNode meta = bundle.putObject("meta");
        meta.put("gameId", gameId);
        meta.put("versionCode", version.versionCode());
        meta.put("generatedAt", Instant.now().toString());
        bundle.putArray("attributeDefinitions");
        bundle.putArray("types");
        bundle.putArray("typeRelations");
        bundle.putArray("heroes");
        bundle.putArray("skills");
        bundle.putArray("skillMounts");
        bundle.putArray("items");
        bundle.putArray("formulaProfiles");
        bundle.putArray("formulaBindings");
        bundle.putArray("coefficientBuckets");
        bundle.putArray("statusActionControlRules");
        bundle.putArray("statusDefinitions");
        bundle.putArray("controlStateProfiles");
        bundle.putArray("statusModifierGroups");
        bundle.putArray("statusAttributeModifiers");
        bundle.putArray("statusPeriodicHpEffects");
        return bundle;
    }

    private ObjectNode minimalValidSource() throws Exception {
        return (ObjectNode) objectMapper.readTree("""
            {
              "schemaVersion": "generic-p0",
              "typeCatalog": {
                "types": [{"key": "role/assassin", "domain": "role"}],
                "relations": []
              },
              "combatantTemplates": [
                {
                  "templateKey": "champion:ahri",
                  "attributes": {
                    "ad": {"base": 50, "current": 50, "max": 50, "resolved": 50}
                  },
                  "resources": {
                    "mana": {"current": 100, "max": 100}
                  },
                  "providers": [
                    {"providerRef": "skill:ahri_q", "definitionRef": "provider_ahri_q"}
                  ]
                }
              ],
              "sharedProviders": [{"providerKey": "provider_ahri_q"}],
              "rules": {
                "operations": [],
                "modifiers": [],
                "listeners": [],
                "triggerRules": []
              },
              "formulas": [],
              "settings": {}
            }
            """);
    }

    @Test
    void bootstrapLegacyAdcInsertsSourceWithoutPublishOrCacheEviction() throws Exception {
        when(readStore.gameExists("lol")).thenReturn(true);
        when(readStore.getWasmCatalogSource("lol")).thenReturn(null, null, storedBootstrapSource());
        when(readStore.getPublishedBundleSnapshot("lol", "v2_batch_b_hero_passives_002"))
            .thenReturn(legacyBootstrapBundle());
        when(readStore.findVersionByCode("lol", "__workspace__"))
            .thenReturn(new PostgresReadStore.VersionRecord(9L, "__workspace__", null, Instant.now(), null));
        when(wasmCatalogSourcesMapper.insertSourceIfAbsent(eq("lol"), eq(9L), eq("generic-p0"), anyString()))
            .thenReturn(1);

        ObjectNode body = JsonNodeFactory.instance.objectNode().put("sourceVersionCode", "v2_batch_b_hero_passives_002");
        ObjectNode response = gameDataService.bootstrapLegacyAdcWasmCatalogSource("lol", body);

        assertEquals(9, response.path("source").path("combatantTemplates").size());
        assertEquals("v2_batch_b_hero_passives_002", response.path("importReport").path("sourceVersionCode").asText());
        assertTrue(response.path("importReport").path("unmappedLegacySkillIds").isArray());
        assertFalse(response.path("source").has("unmappedLegacySkillIds"));
        assertFalse(response.path("source").has("importReport"));

        ArgumentCaptor<String> jsonCaptor = ArgumentCaptor.forClass(String.class);
        verify(wasmCatalogSourcesMapper).insertSourceIfAbsent(eq("lol"), eq(9L), eq("generic-p0"), jsonCaptor.capture());
        ObjectNode storedBody = (ObjectNode) objectMapper.readTree(jsonCaptor.getValue());
        assertEquals(0, storedBody.path("sharedProviders").size());
        assertEquals(0, storedBody.path("formulas").size());
        assertFalse(storedBody.toString().contains("mechanicsConfig"));
        verify(wasmCatalogSourcesMapper, never()).upsertSource(anyString(), anyLong(), anyString(), anyString());
        verify(publishedWasmCatalogSnapshotsMapper, never())
            .upsertCatalogSnapshot(anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyString());
        verify(cacheManager, never()).getCache("wasmCatalog");
        verify(cacheManager, never()).getCache("bundle");
        verify(cacheManager, never()).getCache("currentVersion");
    }

    @Test
    void bootstrapLegacyAdcReturns404WhenSelectedSnapshotAbsent() {
        when(readStore.gameExists("lol")).thenReturn(true);
        when(readStore.getWasmCatalogSource("lol")).thenReturn(null);
        when(readStore.getPublishedBundleSnapshot("lol", "missing")).thenReturn(null);

        ObjectNode body = JsonNodeFactory.instance.objectNode().put("sourceVersionCode", "missing");
        ApiException ex = assertThrows(
            ApiException.class,
            () -> gameDataService.bootstrapLegacyAdcWasmCatalogSource("lol", body)
        );
        assertEquals("404.NOT_FOUND", ex.getCode());
        verify(wasmCatalogSourcesMapper, never()).insertSourceIfAbsent(anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    void bootstrapLegacyAdcReturns422ForNonLolGame() {
        when(readStore.gameExists("other")).thenReturn(true);

        ObjectNode body = JsonNodeFactory.instance.objectNode().put("sourceVersionCode", "v1");
        ApiException ex = assertThrows(
            ApiException.class,
            () -> gameDataService.bootstrapLegacyAdcWasmCatalogSource("other", body)
        );
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
        verify(readStore, never()).getPublishedBundleSnapshot(anyString(), anyString());
        verify(wasmCatalogSourcesMapper, never()).insertSourceIfAbsent(anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    void bootstrapLegacyAdcReturns409WhenSourceAlreadyExistsWithoutOverwrite() {
        when(readStore.gameExists("lol")).thenReturn(true);
        when(readStore.getWasmCatalogSource("lol")).thenReturn(storedBootstrapSource());

        ObjectNode body = JsonNodeFactory.instance.objectNode().put("sourceVersionCode", "v2_batch_b_hero_passives_002");
        ApiException ex = assertThrows(
            ApiException.class,
            () -> gameDataService.bootstrapLegacyAdcWasmCatalogSource("lol", body)
        );
        assertEquals("409.CONFLICT", ex.getCode());
        verify(wasmCatalogSourcesMapper, never()).insertSourceIfAbsent(anyString(), anyLong(), anyString(), anyString());
        verify(wasmCatalogSourcesMapper, never()).upsertSource(anyString(), anyLong(), anyString(), anyString());
        verify(readStore, never()).getPublishedBundleSnapshot(anyString(), anyString());
    }

    @Test
    void bootstrapLegacyAdcConcurrentInsertReturns409FromAffectedRows() throws Exception {
        when(readStore.gameExists("lol")).thenReturn(true);
        when(readStore.getWasmCatalogSource("lol")).thenReturn(null);
        when(readStore.getPublishedBundleSnapshot("lol", "v2_batch_b_hero_passives_002"))
            .thenReturn(legacyBootstrapBundle());
        when(readStore.findVersionByCode("lol", "__workspace__"))
            .thenReturn(new PostgresReadStore.VersionRecord(9L, "__workspace__", null, Instant.now(), null));
        when(wasmCatalogSourcesMapper.insertSourceIfAbsent(eq("lol"), eq(9L), eq("generic-p0"), anyString()))
            .thenReturn(0);

        ObjectNode body = JsonNodeFactory.instance.objectNode().put("sourceVersionCode", "v2_batch_b_hero_passives_002");
        ApiException ex = assertThrows(
            ApiException.class,
            () -> gameDataService.bootstrapLegacyAdcWasmCatalogSource("lol", body)
        );
        assertEquals("409.CONFLICT", ex.getCode());
        verify(wasmCatalogSourcesMapper).insertSourceIfAbsent(eq("lol"), eq(9L), eq("generic-p0"), anyString());
        verify(wasmCatalogSourcesMapper, never()).upsertSource(anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    void bootstrapLegacyAdcReturns422WhenSelectedEntitiesInvalid() throws Exception {
        when(readStore.gameExists("lol")).thenReturn(true);
        when(readStore.getWasmCatalogSource("lol")).thenReturn(null);
        ObjectNode incomplete = legacyBootstrapBundle();
        ArrayNode heroes = (ArrayNode) incomplete.get("heroes");
        for (int i = heroes.size() - 1; i >= 0; i--) {
            if ("hero_vayne".equals(heroes.get(i).path("heroId").asText())) {
                heroes.remove(i);
            }
        }
        when(readStore.getPublishedBundleSnapshot("lol", "v2_batch_b_hero_passives_002")).thenReturn(incomplete);

        ObjectNode body = JsonNodeFactory.instance.objectNode().put("sourceVersionCode", "v2_batch_b_hero_passives_002");
        ApiException ex = assertThrows(
            ApiException.class,
            () -> gameDataService.bootstrapLegacyAdcWasmCatalogSource("lol", body)
        );
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
        verify(wasmCatalogSourcesMapper, never()).insertSourceIfAbsent(anyString(), anyLong(), anyString(), anyString());
    }

    private ObjectNode storedBootstrapSource() {
        ObjectNode source = JsonNodeFactory.instance.objectNode();
        source.put("schemaVersion", "generic-p0");
        ObjectNode typeCatalog = source.putObject("typeCatalog");
        ArrayNode types = typeCatalog.putArray("types");
        types.addObject().put("key", "role/marksman").put("domain", "role");
        types.addObject().put("key", "role/training_dummy").put("domain", "role");
        typeCatalog.putArray("relations");
        ArrayNode templates = source.putArray("combatantTemplates");
        for (String key : List.of(
            "champion:vayne", "champion:teemo", "champion:varus", "champion:kaisa",
            "champion:twitch", "champion:kogmaw",
            "training_dummy:squishy", "training_dummy:fighter", "training_dummy:tank"
        )) {
            ObjectNode template = templates.addObject();
            template.put("templateKey", key);
            template.putObject("attributes").putObject("hp")
                .put("base", 1).put("current", 1).put("max", 1).put("resolved", 1);
            template.putObject("resources");
            template.putArray("providers");
        }
        source.putArray("sharedProviders");
        ObjectNode rules = source.putObject("rules");
        rules.putArray("operations");
        rules.putArray("modifiers");
        rules.putArray("listeners");
        rules.putArray("triggerRules");
        source.putArray("formulas");
        source.putObject("settings");
        source.put("updatedAt", "2026-07-11T00:00:00Z");
        return source;
    }

    private ObjectNode legacyBootstrapBundle() {
        return buildLegacyInputBundle();
    }

    private ObjectNode buildLegacyInputBundle() {
        ObjectNode bundle = JsonNodeFactory.instance.objectNode();
        ArrayNode heroes = bundle.putArray("heroes");
        for (String heroId : WasmLegacyAdcBootstrapAdapter.HERO_IDS) {
            ObjectNode hero = heroes.addObject();
            hero.put("heroId", heroId);
            hero.put("name", heroId);
            ObjectNode baseStats = hero.putObject("baseStats");
            baseStats.put("hp", 550);
            baseStats.put("ad", 60);
            baseStats.put("mana", 200);
        }
        for (String dummyId : WasmLegacyAdcBootstrapAdapter.DUMMY_IDS) {
            ObjectNode hero = heroes.addObject();
            hero.put("heroId", dummyId);
            hero.put("name", dummyId);
            ObjectNode baseStats = hero.putObject("baseStats");
            baseStats.put("hp", 1000);
            baseStats.put("ad", 0);
        }
        ArrayNode skills = bundle.putArray("skills");
        skills.addObject()
            .put("skillId", "skill_vayne_w_silver_bolts_dps_v2")
            .put("ownerType", "hero")
            .put("ownerId", "hero_vayne");
        skills.addObject()
            .put("skillId", "skill_item_only")
            .put("ownerType", "item")
            .put("ownerId", "item_x");
        return bundle;
    }
}
