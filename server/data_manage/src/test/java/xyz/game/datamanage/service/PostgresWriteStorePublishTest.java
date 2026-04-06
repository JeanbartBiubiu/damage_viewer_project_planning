package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
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
class PostgresWriteStorePublishTest {

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
    void publishVersionProcessesChangesAndWritesLogs() {
        PostgresReadStore.VersionRecord targetVersion = new PostgresReadStore.VersionRecord(
            2L,
            "14.2",
            "",
            Instant.parse("2026-02-26T01:00:00Z"),
            null
        );
        PostgresReadStore.VersionRecord currentVersion = new PostgresReadStore.VersionRecord(
            1L,
            "14.1",
            "oldHash",
            Instant.parse("2026-02-25T01:00:00Z"),
            Instant.parse("2026-02-25T01:00:00Z")
        );
        when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(currentVersion);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), anyString())).thenReturn(emptyBundle("lol", targetVersion));

        when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of(changedHeroRow()));

        when(heroesMapper.updateVersionRange("lol", "hero_ahri", 2L)).thenReturn(1);
        when(gameVersionsMapper.markVersionCurrent(anyString(), any(Timestamp.class), eq("lol"), eq(2L))).thenReturn(1);

        ObjectNode response = writeStore.publishVersion("lol", 2L);

        assertEquals("lol", response.path("gameId").asText());
        assertEquals(2L, response.path("versionId").asLong());
        assertFalse(response.path("dataHash").asText().isBlank());
        verify(gamesMapper).ensureGamePartitions("lol");
        verify(heroesMapper).upsertHeroLog(eq("lol"), eq("hero_ahri"), eq(2L), anyString(), any(), any(), anyString(), any());
        verify(gameVersionsMapper).clearCurrentVersion("lol");
        verify(gameVersionsMapper).markVersionCurrent(anyString(), any(Timestamp.class), eq("lol"), eq(2L));
    }

    @Test
    void upsertFormulaProfileEnsuresGamePartitionsBeforeWrite() {
        when(readStore.findCurrentVersionId("lol")).thenReturn(5L);

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("formulaType", "damage");
        body.put("formulaKind", "linear");
        body.putObject("params").put("baseVar", "damage");
        body.put("description", "test");

        writeStore.upsertFormulaProfile("lol", "formula_magic_damage", body);

        verify(gamesMapper).ensureGamePartitions("lol");
        verify(formulaProfilesMapper).upsertFormulaProfile(
            "lol",
            "formula_magic_damage",
            5L,
            "damage",
            "linear",
            "{\"baseVar\":\"damage\"}",
            "test"
        );
    }

    @Test
    void replaceTypeRelationsForTargetDiffsAgainstCurrentTargetSet() {
        when(readStore.findCurrentVersionId("lol")).thenReturn(5L);
        when(readStore.loadHero("lol", "hero_ahri")).thenReturn(JsonNodeFactory.instance.objectNode());
        when(readStore.loadType("lol", 1)).thenReturn(JsonNodeFactory.instance.objectNode());
        when(readStore.loadType("lol", 3)).thenReturn(JsonNodeFactory.instance.objectNode());
        when(typeRelationsMapper.listTypeRelationsByTarget("lol", "character", "hero_ahri"))
            .thenReturn(List.of(typeRelationRow(1, "character", "hero_ahri", "{\"slot\":1}", false), typeRelationRow(2, "character", "hero_ahri", null, false)));
        when(typeRelationsMapper.markTypeRelationDeleted("lol", 2, "character", "hero_ahri", 5L, false)).thenReturn(1);

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.putArray("relations")
            .add(JsonNodeFactory.instance.objectNode().put("typeId", 1))
            .add(JsonNodeFactory.instance.objectNode().put("typeId", 3));

        ObjectNode response = writeStore.replaceTypeRelationsForTarget("lol", "character", "hero_ahri", body);

        assertEquals("lol", response.path("gameId").asText());
        assertEquals("character", response.path("targetCategory").asText());
        assertEquals("hero_ahri", response.path("targetId").asText());
        assertEquals(2, response.withArray("typeRelations").size());
        verify(typeRelationsMapper).markTypeRelationDeleted("lol", 2, "character", "hero_ahri", 5L, false);
        verify(typeRelationsMapper).upsertTypeRelation("lol", 1, 5L, "character", "hero_ahri", null, false, false);
        verify(typeRelationsMapper).upsertTypeRelation("lol", 3, 5L, "character", "hero_ahri", null, false, false);
    }

    @Test
    void publishVersionFailsWhenBundleSemanticValidationFails() {
        PostgresReadStore.VersionRecord targetVersion = new PostgresReadStore.VersionRecord(
            2L,
            "14.2",
            "",
            Instant.parse("2026-02-26T01:00:00Z"),
            null
        );
        when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(null);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), anyString())).thenReturn(invalidBundle("lol", targetVersion));
        when(ownerCategoriesMapper.countOwnerCategory("lol", "hero")).thenReturn(1L);

        when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());

        ApiException ex = assertThrows(ApiException.class, () -> writeStore.publishVersion("lol", 2L));

        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
        verify(gameVersionsMapper, never()).markVersionCurrent(anyString(), any(Timestamp.class), anyString(), anyLong());
    }

    @Test
    void publishVersionWritesDeletedTypeRelationTombstoneToLog() {
        PostgresReadStore.VersionRecord targetVersion = new PostgresReadStore.VersionRecord(
            2L,
            "14.2",
            "",
            Instant.parse("2026-02-26T01:00:00Z"),
            null
        );
        PostgresReadStore.VersionRecord currentVersion = new PostgresReadStore.VersionRecord(
            1L,
            "14.1",
            "oldHash",
            Instant.parse("2026-02-25T01:00:00Z"),
            Instant.parse("2026-02-25T01:00:00Z")
        );
        when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(currentVersion);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), anyString())).thenReturn(emptyBundle("lol", targetVersion));

        when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class)))
            .thenReturn(List.of(typeRelationRow(7, "character", "hero_ahri", null, true)));
        when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());

        when(typeRelationsMapper.updateVersionRange("lol", 7, "character", "hero_ahri", 2L)).thenReturn(1);
        when(gameVersionsMapper.markVersionCurrent(anyString(), any(Timestamp.class), eq("lol"), eq(2L))).thenReturn(1);

        writeStore.publishVersion("lol", 2L);

        verify(typeRelationsMapper).upsertTypeRelationLog("lol", 7, 2L, "character", "hero_ahri", null, true, false);
    }

    @Test
    void publishVersionFailsWhenFormulaBindingReferencesMissingFormula() {
        PostgresReadStore.VersionRecord targetVersion = new PostgresReadStore.VersionRecord(
            2L,
            "14.2",
            "",
            Instant.parse("2026-02-26T01:00:00Z"),
            null
        );
        when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(null);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), anyString())).thenReturn(invalidFormulaBundle("lol", targetVersion));

        when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());

        ApiException ex = assertThrows(ApiException.class, () -> writeStore.publishVersion("lol", 2L));

        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
        verify(gameVersionsMapper, never()).markVersionCurrent(anyString(), any(Timestamp.class), anyString(), anyLong());
    }

    private ObjectNode emptyBundle(String gameId, PostgresReadStore.VersionRecord version) {
        ObjectNode bundle = JsonNodeFactory.instance.objectNode();
        ObjectNode meta = bundle.putObject("meta");
        meta.put("gameId", gameId);
        meta.put("versionId", version.versionId());
        meta.put("versionCode", version.versionCode());
        meta.put("dataHash", "");
        meta.put("generatedAt", Instant.now().toString());
        bundle.putArray("attributeDefinitions");
        bundle.putArray("types");
        bundle.putArray("typeRelations");
        bundle.putArray("heroes");
        bundle.putArray("skills");
        bundle.putArray("items");
        bundle.putArray("formulaProfiles");
        bundle.putArray("formulaBindings");
        bundle.putArray("coefficientBuckets");
        bundle.putArray("statusActionControlRules");
        return bundle;
    }

    private ObjectNode invalidBundle(String gameId, PostgresReadStore.VersionRecord version) {
        ObjectNode bundle = emptyBundle(gameId, version);
        ObjectNode skill = JsonNodeFactory.instance.objectNode();
        skill.put("skillId", "skill_q");
        skill.put("ownerType", "hero");
        skill.put("ownerId", "hero_ahri");
        ObjectNode mechanicsConfig = skill.putObject("mechanicsConfig");
        mechanicsConfig.put("version", 1);
        mechanicsConfig.putArray("triggers");
        bundle.withArray("skills").add(skill);
        return bundle;
    }

    private ObjectNode invalidFormulaBundle(String gameId, PostgresReadStore.VersionRecord version) {
        ObjectNode bundle = emptyBundle(gameId, version);
        ObjectNode formulaBinding = JsonNodeFactory.instance.objectNode();
        formulaBinding.put("targetCategory", "global");
        formulaBinding.put("targetId", "system");
        formulaBinding.put("bindingKey", "damage_raw");
        formulaBinding.put("formulaId", "missing_formula");
        bundle.withArray("formulaBindings").add(formulaBinding);
        return bundle;
    }

    private Map<String, Object> changedHeroRow() {
        Map<String, Object> row = new HashMap<>();
        row.put("heroId", "hero_ahri");
        row.put("name", "Ahri");
        row.put("title", "Nine-Tailed Fox");
        row.put("avatarUrl", "hero_ahri.png");
        row.put("baseStatsJson", "{\"hp\":500}");
        row.put("statsByLevelJson", null);
        return row;
    }

    private Map<String, Object> typeRelationRow(int typeId, String targetCategory, String targetId, String extendJson, boolean deleted) {
        Map<String, Object> row = new HashMap<>();
        row.put("typeId", typeId);
        row.put("targetCategory", targetCategory);
        row.put("targetId", targetId);
        row.put("extendJson", extendJson);
        row.put("deleted", deleted);
        return row;
    }
}
