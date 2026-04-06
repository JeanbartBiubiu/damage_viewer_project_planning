package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.AttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.CoefficientBucketsMapper;
import xyz.game.datamanage.mapper.EditLogMapper;
import xyz.game.datamanage.mapper.FormulaBindingsMapper;
import xyz.game.datamanage.mapper.FormulaProfilesMapper;
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.GameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.HeroesMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.ItemsMapper;
import xyz.game.datamanage.mapper.OwnerCategoriesMapper;
import xyz.game.datamanage.mapper.SkillsMapper;
import xyz.game.datamanage.mapper.StatusActionControlRulesMapper;
import xyz.game.datamanage.mapper.TypeRelationsMapper;
import xyz.game.datamanage.mapper.TypesMapper;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class PostgresWriteStoreTypeRelationsReplaceTest {

    @Mock
    private HeroesMapper heroesMapper;

    @Mock
    private SkillsMapper skillsMapper;

    @Mock
    private ItemsMapper itemsMapper;

    @Mock
    private FormulaProfilesMapper formulaProfilesMapper;

    @Mock
    private FormulaBindingsMapper formulaBindingsMapper;

    @Mock
    private CoefficientBucketsMapper coefficientBucketsMapper;

    @Mock
    private StatusActionControlRulesMapper statusActionControlRulesMapper;

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
            itemsMapper,
            formulaProfilesMapper,
            formulaBindingsMapper,
            statusActionControlRulesMapper,
            coefficientBucketsMapper,
            attributeDefinitionsMapper,
            typesMapper,
            typeRelationsMapper,
            imagesMapper,
            ownerCategoriesMapper,
            gamesMapper,
            gameProgressionSchemaMapper,
            gameVersionsMapper,
            editLogMapper,
            objectMapper,
            readStore,
            new PostgresJsonSupport(objectMapper)
        );
    }

    @Test
    void replaceTypeRelationsForTargetSyncsAddsAndDeletes() {
        when(readStore.findCurrentVersionId("lol")).thenReturn(9L);
        when(readStore.loadHero("lol", "hero_ahri")).thenReturn(JsonNodeFactory.instance.objectNode().put("heroId", "hero_ahri"));
        when(readStore.loadType("lol", 1001)).thenReturn(JsonNodeFactory.instance.objectNode().put("typeId", 1001));
        when(readStore.loadType("lol", 1002)).thenReturn(JsonNodeFactory.instance.objectNode().put("typeId", 1002));
        when(typeRelationsMapper.listTypeRelationsByTarget("lol", "character", "hero_ahri")).thenReturn(
            List.of(
                Map.of("typeId", 1001, "targetCategory", "character", "targetId", "hero_ahri"),
                Map.of("typeId", 1003, "targetCategory", "character", "targetId", "hero_ahri")
            )
        );
        when(typeRelationsMapper.markTypeRelationDeleted("lol", 1003, "character", "hero_ahri", 9L, false)).thenReturn(1);

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.putArray("relations").addObject().put("typeId", 1002);
        body.withArray("relations").insertObject(0).put("typeId", 1001).putObject("extend").put("source", "it");

        ObjectNode response = writeStore.replaceTypeRelationsForTarget("lol", "character", "hero_ahri", body);

        assertEquals("lol", response.path("gameId").asText());
        assertEquals("character", response.path("targetCategory").asText());
        assertEquals("hero_ahri", response.path("targetId").asText());
        assertEquals(2, response.path("typeRelations").size());
        assertEquals(1001, response.path("typeRelations").get(0).path("typeId").asInt());
        assertEquals("it", response.path("typeRelations").get(0).path("extend").path("source").asText());
        assertEquals(1002, response.path("typeRelations").get(1).path("typeId").asInt());

        verify(typeRelationsMapper).markTypeRelationDeleted("lol", 1003, "character", "hero_ahri", 9L, false);
        verify(typeRelationsMapper).upsertTypeRelation("lol", 1001, 9L, "character", "hero_ahri", "{\"source\":\"it\"}", false, false);
        verify(typeRelationsMapper).upsertTypeRelation("lol", 1002, 9L, "character", "hero_ahri", null, false, false);
    }

    @Test
    void replaceTypeRelationsForTargetRejectsDuplicateTypeIds() {
        when(readStore.loadHero("lol", "hero_ahri")).thenReturn(JsonNodeFactory.instance.objectNode().put("heroId", "hero_ahri"));
        when(readStore.loadType("lol", 1001)).thenReturn(JsonNodeFactory.instance.objectNode().put("typeId", 1001));

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.putArray("relations").addObject().put("typeId", 1001);
        body.withArray("relations").addObject().put("typeId", 1001);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> writeStore.replaceTypeRelationsForTarget("lol", "character", "hero_ahri", body)
        );

        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(typeRelationsMapper, never())
            .upsertTypeRelation(anyString(), eq(1001), anyLong(), anyString(), anyString(), anyString(), eq(false), eq(false));
        verify(typeRelationsMapper, never()).markTypeRelationDeleted(anyString(), eq(1001), anyString(), anyString(), anyLong(), eq(false));
    }
}
