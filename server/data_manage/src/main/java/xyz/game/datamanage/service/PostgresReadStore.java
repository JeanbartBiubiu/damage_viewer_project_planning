package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.mapper.AttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.CoefficientBucketsMapper;
import xyz.game.datamanage.mapper.ControlStateProfilesMapper;
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

@Component
public class PostgresReadStore {

    private static final String DEFAULT_PROGRESSION_KIND = "LEVEL";
    private static final int DEFAULT_STAGE_MIN = 1;
    private static final int DEFAULT_STAGE_MAX = 18;
    private static final String DEFAULT_STAGE_LABEL = "Lv";
    private static final boolean DEFAULT_REQUIRE_ALL_STAGES = true;

    private final GamesMapper gamesMapper;
    private final GameProgressionSchemaMapper gameProgressionSchemaMapper;
    private final GameVersionsMapper gameVersionsMapper;
    private final ImagesMapper imagesMapper;
    private final OwnerCategoriesMapper ownerCategoriesMapper;
    private final PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper;
    private final AttributeDefinitionsMapper attributeDefinitionsMapper;
    private final CoefficientBucketsMapper coefficientBucketsMapper;
    private final TypesMapper typesMapper;
    private final TypeRelationsMapper typeRelationsMapper;
    private final HeroesMapper heroesMapper;
    private final SkillsMapper skillsMapper;
    private final SkillMountsMapper skillMountsMapper;
    private final ItemsMapper itemsMapper;
    private final ItemStatModifiersMapper itemStatModifiersMapper;
    private final FormulaProfilesMapper formulaProfilesMapper;
    private final FormulaBindingsMapper formulaBindingsMapper;
    private final StatusActionControlRulesMapper statusActionControlRulesMapper;
    private final StatusDefinitionsMapper statusDefinitionsMapper;
    private final StatusModifierGroupsMapper statusModifierGroupsMapper;
    private final StatusAttributeModifiersMapper statusAttributeModifiersMapper;
    private final StatusPeriodicHpEffectsMapper statusPeriodicHpEffectsMapper;
    private final ControlStateProfilesMapper controlStateProfilesMapper;
    private final ObjectMapper objectMapper;
    private final PostgresJsonSupport jsonSupport;

    public PostgresReadStore(
        GamesMapper gamesMapper,
        GameProgressionSchemaMapper gameProgressionSchemaMapper,
        GameVersionsMapper gameVersionsMapper,
        ImagesMapper imagesMapper,
        OwnerCategoriesMapper ownerCategoriesMapper,
        PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper,
        AttributeDefinitionsMapper attributeDefinitionsMapper,
        CoefficientBucketsMapper coefficientBucketsMapper,
        TypesMapper typesMapper,
        TypeRelationsMapper typeRelationsMapper,
        HeroesMapper heroesMapper,
        SkillsMapper skillsMapper,
        SkillMountsMapper skillMountsMapper,
        ItemsMapper itemsMapper,
        ItemStatModifiersMapper itemStatModifiersMapper,
        FormulaProfilesMapper formulaProfilesMapper,
        FormulaBindingsMapper formulaBindingsMapper,
        StatusActionControlRulesMapper statusActionControlRulesMapper,
        StatusDefinitionsMapper statusDefinitionsMapper,
        StatusModifierGroupsMapper statusModifierGroupsMapper,
        StatusAttributeModifiersMapper statusAttributeModifiersMapper,
        StatusPeriodicHpEffectsMapper statusPeriodicHpEffectsMapper,
        ControlStateProfilesMapper controlStateProfilesMapper,
        ObjectMapper objectMapper,
        PostgresJsonSupport jsonSupport
    ) {
        this.gamesMapper = gamesMapper;
        this.gameProgressionSchemaMapper = gameProgressionSchemaMapper;
        this.gameVersionsMapper = gameVersionsMapper;
        this.imagesMapper = imagesMapper;
        this.ownerCategoriesMapper = ownerCategoriesMapper;
        this.publishedBundleSnapshotsMapper = publishedBundleSnapshotsMapper;
        this.attributeDefinitionsMapper = attributeDefinitionsMapper;
        this.coefficientBucketsMapper = coefficientBucketsMapper;
        this.typesMapper = typesMapper;
        this.typeRelationsMapper = typeRelationsMapper;
        this.heroesMapper = heroesMapper;
        this.skillsMapper = skillsMapper;
        this.skillMountsMapper = skillMountsMapper;
        this.itemsMapper = itemsMapper;
        this.itemStatModifiersMapper = itemStatModifiersMapper;
        this.formulaProfilesMapper = formulaProfilesMapper;
        this.formulaBindingsMapper = formulaBindingsMapper;
        this.statusActionControlRulesMapper = statusActionControlRulesMapper;
        this.statusDefinitionsMapper = statusDefinitionsMapper;
        this.statusModifierGroupsMapper = statusModifierGroupsMapper;
        this.statusAttributeModifiersMapper = statusAttributeModifiersMapper;
        this.statusPeriodicHpEffectsMapper = statusPeriodicHpEffectsMapper;
        this.controlStateProfilesMapper = controlStateProfilesMapper;
        this.objectMapper = objectMapper;
        this.jsonSupport = jsonSupport;
    }

    public ArrayNode listGames() {
        ArrayNode array = objectMapper.createArrayNode();
        for (Map<String, Object> row : gamesMapper.listGames()) {
            String gameId = text(row, "gameId");
            ObjectNode node = objectMapper.createObjectNode();
            node.put("gameId", gameId);
            node.put("gameName", text(row, "gameName"));
            putNullableText(node, "gameImgUrl", text(row, "gameImgUrl"));
            node.set("progressionSchema", loadProgressionSchemaOrDefault(gameId));
            array.add(node);
        }
        return array;
    }

