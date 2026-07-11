package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.time.Instant;
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
class PostgresWriteStoreStatusPeriodicHpEffectCritTest {

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
        lenient().when(readStore.findVersionByCode("lol", "__workspace__"))
            .thenReturn(new PostgresReadStore.VersionRecord(9L, "__workspace__", null, Instant.now(), null));
        when(readStore.loadStatusModifierGroup("lol", "status_dot", "tick_main"))
            .thenReturn(JsonNodeFactory.instance.objectNode());
        when(readStore.loadFormulaProfile("lol", "formula_dot_tick"))
            .thenReturn(JsonNodeFactory.instance.objectNode().put("formulaId", "formula_dot_tick"));
    }

    @Test
    void upsertStatusPeriodicHpEffect_rejectsCritMultiplierWhenCanCritFalse() {
        ObjectNode body = baseEffectBody();
        body.put("canCrit", false);
        body.put("critMultiplier", 1.45);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> writeStore.upsertStatusPeriodicHpEffect("lol", "status_dot", "tick_main", "dot_tick", body)
        );

        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    @Test
    void upsertStatusPeriodicHpEffect_requiresCritChanceForFixedSource() {
        ObjectNode body = baseEffectBody();
        body.put("canCrit", true);
        body.put("critChanceSource", "fixed");
        body.put("critMultiplier", 1.45);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> writeStore.upsertStatusPeriodicHpEffect("lol", "status_dot", "tick_main", "dot_tick", body)
        );

        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    @Test
    void upsertStatusPeriodicHpEffect_rejectsCritChanceForAttackerCritChanceSource() {
        ObjectNode body = baseEffectBody();
        body.put("canCrit", true);
        body.put("critChanceSource", "attacker_crit_chance");
        body.put("critChance", 0.25);
        body.put("critMultiplier", 1.45);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> writeStore.upsertStatusPeriodicHpEffect("lol", "status_dot", "tick_main", "dot_tick", body)
        );

        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    @Test
    void upsertStatusPeriodicHpEffect_persistsTypedCritFields() {
        ObjectNode body = baseEffectBody();
        body.put("canCrit", true);
        body.put("critChanceSource", "attacker_crit_chance");
        body.put("critMultiplier", 1.45);

        ObjectNode response = writeStore.upsertStatusPeriodicHpEffect("lol", "status_dot", "tick_main", "dot_tick", body);

        assertEquals(true, response.path("canCrit").asBoolean());
        assertEquals("attacker_crit_chance", response.path("critChanceSource").asText());
        assertEquals(1.45, response.path("critMultiplier").asDouble(), 0.001);
        verify(statusPeriodicHpEffectsMapper).upsertStatusPeriodicHpEffect(
            eq("lol"),
            eq("status_dot"),
            eq("tick_main"),
            eq("dot_tick"),
            eq(9L),
            eq("damage"),
            eq("formula_dot_tick"),
            eq("magic"),
            eq(true),
            eq("attacker_crit_chance"),
            isNull(),
            eq(new BigDecimal("1.45")),
            isNull(),
            eq(false),
            any()
        );
    }

    private static ObjectNode baseEffectBody() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("effectKind", "damage");
        body.put("tickFormulaId", "formula_dot_tick");
        body.put("damageType", "magic");
        body.put("canCrit", false);
        return body;
    }
}
