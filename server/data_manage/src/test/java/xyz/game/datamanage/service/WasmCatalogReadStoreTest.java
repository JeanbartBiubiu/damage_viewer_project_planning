package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.AttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.CoefficientBucketsMapper;
import xyz.game.datamanage.mapper.ControlStateProfilesMapper;
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

@ExtendWith(MockitoExtension.class)
class WasmCatalogReadStoreTest {

    @Mock private GamesMapper gamesMapper;
    @Mock private GameProgressionSchemaMapper gameProgressionSchemaMapper;
    @Mock private GameVersionsMapper gameVersionsMapper;
    @Mock private ImagesMapper imagesMapper;
    @Mock private OwnerCategoriesMapper ownerCategoriesMapper;
    @Mock private PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper;
    @Mock private PublishedWasmCatalogSnapshotsMapper publishedWasmCatalogSnapshotsMapper;
    @Mock private WasmCatalogSourcesMapper wasmCatalogSourcesMapper;
    @Mock private AttributeDefinitionsMapper attributeDefinitionsMapper;
    @Mock private CoefficientBucketsMapper coefficientBucketsMapper;
    @Mock private TypesMapper typesMapper;
    @Mock private TypeRelationsMapper typeRelationsMapper;
    @Mock private HeroesMapper heroesMapper;
    @Mock private SkillsMapper skillsMapper;
    @Mock private SkillMountsMapper skillMountsMapper;
    @Mock private ItemsMapper itemsMapper;
    @Mock private ItemStatModifiersMapper itemStatModifiersMapper;
    @Mock private FormulaProfilesMapper formulaProfilesMapper;
    @Mock private FormulaBindingsMapper formulaBindingsMapper;
    @Mock private StatusActionControlRulesMapper statusActionControlRulesMapper;
    @Mock private StatusDefinitionsMapper statusDefinitionsMapper;
    @Mock private StatusModifierGroupsMapper statusModifierGroupsMapper;
    @Mock private StatusAttributeModifiersMapper statusAttributeModifiersMapper;
    @Mock private StatusPeriodicHpEffectsMapper statusPeriodicHpEffectsMapper;
    @Mock private ControlStateProfilesMapper controlStateProfilesMapper;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private PostgresReadStore readStore;

    @BeforeEach
    void setUp() {
        readStore = new PostgresReadStore(
            gamesMapper,
            gameProgressionSchemaMapper,
            gameVersionsMapper,
            imagesMapper,
            ownerCategoriesMapper,
            publishedBundleSnapshotsMapper,
            publishedWasmCatalogSnapshotsMapper,
            wasmCatalogSourcesMapper,
            attributeDefinitionsMapper,
            coefficientBucketsMapper,
            typesMapper,
            typeRelationsMapper,
            heroesMapper,
            skillsMapper,
            skillMountsMapper,
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
            objectMapper,
            new PostgresJsonSupport(objectMapper)
        );
    }

    @Test
    void getWasmCatalogSourceReconstructsSchemaVersionAndUpdatedAt() {
        Map<String, Object> row = new HashMap<>();
        row.put("schemaVersion", "generic-p0");
        row.put(
            "catalogJson",
            "{\"typeCatalog\":{\"types\":[],\"relations\":[]},\"combatantTemplates\":[],"
                + "\"sharedProviders\":[],\"rules\":{\"operations\":[],\"modifiers\":[],"
                + "\"listeners\":[],\"triggerRules\":[]},\"formulas\":[],\"settings\":{}}"
        );
        row.put("updatedAt", Timestamp.from(Instant.parse("2026-07-11T12:00:00Z")));
        when(wasmCatalogSourcesMapper.findByGameId("lol")).thenReturn(row);

        ObjectNode response = readStore.getWasmCatalogSource("lol");

        assertEquals("generic-p0", response.path("schemaVersion").asText());
        assertEquals("2026-07-11T12:00:00Z", response.path("updatedAt").asText());
        assertEquals(true, response.has("typeCatalog"));
        assertEquals(false, response.has("meta"));
    }

    @Test
    void getPublishedWasmCatalogSnapshotReturnsNullWhenAbsent() {
        when(publishedWasmCatalogSnapshotsMapper.findCatalogSnapshotJson("lol", "14.1")).thenReturn(null);
        assertNull(readStore.getPublishedWasmCatalogSnapshot("lol", "14.1"));
    }

    @Test
    void getPublishedWasmCatalogSnapshotParsesObject() {
        when(publishedWasmCatalogSnapshotsMapper.findCatalogSnapshotJson("lol", "14.1"))
            .thenReturn("{\"meta\":{\"gameId\":\"lol\",\"versionCode\":\"14.1\"}}");
        ObjectNode snapshot = readStore.getPublishedWasmCatalogSnapshot("lol", "14.1");
        assertEquals("lol", snapshot.path("meta").path("gameId").asText());
    }
}
