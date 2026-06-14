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
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
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
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.GameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.HeroesMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.ItemStatModifiersMapper;
import xyz.game.datamanage.mapper.ItemsMapper;
import xyz.game.datamanage.mapper.OwnerCategoriesMapper;
import xyz.game.datamanage.mapper.PublishedBundleSnapshotsMapper;
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
class PostgresWriteStorePublishTest {

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
            LocalDate.parse("2026-02-26"),
            Instant.parse("2026-02-26T01:00:00Z"),
            null
        );
        PostgresReadStore.VersionRecord currentVersion = new PostgresReadStore.VersionRecord(
            1L,
            "14.1",
            LocalDate.parse("2026-02-25"),
            Instant.parse("2026-02-25T01:00:00Z"),
            Instant.parse("2026-02-25T01:00:00Z")
        );
        when(readStore.findVersionByCode("lol", "14.2")).thenReturn(null);
        when(gameVersionsMapper.createVersion("lol", "14.2", java.sql.Date.valueOf(LocalDate.parse("2026-02-26")))).thenReturn(2L);
        when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(currentVersion);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), any(Instant.class))).thenReturn(emptyBundle("lol", targetVersion));

        when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemStatModifiersMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillMountsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        stubNoStatusResourceChanges();
        when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of(changedHeroRow()));
        stubDefaultBasicAttackProvisioning();

        when(heroesMapper.updateVersionRange("lol", "hero_ahri", 2L)).thenReturn(1);
        when(gameVersionsMapper.markVersionCurrent(any(Timestamp.class), eq("lol"), eq(2L))).thenReturn(1);

        ObjectNode requestBody = JsonNodeFactory.instance.objectNode();
        requestBody.put("versionCode", "14.2");
        requestBody.put("releaseDate", "2026-02-26");
        ObjectNode response = writeStore.publishVersion("lol", requestBody);

        assertEquals("lol", response.path("gameId").asText());
        assertEquals("14.2", response.path("versionCode").asText());
        assertEquals("2026-02-26", response.path("releaseDate").asText());
        assertFalse(response.path("publishedAt").asText().isBlank());
        verify(gamesMapper).ensureGamePartitions("lol");
        verify(heroesMapper).upsertHeroLog(eq("lol"), eq("hero_ahri"), eq(2L), anyString(), any(), any(), anyString(), any());
        verify(publishedBundleSnapshotsMapper).upsertBundleSnapshot(eq("lol"), eq(2L), eq("14.2"), anyString());
        verify(gameVersionsMapper).clearCurrentVersion("lol");
        verify(gameVersionsMapper).markVersionCurrent(any(Timestamp.class), eq("lol"), eq(2L));
    }

    @Test
    void upsertFormulaProfileEnsuresGamePartitionsBeforeWrite() {
        when(readStore.findVersionByCode("lol", "__workspace__"))
            .thenReturn(new PostgresReadStore.VersionRecord(5L, "__workspace__", null, Instant.now(), null));

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
        when(readStore.findVersionByCode("lol", "__workspace__"))
            .thenReturn(new PostgresReadStore.VersionRecord(5L, "__workspace__", null, Instant.now(), null));
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
            null,
            Instant.parse("2026-02-26T01:00:00Z"),
            null
        );
        when(readStore.findVersionByCode("lol", "14.2")).thenReturn(null);
        when(gameVersionsMapper.createVersion("lol", "14.2", null)).thenReturn(2L);
        when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(null);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), any(Instant.class))).thenReturn(invalidBundle("lol", targetVersion));
        when(ownerCategoriesMapper.countOwnerCategory("lol", "hero")).thenReturn(1L);

        when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemStatModifiersMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillMountsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        stubNoStatusResourceChanges();
        when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        stubDefaultBasicAttackProvisioning();

        ObjectNode requestBody = JsonNodeFactory.instance.objectNode().put("versionCode", "14.2");
        ApiException ex = assertThrows(ApiException.class, () -> writeStore.publishVersion("lol", requestBody));

        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
        verify(gameVersionsMapper, never()).markVersionCurrent(any(Timestamp.class), anyString(), anyLong());
    }

    @Test
    void publishVersionWritesDeletedTypeRelationTombstoneToLog() {
        PostgresReadStore.VersionRecord targetVersion = new PostgresReadStore.VersionRecord(
            2L,
            "14.2",
            null,
            Instant.parse("2026-02-26T01:00:00Z"),
            null
        );
        PostgresReadStore.VersionRecord currentVersion = new PostgresReadStore.VersionRecord(
            1L,
            "14.1",
            LocalDate.parse("2026-02-25"),
            Instant.parse("2026-02-25T01:00:00Z"),
            Instant.parse("2026-02-25T01:00:00Z")
        );
        when(readStore.findVersionByCode("lol", "14.2")).thenReturn(null);
        when(gameVersionsMapper.createVersion("lol", "14.2", null)).thenReturn(2L);
        when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(currentVersion);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), any(Instant.class))).thenReturn(emptyBundle("lol", targetVersion));

        when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class)))
            .thenReturn(List.of(typeRelationRow(7, "character", "hero_ahri", null, true)));
        when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemStatModifiersMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillMountsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        stubNoStatusResourceChanges();
        when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        stubDefaultBasicAttackProvisioning();

        when(typeRelationsMapper.updateVersionRange("lol", 7, "character", "hero_ahri", 2L)).thenReturn(1);
        when(gameVersionsMapper.markVersionCurrent(any(Timestamp.class), eq("lol"), eq(2L))).thenReturn(1);

        writeStore.publishVersion("lol", JsonNodeFactory.instance.objectNode().put("versionCode", "14.2"));

        verify(typeRelationsMapper).upsertTypeRelationLog("lol", 7, 2L, "character", "hero_ahri", null, true, false);
    }

    @Test
    void publishVersionFailsWhenFormulaBindingReferencesMissingFormula() {
        PostgresReadStore.VersionRecord targetVersion = new PostgresReadStore.VersionRecord(
            2L,
            "14.2",
            null,
            Instant.parse("2026-02-26T01:00:00Z"),
            null
        );
        when(readStore.findVersionByCode("lol", "14.2")).thenReturn(null);
        when(gameVersionsMapper.createVersion("lol", "14.2", null)).thenReturn(2L);
        when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(null);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), any(Instant.class))).thenReturn(invalidFormulaBundle("lol", targetVersion));

        when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemStatModifiersMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillMountsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        stubNoStatusResourceChanges();
        when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        stubDefaultBasicAttackProvisioning();

        ApiException ex = assertThrows(
            ApiException.class,
            () -> writeStore.publishVersion("lol", JsonNodeFactory.instance.objectNode().put("versionCode", "14.2"))
        );

        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
        verify(gameVersionsMapper, never()).markVersionCurrent(any(Timestamp.class), anyString(), anyLong());
    }

    @Test
    void publishVersionFailsWhenDpsPassiveEffectsMalformed() {
        record MalformedCase(String label, Consumer<ObjectNode> mutator, String expectedPath) {}

        List<MalformedCase> cases = List.of(
            new MalformedCase(
                "dpsPassiveEffects not array",
                skill -> ((ObjectNode) skill.path("mechanicsConfig"))
                    .set("dpsPassiveEffects", JsonNodeFactory.instance.objectNode()),
                "/skills/mechanicsConfig/dpsPassiveEffects"
            ),
            new MalformedCase(
                "passive entry not object",
                skill -> {
                    ObjectNode mechanicsConfig = (ObjectNode) skill.path("mechanicsConfig");
                    mechanicsConfig.remove("dpsPassiveEffects");
                    mechanicsConfig.putArray("dpsPassiveEffects").add("not-an-object");
                },
                "/skills/mechanicsConfig/dpsPassiveEffects/0"
            ),
            new MalformedCase(
                "ownerRole invalid",
                skill -> ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0))
                    .put("ownerRole", "ally"),
                "/skills/mechanicsConfig/dpsPassiveEffects/0/ownerRole"
            ),
            new MalformedCase(
                "trigger not object",
                skill -> ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0))
                    .put("trigger", "not-an-object"),
                "/skills/mechanicsConfig/dpsPassiveEffects/0/trigger"
            ),
            new MalformedCase(
                "trigger.event invalid",
                skill -> ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0).path("trigger"))
                    .put("event", "on_unknown_event"),
                "/skills/mechanicsConfig/dpsPassiveEffects/0/trigger/event"
            ),
            new MalformedCase(
                "operations not array",
                skill -> ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0))
                    .set("operations", JsonNodeFactory.instance.objectNode()),
                "/skills/mechanicsConfig/dpsPassiveEffects/0/operations"
            ),
            new MalformedCase(
                "operation entry not object",
                skill -> {
                    ObjectNode passive = (ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0);
                    passive.remove("operations");
                    passive.putArray("operations").add("not-an-object");
                },
                "/skills/mechanicsConfig/dpsPassiveEffects/0/operations/0"
            ),
            new MalformedCase(
                "operation targetRole invalid",
                skill -> ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0).path("operations").get(0))
                    .put("targetRole", "source"),
                "/skills/mechanicsConfig/dpsPassiveEffects/0/operations/0/targetRole"
            ),
            new MalformedCase(
                "internalCooldownMs negative",
                skill -> ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0))
                    .put("internalCooldownMs", -1),
                "/skills/mechanicsConfig/dpsPassiveEffects/0/internalCooldownMs"
            ),
            new MalformedCase(
                "internalCooldownMs float",
                skill -> ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0))
                    .put("internalCooldownMs", 1.5),
                "/skills/mechanicsConfig/dpsPassiveEffects/0/internalCooldownMs"
            ),
            new MalformedCase(
                "internalCooldownMs text",
                skill -> ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0))
                    .put("internalCooldownMs", "1000"),
                "/skills/mechanicsConfig/dpsPassiveEffects/0/internalCooldownMs"
            ),
            new MalformedCase(
                "internalCooldownMs object",
                skill -> ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0))
                    .set("internalCooldownMs", JsonNodeFactory.instance.objectNode().put("ms", 1000)),
                "/skills/mechanicsConfig/dpsPassiveEffects/0/internalCooldownMs"
            )
        );

        PostgresReadStore.VersionRecord targetVersion = publishTargetVersion();
        for (MalformedCase testCase : cases) {
            ObjectNode bundle = bundleWithValidDpsPassiveSkill("lol", targetVersion);
            testCase.mutator().accept((ObjectNode) bundle.withArray("skills").get(0));
            stubPublishVersionSemanticFailureSetup(targetVersion, bundle);

            ApiException ex = assertThrows(
                ApiException.class,
                () -> writeStore.publishVersion("lol", JsonNodeFactory.instance.objectNode().put("versionCode", "14.2")),
                testCase.label()
            );

            assertEquals("422.SEMANTIC_ERROR", ex.getCode(), testCase.label());
            Object path = ex.getDetails().get("path");
            assertTrue(
                testCase.expectedPath().equals(path) || (path != null && path.toString().contains("dpsPassiveEffects")),
                () -> testCase.label() + " expected path " + testCase.expectedPath() + " but got " + path
            );
            assertTrue(
                ex.getMessage().contains("dpsPassiveEffects")
                    || ex.getMessage().contains("internalCooldownMs")
                    || testCase.expectedPath().equals(path),
                () -> testCase.label() + " message should reference dpsPassiveEffects or internalCooldownMs: " + ex.getMessage()
            );
            verify(gameVersionsMapper, never()).markVersionCurrent(any(Timestamp.class), anyString(), anyLong());
        }
    }

    @Test
    void publishVersionAcceptsDpsPassiveInternalCooldownMs() {
        PostgresReadStore.VersionRecord targetVersion = publishTargetVersion();
        PostgresReadStore.VersionRecord currentVersion = new PostgresReadStore.VersionRecord(
            1L,
            "14.1",
            LocalDate.parse("2026-02-25"),
            Instant.parse("2026-02-25T01:00:00Z"),
            Instant.parse("2026-02-25T01:00:00Z")
        );

        for (long cooldownMs : List.of(0L, 1000L)) {
            ObjectNode bundle = bundleWithValidDpsPassiveSkill("lol", targetVersion);
            ((ObjectNode) bundle.withArray("skills").get(0).path("mechanicsConfig").path("dpsPassiveEffects").get(0))
                .put("internalCooldownMs", cooldownMs);

            when(readStore.findVersionByCode("lol", "14.2")).thenReturn(null);
            when(gameVersionsMapper.createVersion("lol", "14.2", null)).thenReturn(2L);
            when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
            when(readStore.findCurrentPublishedVersion("lol")).thenReturn(currentVersion);
            when(readStore.buildBundle(eq("lol"), eq(targetVersion), any(Instant.class))).thenReturn(bundle);
            when(ownerCategoriesMapper.countOwnerCategory("lol", "hero")).thenReturn(1L);

            when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(itemStatModifiersMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(skillMountsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            stubNoStatusResourceChanges();
            when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
            stubDefaultBasicAttackProvisioning();
            when(gameVersionsMapper.markVersionCurrent(any(Timestamp.class), eq("lol"), eq(2L))).thenReturn(1);

            ObjectNode response = writeStore.publishVersion(
                "lol",
                JsonNodeFactory.instance.objectNode().put("versionCode", "14.2")
            );

            assertEquals("14.2", response.path("versionCode").asText(), "internalCooldownMs=" + cooldownMs);
        }
    }

    private void stubNoStatusResourceChanges() {
        when(statusDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(controlStateProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusModifierGroupsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusAttributeModifiersMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusPeriodicHpEffectsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
    }

    private ObjectNode emptyBundle(String gameId, PostgresReadStore.VersionRecord version) {
        ObjectNode bundle = JsonNodeFactory.instance.objectNode();
        ObjectNode meta = bundle.putObject("meta");
        meta.put("gameId", gameId);
        meta.put("versionCode", version.versionCode());
        if (version.releaseDate() != null) {
            meta.put("releaseDate", version.releaseDate().toString());
        }
        if (version.publishedAt() != null) {
            meta.put("publishedAt", version.publishedAt().toString());
        }
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

    private PostgresReadStore.VersionRecord publishTargetVersion() {
        return new PostgresReadStore.VersionRecord(
            2L,
            "14.2",
            null,
            Instant.parse("2026-02-26T01:00:00Z"),
            null
        );
    }

    private void stubPublishVersionSemanticFailureSetup(PostgresReadStore.VersionRecord targetVersion, ObjectNode bundle) {
        when(readStore.findVersionByCode("lol", "14.2")).thenReturn(null);
        when(gameVersionsMapper.createVersion("lol", "14.2", null)).thenReturn(2L);
        when(readStore.findVersionById("lol", 2L)).thenReturn(targetVersion);
        when(readStore.findCurrentPublishedVersion("lol")).thenReturn(null);
        when(readStore.buildBundle(eq("lol"), eq(targetVersion), any(Instant.class))).thenReturn(bundle);
        when(ownerCategoriesMapper.countOwnerCategory("lol", "hero")).thenReturn(1L);

        when(attributeDefinitionsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(typeRelationsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(itemStatModifiersMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaProfilesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(formulaBindingsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(skillMountsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(coefficientBucketsMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        when(statusActionControlRulesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        stubNoStatusResourceChanges();
        when(heroesMapper.listChangedSince(eq("lol"), any(Timestamp.class))).thenReturn(List.of());
        stubDefaultBasicAttackProvisioning();
    }

    private ObjectNode bundleWithValidDpsPassiveSkill(String gameId, PostgresReadStore.VersionRecord version) {
        ObjectNode bundle = emptyBundle(gameId, version);
        ObjectNode hero = bundle.withArray("heroes").addObject();
        hero.put("heroId", "hero_ahri");
        hero.put("name", "Ahri");
        hero.putObject("baseStats").put("hp", 500);

        ObjectNode skill = bundle.withArray("skills").addObject();
        skill.put("skillId", "skill_dps_passive_test");
        skill.put("ownerType", "hero");
        skill.put("ownerId", "hero_ahri");
        ObjectNode mechanicsConfig = skill.putObject("mechanicsConfig");
        mechanicsConfig.put("version", 1);
        mechanicsConfig.putArray("triggers");
        ObjectNode passive = mechanicsConfig.putArray("dpsPassiveEffects").addObject();
        passive.put("passiveId", "test_passive");
        passive.put("ownerRole", "attacker");
        passive.put("internalCooldownMs", 1000);
        passive.putObject("trigger").put("event", "on_damage_dealt");
        ObjectNode operation = passive.putArray("operations").addObject();
        operation.put("kind", "damage");
        operation.put("targetRole", "target");
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

    private void stubDefaultBasicAttackProvisioning() {
        org.mockito.Mockito.doNothing().when(defaultBasicAttackProvisioner).ensureForGame(anyString());
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