    public boolean gameExists(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        return count != null && count > 0;
    }

    public ObjectNode loadProgressionSchemaOrDefault(String gameId) {
        return toProgressionSchemaNode(loadProgressionSchemaRecordOrDefault(gameId));
    }

    public ProgressionSchemaRecord loadProgressionSchemaRecordOrDefault(String gameId) {
        Map<String, Object> row = gameProgressionSchemaMapper.findByGameId(gameId);
        return row == null
            ? defaultProgressionSchemaRecord()
            : mapProgressionSchemaRecord(row);
    }

    public VersionRecord findCurrentPublishedVersion(String gameId) {
        Map<String, Object> row = gameVersionsMapper.findCurrentPublishedVersion(gameId);
        return row == null ? null : mapVersionRecord(row);
    }

    public VersionRecord findVersionById(String gameId, long versionId) {
        Map<String, Object> row = gameVersionsMapper.findVersionById(gameId, versionId);
        return row == null ? null : mapVersionRecord(row);
    }

    public VersionRecord findVersionByCode(String gameId, String versionCode) {
        Map<String, Object> row = gameVersionsMapper.findVersionByCode(gameId, versionCode);
        return row == null ? null : mapVersionRecord(row);
    }

    public Long findCurrentVersionId(String gameId) {
        return gameVersionsMapper.findCurrentVersionId(gameId);
    }

    public Long findLatestVersionId(String gameId) {
        return gameVersionsMapper.findLatestVersionId(gameId);
    }

    public ObjectNode getImages(String gameId, Instant updatedAfter) {
        List<Map<String, Object>> rows = updatedAfter == null
            ? imagesMapper.listImages(gameId)
            : imagesMapper.listImagesUpdatedAfter(gameId, Timestamp.from(updatedAfter));

        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode images = response.putArray("images");
        for (Map<String, Object> row : rows) {
            images.add(mapImageRow(row));
        }
        return response;
    }

    public ObjectNode getOwnerCategories(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode ownerCategories = response.putArray("ownerCategories");
        for (Map<String, Object> row : ownerCategoriesMapper.listOwnerCategories(gameId)) {
            ownerCategories.add(mapOwnerCategoryRow(row));
        }
        return response;
    }

    public ObjectNode getHeroes(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode heroes = response.putArray("heroes");
        for (Map<String, Object> row : heroesMapper.listHeroes(gameId)) {
            heroes.add(mapHeroRow(row));
        }
        return response;
    }

    public ObjectNode getSkills(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode skills = response.putArray("skills");
        for (Map<String, Object> row : skillsMapper.listSkills(gameId)) {
            skills.add(mapSkillRow(row));
        }
        return response;
    }

    public ObjectNode getSkillMounts(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode skillMounts = response.putArray("skillMounts");
        for (Map<String, Object> row : skillMountsMapper.listSkillMounts(gameId)) {
            skillMounts.add(mapSkillMountRow(row));
        }
        return response;
    }

    public ObjectNode getItems(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode items = response.putArray("items");
        Map<String, ArrayNode> statModifiersByItemId = loadItemStatModifiersByItemId(gameId);
        for (Map<String, Object> row : itemsMapper.listItems(gameId)) {
            items.add(mapItemRow(row, statModifiersByItemId));
        }
        return response;
    }

    public ObjectNode getAttributeDefinitions(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode attributeDefinitions = response.putArray("attributeDefinitions");
        for (Map<String, Object> row : attributeDefinitionsMapper.listAttributeDefinitions(gameId)) {
            attributeDefinitions.add(mapAttributeDefinitionRow(row));
        }
        return response;
    }

    public ObjectNode getTypes(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode types = response.putArray("types");
        for (Map<String, Object> row : typesMapper.listTypes(gameId)) {
            types.add(mapTypeRow(row));
        }
        return response;
    }

    public ObjectNode getTypeRelations(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode typeRelations = response.putArray("typeRelations");
        for (Map<String, Object> row : typeRelationsMapper.listTypeRelations(gameId)) {
            typeRelations.add(mapTypeRelationRow(row));
        }
        return response;
    }

    public ObjectNode getFormulaProfiles(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode formulaProfiles = response.putArray("formulaProfiles");
        for (Map<String, Object> row : formulaProfilesMapper.listFormulaProfiles(gameId)) {
            formulaProfiles.add(mapFormulaProfileRow(row));
        }
        return response;
    }

    public ObjectNode getFormulaBindings(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode formulaBindings = response.putArray("formulaBindings");
        for (Map<String, Object> row : formulaBindingsMapper.listFormulaBindings(gameId)) {
            formulaBindings.add(mapFormulaBindingRow(row));
        }
        return response;
    }

    public ObjectNode getCoefficientBuckets(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode coefficientBuckets = response.putArray("coefficientBuckets");
        for (Map<String, Object> row : coefficientBucketsMapper.listCoefficientBuckets(gameId)) {
            coefficientBuckets.add(mapCoefficientBucketRow(row));
        }
        return response;
    }

    public ObjectNode getStatusActionControlRules(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode statusActionControlRules = response.putArray("statusActionControlRules");
        for (Map<String, Object> row : statusActionControlRulesMapper.listStatusActionControlRules(gameId)) {
            statusActionControlRules.add(mapStatusActionControlRuleRow(row));
        }
        return response;
    }

