package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
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
import xyz.game.datamanage.mapper.WasmCatalogSourcesMapper;
import xyz.game.datamanage.mapper.SkillMountsMapper;
import xyz.game.datamanage.mapper.SkillsMapper;
import xyz.game.datamanage.mapper.StatusActionControlRulesMapper;
import xyz.game.datamanage.mapper.StatusAttributeModifiersMapper;
import xyz.game.datamanage.mapper.StatusDefinitionsMapper;
import xyz.game.datamanage.mapper.StatusModifierGroupsMapper;
import xyz.game.datamanage.mapper.StatusPeriodicHpEffectsMapper;
import xyz.game.datamanage.mapper.TypeRelationsMapper;
import xyz.game.datamanage.mapper.TypesMapper;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class PostgresWriteStoreItemStatModifiersTest {

    @Mock
    private HeroesMapper heroesMapper;

    @Mock
    private SkillsMapper skillsMapper;

    @Mock
    private SkillMountsMapper skillMountsMapper;

    @Mock
    private DefaultBasicAttackProvisioner defaultBasicAttackProvisioner;

    @Mock
    private ItemsMapper itemsMapper;

    @Mock
    private ItemStatModifiersMapper itemStatModifiersMapper;

    @Mock
    private FormulaProfilesMapper formulaProfilesMapper;

    @Mock
    private FormulaBindingsMapper formulaBindingsMapper;

    @Mock
    private CoefficientBucketsMapper coefficientBucketsMapper;

    @Mock
    private StatusActionControlRulesMapper statusActionControlRulesMapper;

    @Mock
    private StatusDefinitionsMapper statusDefinitionsMapper;

    @Mock
    private StatusModifierGroupsMapper statusModifierGroupsMapper;

    @Mock
    private StatusAttributeModifiersMapper statusAttributeModifiersMapper;

    @Mock
    private StatusPeriodicHpEffectsMapper statusPeriodicHpEffectsMapper;

    @Mock
    private ControlStateProfilesMapper controlStateProfilesMapper;

    @Mock
    private AttributeDefinitionsMapper attributeDefinitionsMapper;

    @Mock
    private TypesMapper typesMapper;

    @Mock
    private TypeRelationsMapper typeRelationsMapper;

    @Mock
    private ImagesMapper imagesMapper;

    @Mock
    private OwnerCategoriesMapper ownerCategoriesMapper;

    @Mock
    private PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper;

    @Mock
    private PublishedWasmCatalogSnapshotsMapper publishedWasmCatalogSnapshotsMapper;

    @Mock
    private WasmCatalogSourcesMapper wasmCatalogSourcesMapper;

    @Mock
    private GamesMapper gamesMapper;

    @Mock
    private GameProgressionSchemaMapper gameProgressionSchemaMapper;

    @Mock
    private GameVersionsMapper gameVersionsMapper;

    @Mock
    private EditLogMapper editLogMapper;

    @Mock
    private PostgresReadStore readStore;

    private PostgresWriteStore writeStore;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = new ObjectMapper();
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
            new PostgresJsonSupport(objectMapper),
            new WasmCatalogValidator()
        );
    }

    @Test
    void upsertItemAcceptsValidStatModifiers() {
        when(readStore.findVersionByCode("lol", "__workspace__"))
            .thenReturn(new PostgresReadStore.VersionRecord(9L, "__workspace__", null, java.time.Instant.now(), null));
        when(readStore.loadAttributeDefinition("lol", "attack_power")).thenReturn(JsonNodeFactory.instance.objectNode().put("attrKey", "attack_power"));
        when(readStore.loadAttributeDefinition("lol", "attack_speed")).thenReturn(JsonNodeFactory.instance.objectNode().put("attrKey", "attack_speed"));

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("name", "Amplifying Tome");
        body.put("goldCost", 435);
        body.putArray("skillRefs");
        body.putArray("recipeIds");
        ArrayNode statModifiers = body.putArray("statModifiers");
        statModifiers.addObject().put("attrKey", "attack_power").put("value", 20);
        statModifiers.addObject().put("attrKey", "attack_speed").put("value", 0.12);

        ObjectNode response = writeStore.upsertItem("lol", "item_tome", body);

        assertEquals(2, response.path("statModifiers").size());
        verify(itemsMapper).upsertItem("lol", "item_tome", 9L, "Amplifying Tome", 435, null, "[]", "[]");
        verify(itemStatModifiersMapper).deleteItemStatModifiersByItemId("lol", "item_tome");
        verify(itemStatModifiersMapper).upsertItemStatModifier("lol", "item_tome", "attack_power", 9L, java.math.BigDecimal.valueOf(20));
        verify(itemStatModifiersMapper).upsertItemStatModifier("lol", "item_tome", "attack_speed", 9L, java.math.BigDecimal.valueOf(0.12));
    }

    @Test
    void upsertItemRejectsDuplicateAttrKey() {
        when(readStore.loadAttributeDefinition("lol", "attack_power")).thenReturn(JsonNodeFactory.instance.objectNode().put("attrKey", "attack_power"));

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("name", "Amplifying Tome");
        ArrayNode statModifiers = body.putArray("statModifiers");
        statModifiers.addObject().put("attrKey", "attack_power").put("value", 20);
        statModifiers.addObject().put("attrKey", "attack_power").put("value", 21);

        ApiException ex = assertThrows(ApiException.class, () -> writeStore.upsertItem("lol", "item_tome", body));

        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(itemsMapper, never()).upsertItem(anyString(), anyString(), anyLong(), any(), any(), any(), any(), any());
        verify(itemStatModifiersMapper, never()).upsertItemStatModifier(anyString(), anyString(), anyString(), anyLong(), any());
    }

    @Test
    void upsertItemRejectsUnknownAttrKey() {
        when(readStore.loadAttributeDefinition("lol", "unknown_attr")).thenReturn(null);

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("name", "Amplifying Tome");
        body.putArray("statModifiers").addObject().put("attrKey", "unknown_attr").put("value", 20);

        ApiException ex = assertThrows(ApiException.class, () -> writeStore.upsertItem("lol", "item_tome", body));

        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
        verify(itemsMapper, never()).upsertItem(anyString(), anyString(), anyLong(), any(), any(), any(), any(), any());
        verify(itemStatModifiersMapper, never()).upsertItemStatModifier(anyString(), anyString(), anyString(), anyLong(), any());
    }

    @Test
    void upsertItemRejectsNonNumberValue() {
        when(readStore.loadAttributeDefinition("lol", "attack_power")).thenReturn(JsonNodeFactory.instance.objectNode().put("attrKey", "attack_power"));

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("name", "Amplifying Tome");
        body.putArray("statModifiers").addObject().put("attrKey", "attack_power").put("value", "bad-number");

        ApiException ex = assertThrows(ApiException.class, () -> writeStore.upsertItem("lol", "item_tome", body));

        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(itemsMapper, never()).upsertItem(anyString(), anyString(), anyLong(), any(), any(), any(), any(), any());
        verify(itemStatModifiersMapper, never()).upsertItemStatModifier(anyString(), anyString(), anyString(), anyLong(), any());
    }
}