    public ObjectNode getStatusDefinitions(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode statusDefinitions = response.putArray("statusDefinitions");
        for (Map<String, Object> row : statusDefinitionsMapper.listStatusDefinitions(gameId)) {
            statusDefinitions.add(mapStatusDefinitionRow(row));
        }
        return response;
    }

    public ObjectNode getControlStateProfiles(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode controlStateProfiles = response.putArray("controlStateProfiles");
        for (Map<String, Object> row : controlStateProfilesMapper.listControlStateProfiles(gameId)) {
            controlStateProfiles.add(mapControlStateProfileRow(row));
        }
        return response;
    }

    public ObjectNode getStatusModifierGroups(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode statusModifierGroups = response.putArray("statusModifierGroups");
        for (Map<String, Object> row : statusModifierGroupsMapper.listStatusModifierGroups(gameId)) {
            statusModifierGroups.add(mapStatusModifierGroupRow(row));
        }
        return response;
    }

    public ObjectNode getStatusAttributeModifiers(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode statusAttributeModifiers = response.putArray("statusAttributeModifiers");
        for (Map<String, Object> row : statusAttributeModifiersMapper.listStatusAttributeModifiers(gameId)) {
            statusAttributeModifiers.add(mapStatusAttributeModifierRow(row));
        }
        return response;
    }

    public ObjectNode getStatusPeriodicHpEffects(String gameId) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        ArrayNode statusPeriodicHpEffects = response.putArray("statusPeriodicHpEffects");
        for (Map<String, Object> row : statusPeriodicHpEffectsMapper.listStatusPeriodicHpEffects(gameId)) {
            statusPeriodicHpEffects.add(mapStatusPeriodicHpEffectRow(row));
        }
        return response;
    }

    public ObjectNode buildBundle(String gameId, VersionRecord version, Instant generatedAt) {
        ObjectNode bundle = objectMapper.createObjectNode();
        ObjectNode meta = bundle.putObject("meta");
        meta.put("gameId", gameId);
        meta.put("versionCode", version.versionCode());
        if (version.releaseDate() != null) {
            meta.put("releaseDate", version.releaseDate().toString());
        }
        if (version.publishedAt() != null) {
            meta.put("publishedAt", version.publishedAt().toString());
        }
        meta.put("generatedAt", (generatedAt == null ? Instant.now() : generatedAt).toString());

        ArrayNode attributeDefinitions = objectMapper.createArrayNode();
        for (Map<String, Object> row : attributeDefinitionsMapper.listAttributeDefinitions(gameId)) {
            attributeDefinitions.add(mapAttributeDefinitionRow(row));
        }
        bundle.set("attributeDefinitions", attributeDefinitions);

        ArrayNode coefficientBuckets = objectMapper.createArrayNode();
        for (Map<String, Object> row : coefficientBucketsMapper.listCoefficientBuckets(gameId)) {
            coefficientBuckets.add(mapCoefficientBucketRow(row));
        }
        bundle.set("coefficientBuckets", coefficientBuckets);

        ArrayNode types = objectMapper.createArrayNode();
        for (Map<String, Object> row : typesMapper.listTypes(gameId)) {
            types.add(mapTypeRow(row));
        }
        bundle.set("types", types);

        ArrayNode typeRelations = objectMapper.createArrayNode();
        for (Map<String, Object> row : typeRelationsMapper.listTypeRelations(gameId)) {
            typeRelations.add(mapTypeRelationRow(row));
        }
        bundle.set("typeRelations", typeRelations);

        ArrayNode heroes = objectMapper.createArrayNode();
        for (Map<String, Object> row : heroesMapper.listHeroes(gameId)) {
            heroes.add(mapHeroRow(row));
        }
        bundle.set("heroes", heroes);

        ArrayNode skills = objectMapper.createArrayNode();
        for (Map<String, Object> row : skillsMapper.listSkills(gameId)) {
            skills.add(mapSkillRow(row));
        }
        bundle.set("skills", skills);

        ArrayNode skillMounts = objectMapper.createArrayNode();
        for (Map<String, Object> row : skillMountsMapper.listSkillMounts(gameId)) {
            skillMounts.add(mapSkillMountRow(row));
        }
        bundle.set("skillMounts", skillMounts);

        ArrayNode items = objectMapper.createArrayNode();
        Map<String, ArrayNode> statModifiersByItemId = loadItemStatModifiersByItemId(gameId);
        for (Map<String, Object> row : itemsMapper.listItems(gameId)) {
            items.add(mapItemRow(row, statModifiersByItemId));
        }
        bundle.set("items", items);

        ArrayNode formulaProfiles = objectMapper.createArrayNode();
        for (Map<String, Object> row : formulaProfilesMapper.listFormulaProfiles(gameId)) {
            formulaProfiles.add(mapFormulaProfileRow(row));
        }
        bundle.set("formulaProfiles", formulaProfiles);

        ArrayNode formulaBindings = objectMapper.createArrayNode();
        for (Map<String, Object> row : formulaBindingsMapper.listFormulaBindings(gameId)) {
            formulaBindings.add(mapFormulaBindingRow(row));
        }
        bundle.set("formulaBindings", formulaBindings);

        ArrayNode statusActionControlRules = objectMapper.createArrayNode();
        for (Map<String, Object> row : statusActionControlRulesMapper.listStatusActionControlRules(gameId)) {
            statusActionControlRules.add(mapStatusActionControlRuleRow(row));
        }
        bundle.set("statusActionControlRules", statusActionControlRules);

        ArrayNode statusDefinitions = objectMapper.createArrayNode();
        for (Map<String, Object> row : statusDefinitionsMapper.listStatusDefinitions(gameId)) {
            statusDefinitions.add(mapStatusDefinitionRow(row));
        }
        bundle.set("statusDefinitions", statusDefinitions);

        ArrayNode controlStateProfiles = objectMapper.createArrayNode();
        for (Map<String, Object> row : controlStateProfilesMapper.listControlStateProfiles(gameId)) {
            controlStateProfiles.add(mapControlStateProfileRow(row));
        }
        bundle.set("controlStateProfiles", controlStateProfiles);

        ArrayNode statusModifierGroups = objectMapper.createArrayNode();
        for (Map<String, Object> row : statusModifierGroupsMapper.listStatusModifierGroups(gameId)) {
            statusModifierGroups.add(mapStatusModifierGroupRow(row));
        }
        bundle.set("statusModifierGroups", statusModifierGroups);

        ArrayNode statusAttributeModifiers = objectMapper.createArrayNode();
        for (Map<String, Object> row : statusAttributeModifiersMapper.listStatusAttributeModifiers(gameId)) {
            statusAttributeModifiers.add(mapStatusAttributeModifierRow(row));
        }
        bundle.set("statusAttributeModifiers", statusAttributeModifiers);

        ArrayNode statusPeriodicHpEffects = objectMapper.createArrayNode();
        for (Map<String, Object> row : statusPeriodicHpEffectsMapper.listStatusPeriodicHpEffects(gameId)) {
            statusPeriodicHpEffects.add(mapStatusPeriodicHpEffectRow(row));
        }
        bundle.set("statusPeriodicHpEffects", statusPeriodicHpEffects);

        ObjectNode dictionaries = objectMapper.createObjectNode();
        ObjectNode attrKeyToName = dictionaries.putObject("attrKeyToName");
        for (JsonNode node : attributeDefinitions) {
            String attrName = node.path("attrName").asText("");
            if (!attrName.isBlank()) {
                attrKeyToName.put(node.path("attrKey").asText(), attrName);
            }
        }

        ObjectNode typeIdToName = dictionaries.putObject("typeIdToName");
        for (JsonNode node : types) {
            String typeName = node.path("name").asText("");
            if (!typeName.isBlank()) {
                typeIdToName.put(Integer.toString(node.path("typeId").asInt()), typeName);
            }
        }

        if (attrKeyToName.size() > 0 || typeIdToName.size() > 0) {
            bundle.set("dictionaries", dictionaries);
        }
        return bundle;
    }

    public ObjectNode getPublishedBundleSnapshot(String gameId, String versionCode) {
        String raw = publishedBundleSnapshotsMapper.findBundleSnapshotJson(gameId, versionCode);
        if (raw == null || raw.isBlank()) {
            return null;
        }
        JsonNode node = jsonSupport.parseJsonOrNull(raw, "/bundle");
        if (node == null || !node.isObject()) {
            return null;
        }
        return (ObjectNode) node;
    }

    public ObjectNode loadHero(String gameId, String heroId) {
        return querySingleNode(heroesMapper.findHeroById(gameId, heroId), this::mapHeroRow);
    }

    public ObjectNode loadSkill(String gameId, String skillId) {
        return querySingleNode(skillsMapper.findSkillById(gameId, skillId), this::mapSkillRow);
    }

    public ObjectNode loadSkillMount(String gameId, String targetCategory, String targetId, String skillId) {
        return querySingleNode(
            skillMountsMapper.findSkillMountByNaturalKey(gameId, targetCategory, targetId, skillId),
            this::mapSkillMountRow
        );
    }

    public ObjectNode loadItem(String gameId, String itemId) {
        Map<String, Object> row = itemsMapper.findItemById(gameId, itemId);
        if (row == null) {
            return null;
        }
        return mapItemRow(row, loadItemStatModifiersByItemId(gameId));
    }

    public ObjectNode loadFormulaProfile(String gameId, String formulaId) {
        return querySingleNode(formulaProfilesMapper.findFormulaProfileById(gameId, formulaId), this::mapFormulaProfileRow);
    }

    public ObjectNode loadFormulaBinding(String gameId, String targetCategory, String targetId, String bindingKey) {
        return querySingleNode(
            formulaBindingsMapper.findFormulaBindingById(gameId, targetCategory, targetId, bindingKey),
            this::mapFormulaBindingRow
        );
    }

    public ObjectNode loadCoefficientBucket(String gameId, String bucketKey) {
        return querySingleNode(
            coefficientBucketsMapper.findCoefficientBucketById(gameId, bucketKey),
            this::mapCoefficientBucketRow
        );
    }

    public ObjectNode loadStatusActionControlRule(String gameId, String ruleId) {
        return querySingleNode(
            statusActionControlRulesMapper.findStatusActionControlRuleById(gameId, ruleId),
            this::mapStatusActionControlRuleRow
        );
    }

    public ObjectNode loadStatusDefinition(String gameId, String statusId) {
        return querySingleNode(
            statusDefinitionsMapper.findStatusDefinitionById(gameId, statusId),
            this::mapStatusDefinitionRow
        );
    }

    public ObjectNode loadControlStateProfile(String gameId, String controlProfileId) {
        return querySingleNode(
            controlStateProfilesMapper.findControlStateProfileById(gameId, controlProfileId),
            this::mapControlStateProfileRow
        );
    }

    public ObjectNode loadStatusModifierGroup(String gameId, String statusId, String groupKey) {
        return querySingleNode(
            statusModifierGroupsMapper.findStatusModifierGroupById(gameId, statusId, groupKey),
            this::mapStatusModifierGroupRow
        );
    }

    public ObjectNode loadStatusAttributeModifier(String gameId, String statusId, String groupKey, String modifierId) {
        return querySingleNode(
            statusAttributeModifiersMapper.findStatusAttributeModifierById(gameId, statusId, groupKey, modifierId),
            this::mapStatusAttributeModifierRow
        );
    }

    public ObjectNode loadStatusPeriodicHpEffect(String gameId, String statusId, String groupKey, String effectId) {
        return querySingleNode(
            statusPeriodicHpEffectsMapper.findStatusPeriodicHpEffectById(gameId, statusId, groupKey, effectId),
            this::mapStatusPeriodicHpEffectRow
        );
    }

    public ObjectNode loadAttributeDefinition(String gameId, String attrKey) {
        return querySingleNode(attributeDefinitionsMapper.findAttributeDefinitionById(gameId, attrKey), this::mapAttributeDefinitionRow);
    }

    public ObjectNode loadType(String gameId, int typeId) {
        return querySingleNode(typesMapper.findTypeById(gameId, typeId), this::mapTypeRow);
    }

    public ObjectNode loadTypeRelation(String gameId, int typeId, String targetCategory, String targetId) {
        return querySingleNode(
            typeRelationsMapper.findTypeRelationById(gameId, typeId, targetCategory, targetId),
            this::mapTypeRelationRow
        );
    }

    public ObjectNode loadImage(String gameId, String uri) {
        return querySingleNode(imagesMapper.findImageByUri(gameId, uri), this::mapImageRow);
    }

    private ObjectNode querySingleNode(Map<String, Object> row, SqlNodeMapper nodeMapper) {
        return row == null ? null : nodeMapper.map(row);
    }

    private ObjectNode mapHeroRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("heroId", text(row, "heroId"));
        node.put("name", text(row, "name"));
        putNullableText(node, "title", text(row, "title"));
        putNullableText(node, "avatarUrl", text(row, "avatarUrl"));
        node.set("baseStats", jsonSupport.parseJsonObject(text(row, "baseStatsJson"), "/baseStats"));
        JsonNode statsByLevel = jsonSupport.parseJsonOrNull(text(row, "statsByLevelJson"), "/statsByLevel");
        if (statsByLevel != null) {
            node.set("statsByLevel", statsByLevel);
        }
        return node;
    }

    private ObjectNode mapSkillRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("skillId", text(row, "skillId"));
        String ownerType = text(row, "ownerType");
        if (ownerType == null) {
            node.putNull("ownerType");
        } else {
            node.put("ownerType", ownerType);
        }
        String ownerId = text(row, "ownerId");
        if (ownerId == null) {
            node.putNull("ownerId");
        } else {
            node.put("ownerId", ownerId);
        }
        putNullableText(node, "skillKey", text(row, "skillKey"));
        putNullableText(node, "name", text(row, "name"));
        putNullableText(node, "description", text(row, "description"));
        JsonNode resourceCosts = jsonSupport.parseJsonOrNull(text(row, "resourceCostsJson"), "/resourceCosts");
        if (resourceCosts != null) {
            node.set("resourceCosts", resourceCosts);
        }
        JsonNode cooldowns = jsonSupport.parseJsonOrNull(text(row, "cooldownsJson"), "/cooldowns");
        if (cooldowns != null) {
            node.set("cooldowns", cooldowns);
        }
        JsonNode params = jsonSupport.parseJsonOrNull(text(row, "paramsJson"), "/params");
        if (params != null) {
            node.set("params", params);
        }
        JsonNode timingProfile = jsonSupport.parseJsonOrNull(text(row, "timingProfileJson"), "/timingProfile");
        if (timingProfile != null) {
            node.set("timingProfile", timingProfile);
        }
        node.set("mechanicsConfig", jsonSupport.parseJsonObject(text(row, "mechanicsConfigJson"), "/mechanicsConfig"));
        return node;
    }

    private ObjectNode mapItemRow(Map<String, Object> row, Map<String, ArrayNode> statModifiersByItemId) {
        ObjectNode node = objectMapper.createObjectNode();
        String itemId = text(row, "itemId");
        node.put("itemId", itemId);
        putNullableText(node, "name", text(row, "name"));
        Integer goldCost = integer(row, "goldCost");
        if (goldCost != null) {
            node.put("goldCost", goldCost);
        }
        putNullableText(node, "iconUrl", text(row, "iconUrl"));
        ArrayNode statModifiers = statModifiersByItemId.get(itemId);
        node.set("statModifiers", statModifiers == null ? objectMapper.createArrayNode() : statModifiers.deepCopy());
        putNullableJson(node, "skillRefs", text(row, "skillRefsJson"));
        putNullableJson(node, "recipeIds", text(row, "recipeIdsJson"));
        return node;
    }

    private Map<String, ArrayNode> loadItemStatModifiersByItemId(String gameId) {
        Map<String, ArrayNode> result = new java.util.LinkedHashMap<>();
        for (Map<String, Object> row : itemStatModifiersMapper.listItemStatModifiers(gameId)) {
            String itemId = text(row, "itemId");
            if (itemId == null || itemId.isBlank()) {
                continue;
            }
            ArrayNode statModifiers = result.computeIfAbsent(itemId, unused -> objectMapper.createArrayNode());
            ObjectNode modifier = objectMapper.createObjectNode();
            modifier.put("attrKey", text(row, "attrKey"));
            BigDecimal value = decimal(row, "value");
            modifier.put("value", value == null ? BigDecimal.ZERO : value);
            statModifiers.add(modifier);
        }
        return result;
    }

    private ObjectNode mapFormulaProfileRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("formulaId", text(row, "formulaId"));
        node.put("formulaType", text(row, "formulaType"));
        node.put("formulaKind", text(row, "formulaKind"));
        node.set("params", jsonSupport.parseJsonObject(text(row, "paramsJson"), "/params"));
        putNullableText(node, "description", text(row, "description"));
        return node;
    }

    private ObjectNode mapSkillMountRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("targetCategory", text(row, "targetCategory"));
        node.put("targetId", text(row, "targetId"));
        node.put("skillId", text(row, "skillId"));
        Boolean enabled = booleanValue(row, "enabled");
        node.put("enabled", enabled == null || enabled);
        putNullableJson(node, "extend", text(row, "extendJson"));
        if (!node.has("extend")) {
            node.set("extend", objectMapper.createObjectNode());
        }
        return node;
    }

    private ObjectNode mapFormulaBindingRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("targetCategory", text(row, "targetCategory"));
        node.put("targetId", text(row, "targetId"));
        node.put("bindingKey", text(row, "bindingKey"));
        node.put("formulaId", text(row, "formulaId"));
        putNullableJson(node, "overrideParams", text(row, "overrideParamsJson"));
        return node;
    }

    private ObjectNode mapCoefficientBucketRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("bucketKey", text(row, "bucketKey"));
        node.put("resolutionDomain", text(row, "resolutionDomain"));
        node.put("stageKey", text(row, "stageKey"));
        putNullableText(node, "targetAttrKey", text(row, "targetAttrKey"));
        node.put("aggregationMode", text(row, "aggregationMode"));
        Boolean provisional = booleanValue(row, "provisional");
        if (provisional != null) {
            node.put("provisional", provisional);
        }
        putNullableText(node, "name", text(row, "name"));
        putNullableText(node, "description", text(row, "description"));
        JsonNode editorHint = jsonSupport.parseJsonOrNull(text(row, "editorHintJson"), "/editorHint");
        if (editorHint != null) {
            node.set("editorHint", editorHint);
        }
        JsonNode bucketConfig = jsonSupport.parseJsonOrNull(text(row, "bucketConfigJson"), "/bucketConfig");
        if (bucketConfig != null) {
            node.set("bucketConfig", bucketConfig);
        }
        return node;
    }

    private ObjectNode mapStatusActionControlRuleRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("ruleId", text(row, "ruleId"));
        Integer statusTypeId = integer(row, "statusTypeId");
        node.put("statusTypeId", statusTypeId == null ? -1 : statusTypeId);
        node.put("ruleKind", text(row, "ruleKind"));
        JsonNode actionTypeIds = jsonSupport.parseJsonOrNull(text(row, "actionTypeIdsJson"), "/actionTypeIds");
        node.set("actionTypeIds", actionTypeIds == null ? objectMapper.createArrayNode() : actionTypeIds);
        JsonNode actionMatchTypeIds = jsonSupport.parseJsonOrNull(text(row, "actionMatchTypeIdsJson"), "/actionMatchTypeIds");
        node.set("actionMatchTypeIds", actionMatchTypeIds == null ? objectMapper.createArrayNode() : actionMatchTypeIds);
        JsonNode interruptPhaseTypeIds = jsonSupport.parseJsonOrNull(text(row, "interruptPhaseTypeIdsJson"), "/interruptPhaseTypeIds");
        node.set("interruptPhaseTypeIds", interruptPhaseTypeIds == null ? objectMapper.createArrayNode() : interruptPhaseTypeIds);
        Integer priority = integer(row, "priority");
        if (priority != null) {
            node.put("priority", priority);
        }
        putNullableText(node, "description", text(row, "description"));
        JsonNode extend = jsonSupport.parseJsonOrNull(text(row, "extendJson"), "/extend");
        if (extend != null) {
            node.set("extend", extend);
        }
        return node;
    }

    private ObjectNode mapStatusDefinitionRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("statusId", text(row, "statusId"));
        node.put("name", text(row, "name"));
        putNullableText(node, "description", text(row, "description"));
        node.put("statusKind", text(row, "statusKind"));
        Integer statusTypeId = integer(row, "statusTypeId");
        if (statusTypeId != null) {
            node.put("statusTypeId", statusTypeId);
        }
        putNullableText(node, "controlProfileId", text(row, "controlProfileId"));
        node.put("stackGroupKey", text(row, "stackGroupKey"));
        node.put("sourceScope", text(row, "sourceScope"));
        node.put("stackMode", text(row, "stackMode"));
        Integer maxStacks = integer(row, "maxStacks");
        if (maxStacks != null) {
            node.put("maxStacks", maxStacks);
        }
        Integer maxInstances = integer(row, "maxInstances");
        if (maxInstances != null) {
            node.put("maxInstances", maxInstances);
        }
        node.put("durationMode", text(row, "durationMode"));
        Integer durationMs = integer(row, "durationMs");
        if (durationMs != null) {
            node.put("durationMs", durationMs);
        }
        putNullableText(node, "durationFormulaId", text(row, "durationFormulaId"));
        putNullableText(node, "defaultMagnitudeFormulaId", text(row, "defaultMagnitudeFormulaId"));
        node.put("snapshotPolicy", text(row, "snapshotPolicy"));
        Boolean dispellable = booleanValue(row, "isDispellable");
        if (dispellable != null) {
            node.put("isDispellable", dispellable);
        }
        Integer cleansePriority = integer(row, "cleansePriority");
        if (cleansePriority != null) {
            node.put("cleansePriority", cleansePriority);
        }
        putNullableJson(node, "extend", text(row, "extendJson"));
        return node;
    }

    private ObjectNode mapControlStateProfileRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("controlProfileId", text(row, "controlProfileId"));
        node.put("name", text(row, "name"));
        putNullableText(node, "description", text(row, "description"));
        node.put("controlKind", text(row, "controlKind"));
        node.put("movementLockMode", text(row, "movementLockMode"));
        node.put("castLockMode", text(row, "castLockMode"));
        node.put("attackLockMode", text(row, "attackLockMode"));
        node.put("inputOverrideMode", text(row, "inputOverrideMode"));
        node.put("displacementKind", text(row, "displacementKind"));
        Boolean blocksControlInput = booleanValue(row, "blocksControlInput");
        if (blocksControlInput != null) {
            node.put("blocksControlInput", blocksControlInput);
        }
        Boolean grantsUnstoppable = booleanValue(row, "grantsUnstoppable");
        if (grantsUnstoppable != null) {
            node.put("grantsUnstoppable", grantsUnstoppable);
        }
        Boolean breaksOnDamage = booleanValue(row, "breaksOnDamage");
        if (breaksOnDamage != null) {
            node.put("breaksOnDamage", breaksOnDamage);
        }
        Boolean tenacityReducible = booleanValue(row, "tenacityReducible");
        if (tenacityReducible != null) {
            node.put("tenacityReducible", tenacityReducible);
        }
        Integer priority = integer(row, "priority");
        if (priority != null) {
            node.put("priority", priority);
        }
        putNullableJson(node, "extend", text(row, "extendJson"));
        return node;
    }

    private ObjectNode mapStatusModifierGroupRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("statusId", text(row, "statusId"));
        node.put("groupKey", text(row, "groupKey"));
        putNullableText(node, "groupName", text(row, "groupName"));
        node.put("phaseKey", text(row, "phaseKey"));
        node.put("snapshotPolicy", text(row, "snapshotPolicy"));
        Integer intervalMs = integer(row, "intervalMs");
        if (intervalMs != null) {
            node.put("intervalMs", intervalMs);
        }
        Integer maxTicks = integer(row, "maxTicks");
        if (maxTicks != null) {
            node.put("maxTicks", maxTicks);
        }
        Integer priority = integer(row, "priority");
        if (priority != null) {
            node.put("priority", priority);
        }
        putNullableJson(node, "extend", text(row, "extendJson"));
        return node;
    }

    private ObjectNode mapStatusAttributeModifierRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("statusId", text(row, "statusId"));
        node.put("groupKey", text(row, "groupKey"));
        node.put("modifierId", text(row, "modifierId"));
        node.put("attrKey", text(row, "attrKey"));
        node.put("modifierMode", text(row, "modifierMode"));
        BigDecimal value = decimal(row, "value");
        if (value != null) {
            node.put("value", value);
        }
        putNullableText(node, "formulaId", text(row, "formulaId"));
        putNullableText(node, "bucketKey", text(row, "bucketKey"));
        Boolean perStack = booleanValue(row, "perStack");
        if (perStack != null) {
            node.put("perStack", perStack);
        }
        Integer priority = integer(row, "priority");
        if (priority != null) {
            node.put("priority", priority);
        }
        putNullableJson(node, "extend", text(row, "extendJson"));
        return node;
    }

    private ObjectNode mapStatusPeriodicHpEffectRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("statusId", text(row, "statusId"));
        node.put("groupKey", text(row, "groupKey"));
        node.put("effectId", text(row, "effectId"));
        node.put("effectKind", text(row, "effectKind"));
        node.put("tickFormulaId", text(row, "tickFormulaId"));
        putNullableText(node, "damageType", text(row, "damageType"));
        Boolean canCrit = booleanValue(row, "canCrit");
        if (canCrit != null) {
            node.put("canCrit", canCrit);
        }
        Boolean affectedByHealModifier = booleanValue(row, "affectedByHealModifier");
        if (affectedByHealModifier != null) {
            node.put("affectedByHealModifier", affectedByHealModifier);
        }
        Boolean perStack = booleanValue(row, "perStack");
        if (perStack != null) {
            node.put("perStack", perStack);
        }
        putNullableJson(node, "extend", text(row, "extendJson"));
        return node;
    }

    private ObjectNode mapAttributeDefinitionRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("attrKey", text(row, "attrKey"));
        Integer sortOrder = integer(row, "sortOrder");
        node.put("sortOrder", sortOrder == null ? 0 : sortOrder);
        putNullableText(node, "attrName", text(row, "attrName"));
        putNullableText(node, "attrType", text(row, "attrType"));
        BigDecimal defaultValue = decimal(row, "defaultValue");
        if (defaultValue != null) {
            node.putPOJO("defaultValue", defaultValue);
        }
        String valueKind = text(row, "valueKind");
        node.put("valueKind", valueKind == null || valueKind.isBlank() ? "scalar" : valueKind);
        putNullableText(node, "rateTargetAttrKey", text(row, "rateTargetAttrKey"));
        return node;
    }

    private ObjectNode mapTypeRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        Integer typeId = integer(row, "typeId");
        node.put("typeId", typeId == null ? -1 : typeId);
        putNullableText(node, "name", text(row, "name"));
        putNullableText(node, "description", text(row, "description"));
        Integer reservedTypeId = integer(row, "reservedTypeId");
        if (reservedTypeId != null) {
            node.put("reservedTypeId", reservedTypeId);
        }
        return node;
    }

    private ObjectNode mapTypeRelationRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        Integer typeId = integer(row, "typeId");
        node.put("typeId", typeId == null ? -1 : typeId);
        node.put("targetCategory", text(row, "targetCategory"));
        node.put("targetId", text(row, "targetId"));
        JsonNode extend = jsonSupport.parseJsonOrNull(text(row, "extendJson"), "/extend");
        if (extend != null) {
            node.set("extend", extend);
        }
        return node;
    }

    private ObjectNode mapImageRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("uri", text(row, "uri"));
        node.put("imageBase64", text(row, "imageBase64"));
        node.put("updatedAt", jsonSupport.timestampToIso(timestamp(row, "updatedAt")));
        return node;
    }

    private ObjectNode mapOwnerCategoryRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("ownerType", text(row, "ownerType"));
        putNullableText(node, "name", text(row, "name"));
        putNullableText(node, "description", text(row, "description"));
        node.put("updatedAt", jsonSupport.timestampToIso(timestamp(row, "updatedAt")));
        return node;
    }

    private VersionRecord mapVersionRecord(Map<String, Object> row) {
        Long versionId = longValue(row, "versionId");
        Timestamp updatedAt = timestamp(row, "updatedAt");
        Timestamp publishedAt = timestamp(row, "publishedAt");
        java.sql.Date releaseDate = null;
        Object releaseDateValue = value(row, "releaseDate");
        if (releaseDateValue instanceof java.sql.Date sqlDate) {
            releaseDate = sqlDate;
        } else if (releaseDateValue instanceof java.util.Date utilDate) {
            releaseDate = new java.sql.Date(utilDate.getTime());
        }
        return new VersionRecord(
            versionId == null ? -1L : versionId,
            text(row, "versionCode"),
            releaseDate == null ? null : releaseDate.toLocalDate(),
            updatedAt == null ? Instant.now() : updatedAt.toInstant(),
            publishedAt == null ? null : publishedAt.toInstant()
        );
    }

    private ProgressionSchemaRecord mapProgressionSchemaRecord(Map<String, Object> row) {
        return new ProgressionSchemaRecord(
            text(row, "progressionKind"),
            integer(row, "stageMin"),
            integer(row, "stageMax"),
            text(row, "stageLabel"),
            booleanValue(row, "requireAllStages")
        );
    }

    private ProgressionSchemaRecord defaultProgressionSchemaRecord() {
        return new ProgressionSchemaRecord(
            DEFAULT_PROGRESSION_KIND,
            DEFAULT_STAGE_MIN,
            DEFAULT_STAGE_MAX,
            DEFAULT_STAGE_LABEL,
            DEFAULT_REQUIRE_ALL_STAGES
        );
    }

    private ObjectNode toProgressionSchemaNode(ProgressionSchemaRecord schema) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("progressionKind", schema.progressionKind());
        node.put("stageMin", schema.stageMin());
        node.put("stageMax", schema.stageMax());
        node.put("stageLabel", schema.stageLabel());
        node.put("requireAllStages", schema.requireAllStages());
        return node;
    }

    private void putNullableText(ObjectNode node, String fieldName, String value) {
        if (value != null) {
            node.put(fieldName, value);
        }
    }

    private void putNullableJson(ObjectNode node, String fieldName, String raw) {
        JsonNode value = jsonSupport.parseJsonOrNull(raw, "/" + fieldName);
        if (value != null) {
            node.set(fieldName, value);
        }
    }

    private String text(Map<String, Object> row, String key) {
        Object value = value(row, key);
        return value == null ? null : value.toString();
    }

    private Integer integer(Map<String, Object> row, String key) {
        Object value = value(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        return Integer.parseInt(value.toString());
    }

    private Long longValue(Map<String, Object> row, String key) {
        Object value = value(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        return Long.parseLong(value.toString());
    }

    private BigDecimal decimal(Map<String, Object> row, String key) {
        Object value = value(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal bigDecimal) {
            return bigDecimal;
        }
        if (value instanceof Number number) {
            return new BigDecimal(number.toString());
        }
        return new BigDecimal(value.toString());
    }

    private Boolean booleanValue(Map<String, Object> row, String key) {
        Object value = value(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        return Boolean.parseBoolean(value.toString());
    }

    private Timestamp timestamp(Map<String, Object> row, String key) {
        Object value = value(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp;
        }
        if (value instanceof java.util.Date date) {
            return new Timestamp(date.getTime());
        }
        if (value instanceof Instant instant) {
            return Timestamp.from(instant);
        }
        if (value instanceof LocalDateTime localDateTime) {
            return Timestamp.valueOf(localDateTime);
        }
        return Timestamp.from(Instant.parse(value.toString()));
    }

    private Object value(Map<String, Object> row, String key) {
        if (row.containsKey(key)) {
            return row.get(key);
        }
        String lowerKey = key.toLowerCase(Locale.ROOT);
        if (row.containsKey(lowerKey)) {
            return row.get(lowerKey);
        }
        String snakeKey = camelToSnake(key);
        if (row.containsKey(snakeKey)) {
            return row.get(snakeKey);
        }
        for (Map.Entry<String, Object> entry : row.entrySet()) {
            if (entry.getKey().equalsIgnoreCase(key)) {
                return entry.getValue();
            }
        }
        return null;
    }

    private String camelToSnake(String key) {
        StringBuilder builder = new StringBuilder(key.length() + 4);
        for (int i = 0; i < key.length(); i++) {
            char ch = key.charAt(i);
            if (Character.isUpperCase(ch)) {
                if (i > 0) {
                    builder.append('_');
                }
                builder.append(Character.toLowerCase(ch));
            } else {
                builder.append(ch);
            }
        }
        return builder.toString();
    }

    private interface SqlNodeMapper {
        ObjectNode map(Map<String, Object> row);
    }

    public record VersionRecord(long versionId, String versionCode, java.time.LocalDate releaseDate, Instant updatedAt, Instant publishedAt) {
    }

    public record ProgressionSchemaRecord(
        String progressionKind,
        int stageMin,
        int stageMax,
        String stageLabel,
        boolean requireAllStages
    ) {
    }
}
