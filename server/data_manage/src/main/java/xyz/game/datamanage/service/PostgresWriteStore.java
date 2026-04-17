package xyz.game.datamanage.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.AttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.CoefficientBucketsMapper;
import xyz.game.datamanage.mapper.EditLogMapper;
import xyz.game.datamanage.mapper.FormulaBindingsMapper;
import xyz.game.datamanage.mapper.FormulaProfilesMapper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.GameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.HeroesMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.ItemsMapper;
import xyz.game.datamanage.mapper.OwnerCategoriesMapper;
import xyz.game.datamanage.mapper.PublishedBundleSnapshotsMapper;
import xyz.game.datamanage.mapper.SkillsMapper;
import xyz.game.datamanage.mapper.StatusActionControlRulesMapper;
import xyz.game.datamanage.mapper.TypeRelationsMapper;
import xyz.game.datamanage.mapper.TypesMapper;
import xyz.game.datamanage.support.error.ApiException;

@Component
public class PostgresWriteStore {

    private static final String WORKSPACE_VERSION_CODE = "__workspace__";

    private static final Pattern OWNER_TYPE_PATTERN = Pattern.compile("^[a-z0-9_]+$");
    private static final Set<String> TARGET_CATEGORIES = Set.of("equipment", "attribute", "skill", "character", "type");
    private static final Set<String> ATTRIBUTE_VALUE_KINDS = Set.of("scalar", "ratio", "rate", "flag");
    private static final Set<String> FORMULA_TYPES = Set.of("cooldown", "regen", "attribute", "damage", "resource_cost", "other");
    private static final Set<String> FORMULA_BINDING_TARGET_CATEGORIES = Set.of("skill", "hero", "item", "global");
    private static final Set<String> COEFFICIENT_BUCKET_RESOLUTION_DOMAINS = Set.of("attribute", "hp_change");
    private static final Set<String> COEFFICIENT_BUCKET_AGGREGATION_MODES = Set.of("add", "multiply", "pick_max", "set_final");
    private static final Set<String> STATUS_ACTION_CONTROL_RULE_KINDS = Set.of("forbid", "interrupt");
    private static final Set<String> PROGRESSION_KINDS = Set.of("LEVEL", "STAR");

    private final HeroesMapper heroesMapper;
    private final SkillsMapper skillsMapper;
    private final ItemsMapper itemsMapper;
    private final FormulaProfilesMapper formulaProfilesMapper;
    private final FormulaBindingsMapper formulaBindingsMapper;
    private final StatusActionControlRulesMapper statusActionControlRulesMapper;
    private final CoefficientBucketsMapper coefficientBucketsMapper;
    private final AttributeDefinitionsMapper attributeDefinitionsMapper;
    private final TypesMapper typesMapper;
    private final TypeRelationsMapper typeRelationsMapper;
    private final ImagesMapper imagesMapper;
    private final OwnerCategoriesMapper ownerCategoriesMapper;
    private final PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper;
    private final GamesMapper gamesMapper;
    private final GameProgressionSchemaMapper gameProgressionSchemaMapper;
    private final GameVersionsMapper gameVersionsMapper;
    private final EditLogMapper editLogMapper;
    private final ObjectMapper objectMapper;
    private final PostgresReadStore readStore;
    private final PostgresJsonSupport jsonSupport;
    private final Set<String> ensuredPartitionGames = ConcurrentHashMap.newKeySet();

    public PostgresWriteStore(
        HeroesMapper heroesMapper,
        SkillsMapper skillsMapper,
        ItemsMapper itemsMapper,
        FormulaProfilesMapper formulaProfilesMapper,
        FormulaBindingsMapper formulaBindingsMapper,
        StatusActionControlRulesMapper statusActionControlRulesMapper,
        CoefficientBucketsMapper coefficientBucketsMapper,
        AttributeDefinitionsMapper attributeDefinitionsMapper,
        TypesMapper typesMapper,
        TypeRelationsMapper typeRelationsMapper,
        ImagesMapper imagesMapper,
        OwnerCategoriesMapper ownerCategoriesMapper,
        PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper,
        GamesMapper gamesMapper,
        GameProgressionSchemaMapper gameProgressionSchemaMapper,
        GameVersionsMapper gameVersionsMapper,
        EditLogMapper editLogMapper,
        ObjectMapper objectMapper,
        PostgresReadStore readStore,
        PostgresJsonSupport jsonSupport
    ) {
        this.heroesMapper = heroesMapper;
        this.skillsMapper = skillsMapper;
        this.itemsMapper = itemsMapper;
        this.formulaProfilesMapper = formulaProfilesMapper;
        this.formulaBindingsMapper = formulaBindingsMapper;
        this.statusActionControlRulesMapper = statusActionControlRulesMapper;
        this.coefficientBucketsMapper = coefficientBucketsMapper;
        this.attributeDefinitionsMapper = attributeDefinitionsMapper;
        this.typesMapper = typesMapper;
        this.typeRelationsMapper = typeRelationsMapper;
        this.imagesMapper = imagesMapper;
        this.ownerCategoriesMapper = ownerCategoriesMapper;
        this.publishedBundleSnapshotsMapper = publishedBundleSnapshotsMapper;
        this.gamesMapper = gamesMapper;
        this.gameProgressionSchemaMapper = gameProgressionSchemaMapper;
        this.gameVersionsMapper = gameVersionsMapper;
        this.editLogMapper = editLogMapper;
        this.objectMapper = objectMapper;
        this.readStore = readStore;
        this.jsonSupport = jsonSupport;
    }

    @Transactional
    public ObjectNode upsertHero(String gameId, String heroId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "heroId", heroId);
        jsonSupport.requireText(merged, "name", "hero");
        JsonNode baseStats = merged.get("baseStats");
        if (baseStats == null || !baseStats.isObject()) {
            throw badRequest("hero.baseStats is required and must be object", Map.of("path", "/baseStats"));
        }
        validateHeroStatsByLevelAgainstSchema(gameId, merged);

        long versionId = resolveVersionIdForWrite(gameId);
        heroesMapper.upsertHero(
            gameId,
            heroId,
            versionId,
            merged.path("name").asText(),
            nullableText(merged, "title"),
            nullableText(merged, "avatarUrl"),
            jsonSupport.toJsonString(merged.get("baseStats"), "/baseStats"),
            jsonSupport.toJsonStringOrNull(merged.get("statsByLevel"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertProgressionSchema(String gameId, ObjectNode body) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        String progressionKindRaw = requireTextField(body, "progressionKind", "/progressionKind");
        String progressionKind = progressionKindRaw.toUpperCase(Locale.ROOT);
        if (!PROGRESSION_KINDS.contains(progressionKind)) {
            throw badRequest("progressionSchema.progressionKind invalid", Map.of("path", "/progressionKind"));
        }

        int stageMin = requireIntegerField(body, "stageMin", "/stageMin");
        if (stageMin < 1) {
            throw badRequest("progressionSchema.stageMin must be >= 1", Map.of("path", "/stageMin"));
        }

        int stageMax = requireIntegerField(body, "stageMax", "/stageMax");
        if (stageMax < stageMin) {
            throw badRequest("progressionSchema.stageMax must be >= stageMin", Map.of("path", "/stageMax"));
        }
        if (stageMax > 100) {
            throw badRequest("progressionSchema.stageMax must be <= 100", Map.of("path", "/stageMax"));
        }

        String stageLabel = requireTextField(body, "stageLabel", "/stageLabel");

        JsonNode requireAllStagesNode = body.get("requireAllStages");
        if (requireAllStagesNode == null || !requireAllStagesNode.isBoolean()) {
            throw badRequest("progressionSchema.requireAllStages must be boolean", Map.of("path", "/requireAllStages"));
        }
        boolean requireAllStages = requireAllStagesNode.asBoolean();

        gameProgressionSchemaMapper.upsert(gameId, progressionKind, stageMin, stageMax, stageLabel, requireAllStages);

        ObjectNode response = objectMapper.createObjectNode();
        response.put("progressionKind", progressionKind);
        response.put("stageMin", stageMin);
        response.put("stageMax", stageMax);
        response.put("stageLabel", stageLabel);
        response.put("requireAllStages", requireAllStages);
        return response;
    }

    @Transactional
    public ObjectNode upsertSkill(String gameId, String skillId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "skillId", skillId);
        String ownerType = jsonSupport.requireText(merged, "ownerType", "skill");
        if (!OWNER_TYPE_PATTERN.matcher(ownerType).matches()) {
            throw badRequest("skill.ownerType format invalid", Map.of("path", "/ownerType"));
        }
        if (!ownerTypeExists(gameId, ownerType)) {
            throw semantic("skill.ownerType not registered", Map.of("path", "/ownerType", "ownerType", ownerType));
        }
        String ownerId = jsonSupport.requireText(merged, "ownerId", "skill");
        if ("hero".equals(ownerType) && readStore.loadHero(gameId, ownerId) == null) {
            throw semantic("skill.ownerId hero not found", Map.of("path", "/ownerId", "ownerId", ownerId));
        }
        if ("item".equals(ownerType) && readStore.loadItem(gameId, ownerId) == null) {
            throw semantic("skill.ownerId item not found", Map.of("path", "/ownerId", "ownerId", ownerId));
        }

        JsonNode mechanicsConfig = merged.get("mechanicsConfig");
        if (mechanicsConfig == null || !mechanicsConfig.isObject()) {
            throw badRequest("skill.mechanicsConfig is required and must be object", Map.of("path", "/mechanicsConfig"));
        }
        validateOptionalObject(merged, "skill", "params", "/params");
        validateOptionalObject(merged, "skill", "timingProfile", "/timingProfile");
        validateMechanicsConfig((ObjectNode) mechanicsConfig);

        long versionId = resolveVersionIdForWrite(gameId);
        skillsMapper.upsertSkill(
            gameId,
            skillId,
            versionId,
            ownerId,
            ownerType,
            nullableText(merged, "skillKey"),
            nullableText(merged, "name"),
            nullableText(merged, "description"),
            jsonSupport.toJsonStringOrNull(merged.get("resourceCosts")),
            jsonSupport.toJsonStringOrNull(merged.get("cooldowns")),
            jsonSupport.toJsonStringOrNull(merged.get("params")),
            jsonSupport.toJsonStringOrNull(merged.get("timingProfile")),
            jsonSupport.toJsonString(merged.get("mechanicsConfig"), "/mechanicsConfig")
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertItem(String gameId, String itemId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "itemId", itemId);
        validateItemRefs(gameId, merged);

        long versionId = resolveVersionIdForWrite(gameId);
        itemsMapper.upsertItem(
            gameId,
            itemId,
            versionId,
            nullableText(merged, "name"),
            nullableInteger(merged, "goldCost"),
            nullableText(merged, "iconUrl"),
            jsonSupport.toJsonStringOrNull(merged.get("statsModifier")),
            jsonSupport.toJsonStringOrNull(merged.get("skillRefs")),
            jsonSupport.toJsonStringOrNull(merged.get("recipeIds"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertFormulaProfile(String gameId, String formulaId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "formulaId", formulaId);
        String formulaType = jsonSupport.requireText(merged, "formulaType", "formulaProfile").toLowerCase(Locale.ROOT);
        if (!FORMULA_TYPES.contains(formulaType)) {
            throw badRequest("formulaProfile.formulaType invalid", Map.of("path", "/formulaType", "formulaType", formulaType));
        }
        String formulaKind = jsonSupport.requireText(merged, "formulaKind", "formulaProfile");
        JsonNode params = merged.get("params");
        if (params == null || params.isNull()) {
            params = objectMapper.createObjectNode();
            merged.set("params", params);
        }
        if (!params.isObject()) {
            throw badRequest("formulaProfile.params must be object", Map.of("path", "/params"));
        }
        merged.put("formulaType", formulaType);

        long versionId = resolveVersionIdForWrite(gameId);
        formulaProfilesMapper.upsertFormulaProfile(
            gameId,
            formulaId,
            versionId,
            formulaType,
            formulaKind,
            jsonSupport.toJsonString(params, "/params"),
            nullableText(merged, "description")
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertFormulaBinding(
        String gameId,
        String targetCategory,
        String targetId,
        String bindingKey,
        ObjectNode body
    ) {
        String normalizedTargetCategory = targetCategory == null ? "" : targetCategory.toLowerCase(Locale.ROOT);
        ObjectNode merged = mergeUpsert(body, "bindingKey", bindingKey);
        merged.put("targetCategory", normalizedTargetCategory);
        merged.put("targetId", targetId);
        merged.put("bindingKey", bindingKey);
        validateFormulaBindingTarget(gameId, merged);
        String formulaId = jsonSupport.requireText(merged, "formulaId", "formulaBinding");
        if (readStore.loadFormulaProfile(gameId, formulaId) == null) {
            throw semantic("formulaBinding.formulaId not found", Map.of("path", "/formulaId", "formulaId", formulaId));
        }
        validateOptionalObject(merged, "formulaBinding", "overrideParams", "/overrideParams");

        long versionId = resolveVersionIdForWrite(gameId);
        formulaBindingsMapper.upsertFormulaBinding(
            gameId,
            normalizedTargetCategory,
            targetId,
            bindingKey,
            versionId,
            formulaId,
            jsonSupport.toJsonStringOrNull(merged.get("overrideParams"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertCoefficientBucket(String gameId, String bucketKey, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "bucketKey", bucketKey);

        String resolutionDomain = jsonSupport.requireText(merged, "resolutionDomain", "coefficientBucket").toLowerCase(Locale.ROOT);
        if (!COEFFICIENT_BUCKET_RESOLUTION_DOMAINS.contains(resolutionDomain)) {
            throw badRequest("coefficientBucket.resolutionDomain invalid", Map.of("path", "/resolutionDomain", "resolutionDomain", resolutionDomain));
        }
        merged.put("resolutionDomain", resolutionDomain);

        String stageKey = jsonSupport.requireText(merged, "stageKey", "coefficientBucket");
        String aggregationMode = jsonSupport.requireText(merged, "aggregationMode", "coefficientBucket").toLowerCase(Locale.ROOT);
        if (!COEFFICIENT_BUCKET_AGGREGATION_MODES.contains(aggregationMode)) {
            throw badRequest("coefficientBucket.aggregationMode invalid", Map.of("path", "/aggregationMode", "aggregationMode", aggregationMode));
        }
        merged.put("aggregationMode", aggregationMode);

        String targetAttrKey = nullableText(merged, "targetAttrKey");
        if ("attribute".equals(resolutionDomain)) {
            if (targetAttrKey == null || targetAttrKey.isBlank()) {
                throw badRequest("coefficientBucket.targetAttrKey is required when resolutionDomain=attribute", Map.of("path", "/targetAttrKey"));
            }
            if (readStore.loadAttributeDefinition(gameId, targetAttrKey) == null) {
                throw semantic(
                    "coefficientBucket.targetAttrKey not found",
                    Map.of("path", "/targetAttrKey", "targetAttrKey", targetAttrKey)
                );
            }
        } else if (targetAttrKey != null) {
            throw badRequest("coefficientBucket.targetAttrKey must be null when resolutionDomain=hp_change", Map.of("path", "/targetAttrKey"));
        }

        Boolean provisional = nullableBoolean(merged, "provisional");
        if (provisional == null) {
            provisional = false;
            merged.put("provisional", false);
        }

        validateOptionalText(merged, "name", "/name");
        validateOptionalText(merged, "description", "/description");
        validateOptionalObject(merged, "coefficientBucket", "editorHint", "/editorHint");
        validateOptionalObject(merged, "coefficientBucket", "bucketConfig", "/bucketConfig");

        long versionId = resolveVersionIdForWrite(gameId);
        coefficientBucketsMapper.upsertCoefficientBucket(
            gameId,
            bucketKey,
            versionId,
            resolutionDomain,
            stageKey,
            targetAttrKey,
            aggregationMode,
            provisional,
            nullableText(merged, "name"),
            nullableText(merged, "description"),
            jsonSupport.toJsonStringOrNull(merged.get("editorHint")),
            jsonSupport.toJsonStringOrNull(merged.get("bucketConfig"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertStatusActionControlRule(String gameId, String ruleId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "ruleId", ruleId);

        int statusTypeId = requireExistingTypeId(gameId, merged.get("statusTypeId"), "/statusTypeId", "statusActionControlRule.statusTypeId");
        String ruleKind = jsonSupport.requireText(merged, "ruleKind", "statusActionControlRule").toLowerCase(Locale.ROOT);
        if (!STATUS_ACTION_CONTROL_RULE_KINDS.contains(ruleKind)) {
            throw badRequest("statusActionControlRule.ruleKind invalid", Map.of("path", "/ruleKind", "ruleKind", ruleKind));
        }
        merged.put("ruleKind", ruleKind);

        ArrayNode actionTypeIds = requireTypeIdArray(gameId, merged, "actionTypeIds", "/actionTypeIds", false);
        ArrayNode actionMatchTypeIds = requireTypeIdArray(gameId, merged, "actionMatchTypeIds", "/actionMatchTypeIds", true);
        ArrayNode interruptPhaseTypeIds = requireTypeIdArray(gameId, merged, "interruptPhaseTypeIds", "/interruptPhaseTypeIds", true);

        if ("forbid".equals(ruleKind) && interruptPhaseTypeIds.size() > 0) {
            throw badRequest(
                "interruptPhaseTypeIds must be empty when ruleKind=forbid",
                Map.of("path", "/interruptPhaseTypeIds", "ruleKind", ruleKind)
            );
        }
        if ("interrupt".equals(ruleKind) && interruptPhaseTypeIds.isEmpty()) {
            throw badRequest(
                "interruptPhaseTypeIds must be non-empty when ruleKind=interrupt",
                Map.of("path", "/interruptPhaseTypeIds", "ruleKind", ruleKind)
            );
        }

        Integer priority = nullableInteger(merged, "priority");
        if (priority == null) {
            priority = 0;
            merged.put("priority", priority);
        }
        validateOptionalText(merged, "description", "/description");

        long versionId = resolveVersionIdForWrite(gameId);
        statusActionControlRulesMapper.upsertStatusActionControlRule(
            gameId,
            ruleId,
            versionId,
            statusTypeId,
            ruleKind,
            jsonSupport.toJsonString(actionTypeIds, "/actionTypeIds"),
            jsonSupport.toJsonString(actionMatchTypeIds, "/actionMatchTypeIds"),
            jsonSupport.toJsonString(interruptPhaseTypeIds, "/interruptPhaseTypeIds"),
            priority,
            nullableText(merged, "description"),
            jsonSupport.toJsonStringOrNull(merged.get("extend"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertAttributeDefinition(String gameId, String attrKey, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "attrKey", attrKey);
        if (merged.has("defaultValue") && !merged.path("defaultValue").isNull() && !merged.path("defaultValue").isNumber()) {
            throw badRequest("attributeDefinition.defaultValue must be number", Map.of("path", "/defaultValue"));
        }
        String valueKind = normalizeAttributeDefinitionValueKind(merged);
        String rateTargetAttrKey = validateAttributeDefinitionRateTarget(gameId, merged, valueKind);

        long versionId = resolveVersionIdForWrite(gameId);
        attributeDefinitionsMapper.upsertAttributeDefinition(
            gameId,
            attrKey,
            versionId,
            nullableText(merged, "attrName"),
            nullableText(merged, "attrType"),
            nullableBigDecimal(merged, "defaultValue"),
            valueKind,
            rateTargetAttrKey
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertType(String gameId, int typeId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "typeId", Integer.toString(typeId));
        merged.put("typeId", typeId);

        long versionId = resolveVersionIdForWrite(gameId);
        typesMapper.upsertType(
            gameId,
            typeId,
            versionId,
            nullableText(merged, "name"),
            nullableText(merged, "description"),
            nullableInteger(merged, "reservedTypeId")
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertTypeRelation(
        String gameId,
        int typeId,
        String targetCategory,
        String targetId,
        ObjectNode body
    ) {
        ObjectNode merged = mergeUpsert(body, "targetId", targetId);
        merged.remove("deleted");
        merged.put("typeId", typeId);
        merged.put("targetCategory", targetCategory);
        merged.put("targetId", targetId);
        validateTypeRelationTarget(gameId, merged);

        long versionId = resolveVersionIdForWrite(gameId);
        boolean hasTypeRelationsDeletedColumn = typeRelationsMapper.hasTypeRelationsDeletedColumn();
        typeRelationsMapper.upsertTypeRelation(
            gameId,
            typeId,
            versionId,
            targetCategory,
            targetId,
            jsonSupport.toJsonStringOrNull(merged.get("extend")),
            false,
            hasTypeRelationsDeletedColumn
        );
        return merged;
    }

    @Transactional
    public ObjectNode replaceTypeRelationsForTarget(
        String gameId,
        String targetCategory,
        String targetId,
        ObjectNode body
    ) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        String normalizedTargetCategory = targetCategory == null ? "" : targetCategory.toLowerCase(Locale.ROOT);
        validateTypeRelationTargetRef(gameId, normalizedTargetCategory, targetId, "/targetId");

        JsonNode relationsNode = body.get("relations");
        if (relationsNode == null || !relationsNode.isArray()) {
            throw badRequest("typeRelationReplace.relations must be array", Map.of("path", "/relations"));
        }

        Map<Integer, ObjectNode> desiredRelationsByTypeId = new LinkedHashMap<>();
        for (int index = 0; index < relationsNode.size(); index++) {
            JsonNode relationNode = relationsNode.get(index);
            if (relationNode == null || !relationNode.isObject()) {
                throw badRequest("typeRelationReplace.relations must contain objects", Map.of("path", "/relations/" + index));
            }

            ObjectNode relation = objectMapper.createObjectNode();
            JsonNode typeIdNode = relationNode.get("typeId");
            if (typeIdNode == null || !typeIdNode.canConvertToInt()) {
                throw badRequest("typeRelationReplace.relations.typeId must be integer", Map.of("path", "/relations/" + index + "/typeId"));
            }
            int relationTypeId = typeIdNode.asInt();
            if (desiredRelationsByTypeId.containsKey(relationTypeId)) {
                throw badRequest(
                    "typeRelationReplace.relations contains duplicate typeId",
                    Map.of("path", "/relations/" + index + "/typeId", "typeId", relationTypeId)
                );
            }

            relation.put("typeId", relationTypeId);
            relation.put("targetCategory", normalizedTargetCategory);
            relation.put("targetId", targetId);
            JsonNode extendNode = relationNode.get("extend");
            if (extendNode != null && !extendNode.isNull()) {
                if (!extendNode.isObject()) {
                    throw badRequest("typeRelationReplace.relations.extend must be object", Map.of("path", "/relations/" + index + "/extend"));
                }
                relation.set("extend", extendNode.deepCopy());
            }
            validateTypeRelationTarget(gameId, relation);
            desiredRelationsByTypeId.put(relationTypeId, relation);
        }

        long versionId = resolveVersionIdForWrite(gameId);
        boolean hasTypeRelationsDeletedColumn = typeRelationsMapper.hasTypeRelationsDeletedColumn();
        List<Map<String, Object>> currentRelations = typeRelationsMapper.listTypeRelationsByTarget(gameId, normalizedTargetCategory, targetId);
        for (Map<String, Object> currentRelation : currentRelations) {
            Integer existingTypeId = mapInteger(currentRelation, "typeId");
            int safeTypeId = existingTypeId == null ? -1 : existingTypeId;
            if (desiredRelationsByTypeId.containsKey(safeTypeId)) {
                continue;
            }
            ensureUpdated(
                typeRelationsMapper.markTypeRelationDeleted(
                    gameId,
                    safeTypeId,
                    normalizedTargetCategory,
                    targetId,
                    versionId,
                    hasTypeRelationsDeletedColumn
                ),
                "typeRelation not found while deleting",
                Map.of("gameId", gameId, "typeId", safeTypeId, "targetCategory", normalizedTargetCategory, "targetId", targetId)
            );
        }

        for (ObjectNode relation : desiredRelationsByTypeId.values()) {
            int relationTypeId = relation.path("typeId").asInt();
            typeRelationsMapper.upsertTypeRelation(
                gameId,
                relationTypeId,
                versionId,
                normalizedTargetCategory,
                targetId,
                jsonSupport.toJsonStringOrNull(relation.get("extend")),
                false,
                hasTypeRelationsDeletedColumn
            );
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        response.put("targetCategory", normalizedTargetCategory);
        response.put("targetId", targetId);
        ArrayNode responseRelations = response.putArray("typeRelations");
        desiredRelationsByTypeId.values()
            .stream()
            .sorted((left, right) -> Integer.compare(left.path("typeId").asInt(), right.path("typeId").asInt()))
            .forEach(responseRelations::add);
        return response;
    }

    @Transactional
    public ObjectNode upsertImage(String gameId, String uri, ObjectNode body) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        ObjectNode merged = objectMapper.createObjectNode();
        mergeObject(merged, body);
        merged.put("uri", uri);
        String imageBase64 = jsonSupport.requireText(merged, "imageBase64", "image");
        if (!imageBase64.startsWith("data:image/") || !imageBase64.contains("base64,")) {
            throw badRequest("imageBase64 must be data URI base64", Map.of("path", "/imageBase64"));
        }

        imagesMapper.upsertImage(gameId, uri, imageBase64);
        ObjectNode stored = readStore.loadImage(gameId, uri);
        return stored == null ? merged : stored;
    }

    @Transactional
    public ObjectNode publishVersion(String gameId, ObjectNode requestBody) {
        ensureGamePartitions(gameId);
        if (requestBody == null || requestBody.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        String versionCode = jsonSupport.requireText(requestBody, "versionCode", "version");
        if (WORKSPACE_VERSION_CODE.equals(versionCode)) {
            throw badRequest("versionCode is reserved", Map.of("path", "/versionCode"));
        }
        LocalDate releaseDate = null;
        if (requestBody.hasNonNull("releaseDate")) {
            try {
                releaseDate = LocalDate.parse(requestBody.path("releaseDate").asText());
            } catch (DateTimeParseException ex) {
                throw badRequest("releaseDate must be ISO date", Map.of("path", "/releaseDate"));
            }
        }
        if (readStore.findVersionByCode(gameId, versionCode) != null) {
            throw conflict("Version code already exists", Map.of("gameId", gameId, "versionCode", versionCode));
        }

        Long versionId;
        try {
            versionId = gameVersionsMapper.createVersion(
                gameId,
                versionCode,
                releaseDate == null ? null : java.sql.Date.valueOf(releaseDate)
            );
        } catch (DataIntegrityViolationException ex) {
            throw conflict("Version code already exists", Map.of("gameId", gameId, "versionCode", versionCode));
        }
        PostgresReadStore.VersionRecord version = readStore.findVersionById(gameId, versionId == null ? -1L : versionId);
        if (version == null) {
            throw notFound("Version not found", Map.of("gameId", gameId, "versionCode", versionCode));
        }

        PostgresReadStore.VersionRecord currentVersion = readStore.findCurrentPublishedVersion(gameId);
        Instant prevPublishedAt = currentVersion == null || currentVersion.publishedAt() == null
            ? Instant.EPOCH
            : currentVersion.publishedAt();
        Timestamp changedAfter = Timestamp.from(prevPublishedAt);

        List<Map<String, Object>> changedAttributeDefinitions = attributeDefinitionsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedTypes = typesMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedTypeRelations = typeRelationsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedHeroes = heroesMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedSkills = skillsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedItems = itemsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedFormulaProfiles = formulaProfilesMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedFormulaBindings = formulaBindingsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedCoefficientBuckets = coefficientBucketsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedStatusActionControlRules = statusActionControlRulesMapper.listChangedSince(gameId, changedAfter);

        Instant publishedAt = Instant.now();
        ObjectNode unsignedBundle = readStore.buildBundle(gameId, version, publishedAt);
        validateBundleForPublish(gameId, unsignedBundle);

        applyVersionProgressAndLog(
            gameId,
            version.versionId(),
            changedAttributeDefinitions,
            changedTypes,
            changedTypeRelations,
            changedHeroes,
            changedSkills,
            changedItems,
            changedFormulaProfiles,
            changedFormulaBindings,
            changedCoefficientBuckets,
            changedStatusActionControlRules
        );

        publishedBundleSnapshotsMapper.upsertBundleSnapshot(
            gameId,
            version.versionId(),
            version.versionCode(),
            serializeBundle(unsignedBundle)
        );
        gameVersionsMapper.clearCurrentVersion(gameId);
        int updatedRows = gameVersionsMapper.markVersionCurrent(Timestamp.from(publishedAt), gameId, version.versionId());
        if (updatedRows == 0) {
            throw notFound("Version not found", Map.of("gameId", gameId, "versionCode", version.versionCode()));
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        response.put("versionCode", version.versionCode());
        if (version.releaseDate() != null) {
            response.put("releaseDate", version.releaseDate().toString());
        }
        response.put("publishedAt", publishedAt.toString());
        response.put("updatedAt", publishedAt.toString());
        return response;
    }

    @Transactional
    public void recordEditLog(String email, String method, String path, JsonNode requestBody, int responseCode) {
        ObjectNode editBody = objectMapper.createObjectNode();
        editBody.put("method", method);
        editBody.put("path", path);
        editBody.put("responseCode", responseCode);
        if (requestBody != null && !requestBody.isNull()) {
            editBody.set("requestBody", requestBody.deepCopy());
        }
        String serialized;
        try {
            serialized = objectMapper.writeValueAsString(editBody);
        } catch (JsonProcessingException ex) {
            serialized = "{\"method\":\"" + method + "\",\"path\":\"" + path + "\"}";
        }

        editLogMapper.insertEditLog(email, serialized);
        editLogMapper.deleteExpiredEditLogs();
    }

    private void applyVersionProgressAndLog(
        String gameId,
        long versionId,
        List<Map<String, Object>> changedAttributeDefinitions,
        List<Map<String, Object>> changedTypes,
        List<Map<String, Object>> changedTypeRelations,
        List<Map<String, Object>> changedHeroes,
        List<Map<String, Object>> changedSkills,
        List<Map<String, Object>> changedItems,
        List<Map<String, Object>> changedFormulaProfiles,
        List<Map<String, Object>> changedFormulaBindings,
        List<Map<String, Object>> changedCoefficientBuckets,
        List<Map<String, Object>> changedStatusActionControlRules
    ) {
        for (Map<String, Object> row : changedAttributeDefinitions) {
            String attrKey = mapText(row, "attrKey");
            String safeAttrKey = attrKey == null ? "" : attrKey;
            ensureUpdated(
                attributeDefinitionsMapper.updateVersionRange(gameId, safeAttrKey, versionId),
                "attributeDefinition not found while publishing",
                Map.of("gameId", gameId, "attrKey", safeAttrKey)
            );
            attributeDefinitionsMapper.upsertAttributeDefinitionLog(
                gameId,
                safeAttrKey,
                versionId,
                mapText(row, "attrName"),
                mapText(row, "attrType"),
                mapBigDecimal(row, "defaultValue"),
                mapText(row, "valueKind"),
                mapText(row, "rateTargetAttrKey")
            );
        }
        for (Map<String, Object> row : changedTypes) {
            Integer typeId = mapInteger(row, "typeId");
            int safeTypeId = typeId == null ? -1 : typeId;
            ensureUpdated(
                typesMapper.updateVersionRange(gameId, safeTypeId, versionId),
                "type not found while publishing",
                Map.of("gameId", gameId, "typeId", safeTypeId)
            );
            typesMapper.upsertTypeLog(
                gameId,
                safeTypeId,
                versionId,
                mapText(row, "name"),
                mapText(row, "description"),
                mapInteger(row, "reservedTypeId")
            );
        }
        boolean hasTypeRelationsLogDeletedColumn = typeRelationsMapper.hasTypeRelationsLogDeletedColumn();
        for (Map<String, Object> row : changedTypeRelations) {
            Integer typeId = mapInteger(row, "typeId");
            int safeTypeId = typeId == null ? -1 : typeId;
            String targetCategory = mapText(row, "targetCategory");
            String safeTargetCategory = targetCategory == null ? "" : targetCategory;
            String targetId = mapText(row, "targetId");
            String safeTargetId = targetId == null ? "" : targetId;
            ensureUpdated(
                typeRelationsMapper.updateVersionRange(gameId, safeTypeId, safeTargetCategory, safeTargetId, versionId),
                "typeRelation not found while publishing",
                Map.of("gameId", gameId, "typeId", safeTypeId, "targetCategory", safeTargetCategory, "targetId", safeTargetId)
            );
            typeRelationsMapper.upsertTypeRelationLog(
                gameId,
                safeTypeId,
                versionId,
                safeTargetCategory,
                safeTargetId,
                mapText(row, "extendJson"),
                Boolean.TRUE.equals(mapBoolean(row, "deleted")),
                hasTypeRelationsLogDeletedColumn
            );
        }
        for (Map<String, Object> row : changedHeroes) {
            String heroId = mapText(row, "heroId");
            String safeHeroId = heroId == null ? "" : heroId;
            ensureUpdated(
                heroesMapper.updateVersionRange(gameId, safeHeroId, versionId),
                "hero not found while publishing",
                Map.of("gameId", gameId, "heroId", safeHeroId)
            );
            heroesMapper.upsertHeroLog(
                gameId,
                safeHeroId,
                versionId,
                mapText(row, "name"),
                mapText(row, "title"),
                mapText(row, "avatarUrl"),
                mapText(row, "baseStatsJson"),
                mapText(row, "statsByLevelJson")
            );
        }
        for (Map<String, Object> row : changedSkills) {
            String skillId = mapText(row, "skillId");
            String safeSkillId = skillId == null ? "" : skillId;
            ensureUpdated(
                skillsMapper.updateVersionRange(gameId, safeSkillId, versionId),
                "skill not found while publishing",
                Map.of("gameId", gameId, "skillId", safeSkillId)
            );
            skillsMapper.upsertSkillLog(
                gameId,
                safeSkillId,
                versionId,
                mapText(row, "ownerId"),
                mapText(row, "ownerType"),
                mapText(row, "skillKey"),
                mapText(row, "name"),
                mapText(row, "description"),
                mapText(row, "resourceCostsJson"),
                mapText(row, "cooldownsJson"),
                mapText(row, "paramsJson"),
                mapText(row, "timingProfileJson"),
                mapText(row, "mechanicsConfigJson")
            );
        }
        for (Map<String, Object> row : changedItems) {
            String itemId = mapText(row, "itemId");
            String safeItemId = itemId == null ? "" : itemId;
            ensureUpdated(
                itemsMapper.updateVersionRange(gameId, safeItemId, versionId),
                "item not found while publishing",
                Map.of("gameId", gameId, "itemId", safeItemId)
            );
            itemsMapper.upsertItemLog(
                gameId,
                safeItemId,
                versionId,
                mapText(row, "name"),
                mapInteger(row, "goldCost"),
                mapText(row, "iconUrl"),
                mapText(row, "statsModifierJson"),
                mapText(row, "skillRefsJson"),
                mapText(row, "recipeIdsJson")
            );
        }
        for (Map<String, Object> row : changedFormulaProfiles) {
            String formulaId = mapText(row, "formulaId");
            String safeFormulaId = formulaId == null ? "" : formulaId;
            ensureUpdated(
                formulaProfilesMapper.updateVersionRange(gameId, safeFormulaId, versionId),
                "formulaProfile not found while publishing",
                Map.of("gameId", gameId, "formulaId", safeFormulaId)
            );
            formulaProfilesMapper.upsertFormulaProfileLog(
                gameId,
                safeFormulaId,
                versionId,
                mapText(row, "formulaType"),
                mapText(row, "formulaKind"),
                mapText(row, "paramsJson"),
                mapText(row, "description")
            );
        }
        for (Map<String, Object> row : changedFormulaBindings) {
            String targetCategory = mapText(row, "targetCategory");
            String safeTargetCategory = targetCategory == null ? "" : targetCategory;
            String targetId = mapText(row, "targetId");
            String safeTargetId = targetId == null ? "" : targetId;
            String bindingKey = mapText(row, "bindingKey");
            String safeBindingKey = bindingKey == null ? "" : bindingKey;
            ensureUpdated(
                formulaBindingsMapper.updateVersionRange(gameId, safeTargetCategory, safeTargetId, safeBindingKey, versionId),
                "formulaBinding not found while publishing",
                Map.of(
                    "gameId", gameId,
                    "targetCategory", safeTargetCategory,
                    "targetId", safeTargetId,
                    "bindingKey", safeBindingKey
                )
            );
            formulaBindingsMapper.upsertFormulaBindingLog(
                gameId,
                safeTargetCategory,
                safeTargetId,
                safeBindingKey,
                versionId,
                mapText(row, "formulaId"),
                mapText(row, "overrideParamsJson")
            );
        }
        for (Map<String, Object> row : changedCoefficientBuckets) {
            String bucketKey = mapText(row, "bucketKey");
            String safeBucketKey = bucketKey == null ? "" : bucketKey;
            ensureUpdated(
                coefficientBucketsMapper.updateVersionRange(gameId, safeBucketKey, versionId),
                "coefficientBucket not found while publishing",
                Map.of("gameId", gameId, "bucketKey", safeBucketKey)
            );
            coefficientBucketsMapper.upsertCoefficientBucketLog(
                gameId,
                safeBucketKey,
                versionId,
                mapText(row, "resolutionDomain"),
                mapText(row, "stageKey"),
                mapText(row, "targetAttrKey"),
                mapText(row, "aggregationMode"),
                Boolean.TRUE.equals(mapBoolean(row, "provisional")),
                mapText(row, "name"),
                mapText(row, "description"),
                mapText(row, "editorHintJson"),
                mapText(row, "bucketConfigJson")
            );
        }
        for (Map<String, Object> row : changedStatusActionControlRules) {
            String ruleId = mapText(row, "ruleId");
            String safeRuleId = ruleId == null ? "" : ruleId;
            ensureUpdated(
                statusActionControlRulesMapper.updateVersionRange(gameId, safeRuleId, versionId),
                "statusActionControlRule not found while publishing",
                Map.of("gameId", gameId, "ruleId", safeRuleId)
            );
            Integer statusTypeId = mapInteger(row, "statusTypeId");
            statusActionControlRulesMapper.upsertStatusActionControlRuleLog(
                gameId,
                safeRuleId,
                versionId,
                statusTypeId == null ? -1 : statusTypeId,
                mapText(row, "ruleKind"),
                mapText(row, "actionTypeIdsJson"),
                mapText(row, "actionMatchTypeIdsJson"),
                mapText(row, "interruptPhaseTypeIdsJson"),
                mapInteger(row, "priority") == null ? 0 : mapInteger(row, "priority"),
                mapText(row, "description"),
                mapText(row, "extendJson")
            );
        }
    }

    private void validateBundleForPublish(String gameId, ObjectNode bundle) {
        ArrayNode attributeDefinitions = requireArray(bundle, "attributeDefinitions");
        ArrayNode coefficientBuckets = requireArray(bundle, "coefficientBuckets");
        ArrayNode types = requireArray(bundle, "types");
        ArrayNode typeRelations = requireArray(bundle, "typeRelations");
        ArrayNode heroes = requireArray(bundle, "heroes");
        ArrayNode skills = requireArray(bundle, "skills");
        ArrayNode items = requireArray(bundle, "items");
        ArrayNode formulaProfiles = requireArray(bundle, "formulaProfiles");
        ArrayNode formulaBindings = requireArray(bundle, "formulaBindings");
        ArrayNode statusActionControlRules = requireArray(bundle, "statusActionControlRules");

        Set<String> attrKeys = new HashSet<>();
        for (JsonNode node : attributeDefinitions) {
            ObjectNode attr = requireObject(node, "/attributeDefinitions");
            String attrKey = requireTextForPublish(attr, "attrKey", "/attributeDefinitions/attrKey");
            attrKeys.add(attrKey);
        }

        for (JsonNode node : attributeDefinitions) {
            ObjectNode attr = requireObject(node, "/attributeDefinitions");
            validateAttributeDefinitionForPublish(attr, attrKeys);
        }

        for (JsonNode node : coefficientBuckets) {
            ObjectNode coefficientBucket = requireObject(node, "/coefficientBuckets");
            validateCoefficientBucketForPublish(coefficientBucket, attrKeys);
        }

        Set<Integer> typeIds = new HashSet<>();
        for (JsonNode node : types) {
            ObjectNode type = requireObject(node, "/types");
            if (!type.path("typeId").canConvertToInt()) {
                throw semantic("type.typeId must be integer", Map.of("path", "/types/typeId"));
            }
            typeIds.add(type.path("typeId").asInt());
        }

        Set<String> heroIds = new HashSet<>();
        for (JsonNode node : heroes) {
            ObjectNode hero = requireObject(node, "/heroes");
            String heroId = requireTextForPublish(hero, "heroId", "/heroes/heroId");
            heroIds.add(heroId);
            validateHeroForPublish(hero);
        }

        Set<String> skillIds = new HashSet<>();
        for (JsonNode node : skills) {
            ObjectNode skill = requireObject(node, "/skills");
            String skillId = requireTextForPublish(skill, "skillId", "/skills/skillId");
            skillIds.add(skillId);
        }

        Set<String> itemIds = new HashSet<>();
        for (JsonNode node : items) {
            ObjectNode item = requireObject(node, "/items");
            String itemId = requireTextForPublish(item, "itemId", "/items/itemId");
            itemIds.add(itemId);
        }

        Set<String> formulaIds = new HashSet<>();
        for (JsonNode node : formulaProfiles) {
            ObjectNode formulaProfile = requireObject(node, "/formulaProfiles");
            String formulaId = requireTextForPublish(formulaProfile, "formulaId", "/formulaProfiles/formulaId");
            formulaIds.add(formulaId);
            validateFormulaProfileForPublish(formulaProfile);
        }

        for (JsonNode node : skills) {
            ObjectNode skill = requireObject(node, "/skills");
            validateSkillForPublish(gameId, skill, heroIds, itemIds);
        }
        for (JsonNode node : items) {
            ObjectNode item = requireObject(node, "/items");
            validateItemForPublish(item, skillIds, itemIds);
        }
        for (JsonNode node : typeRelations) {
            ObjectNode relation = requireObject(node, "/typeRelations");
            validateTypeRelationForPublish(relation, typeIds, attrKeys, skillIds, heroIds, itemIds);
        }
        for (JsonNode node : formulaBindings) {
            ObjectNode formulaBinding = requireObject(node, "/formulaBindings");
            validateFormulaBindingForPublish(formulaBinding, formulaIds, skillIds, heroIds, itemIds);
        }
        for (JsonNode node : statusActionControlRules) {
            ObjectNode rule = requireObject(node, "/statusActionControlRules");
            validateStatusActionControlRuleForPublish(rule, typeIds);
        }
    }

    private void validateHeroForPublish(ObjectNode hero) {
        requireTextForPublish(hero, "name", "/heroes/name");
        JsonNode baseStats = hero.get("baseStats");
        if (baseStats == null || !baseStats.isObject()) {
            throw semantic("hero.baseStats is required and must be object", Map.of("path", "/heroes/baseStats"));
        }
    }

    private void validateHeroStatsByLevelAgainstSchema(String gameId, ObjectNode hero) {
        JsonNode statsByLevelNode = hero.get("statsByLevel");
        if (statsByLevelNode == null || statsByLevelNode.isNull()) {
            return;
        }
        if (!statsByLevelNode.isObject()) {
            throw badRequest("hero.statsByLevel must be object", Map.of("path", "/statsByLevel"));
        }

        ObjectNode statsByLevel = (ObjectNode) statsByLevelNode;
        PostgresReadStore.ProgressionSchemaRecord schema = readStore.loadProgressionSchemaRecordOrDefault(gameId);
        int stageCount = schema.stageMax() - schema.stageMin() + 1;

        boolean allArrayValues = true;
        boolean allObjectValues = true;
        Iterator<Map.Entry<String, JsonNode>> fields = statsByLevel.fields();
        while (fields.hasNext()) {
            JsonNode value = fields.next().getValue();
            allArrayValues = allArrayValues && value.isArray();
            allObjectValues = allObjectValues && value.isObject();
        }

        if (allArrayValues) {
            validateStatsByLevelArrayStructure(statsByLevel, stageCount);
            return;
        }
        if (allObjectValues) {
            validateStatsByLevelStageStructure(statsByLevel, schema);
            return;
        }
        throw badRequest(
            "hero.statsByLevel must use one structure: attrKey->number[] or stageKey->{attrKey:number}",
            Map.of("path", "/statsByLevel")
        );
    }

    private void validateStatsByLevelArrayStructure(ObjectNode statsByLevel, int stageCount) {
        Iterator<Map.Entry<String, JsonNode>> fields = statsByLevel.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String attrKey = entry.getKey();
            if (attrKey == null || attrKey.isBlank()) {
                throw badRequest("hero.statsByLevel attrKey cannot be blank", Map.of("path", "/statsByLevel"));
            }
            ArrayNode values = requireArrayNode(entry.getValue(), "/statsByLevel/" + attrKey);
            if (values.size() != stageCount) {
                throw badRequest(
                    "hero.statsByLevel number[] length must equal stageCount",
                    Map.of("path", "/statsByLevel/" + attrKey, "expectedLength", stageCount)
                );
            }
            for (int i = 0; i < values.size(); i++) {
                if (!values.get(i).isNumber()) {
                    throw badRequest("hero.statsByLevel array values must be numbers", Map.of("path", "/statsByLevel/" + attrKey + "/" + i));
                }
            }
        }
    }

    private void validateStatsByLevelStageStructure(
        ObjectNode statsByLevel,
        PostgresReadStore.ProgressionSchemaRecord schema
    ) {
        Map<Integer, Set<String>> stageAttrKeys = new LinkedHashMap<>();

        Iterator<Map.Entry<String, JsonNode>> fields = statsByLevel.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String stageKey = entry.getKey();
            int stage = parseStageKey(stageKey, "/statsByLevel/" + stageKey);
            if (stage < schema.stageMin() || stage > schema.stageMax()) {
                throw badRequest(
                    "hero.statsByLevel stageKey out of range",
                    Map.of("path", "/statsByLevel/" + stageKey, "stageMin", schema.stageMin(), "stageMax", schema.stageMax())
                );
            }

            JsonNode stageValue = entry.getValue();
            if (!stageValue.isObject()) {
                throw badRequest("hero.statsByLevel stage payload must be object", Map.of("path", "/statsByLevel/" + stageKey));
            }

            Set<String> attrs = new LinkedHashSet<>();
            Iterator<Map.Entry<String, JsonNode>> attrFields = stageValue.fields();
            while (attrFields.hasNext()) {
                Map.Entry<String, JsonNode> attrEntry = attrFields.next();
                String attrKey = attrEntry.getKey();
                if (attrKey == null || attrKey.isBlank()) {
                    throw badRequest("hero.statsByLevel attrKey cannot be blank", Map.of("path", "/statsByLevel/" + stageKey));
                }
                if (!attrEntry.getValue().isNumber()) {
                    throw badRequest(
                        "hero.statsByLevel stage attr value must be number",
                        Map.of("path", "/statsByLevel/" + stageKey + "/" + attrKey)
                    );
                }
                attrs.add(attrKey);
            }

            stageAttrKeys.put(stage, attrs);
        }

        if (!schema.requireAllStages()) {
            return;
        }

        Set<String> expectedAttrs = null;
        for (int stage = schema.stageMin(); stage <= schema.stageMax(); stage++) {
            Set<String> attrs = stageAttrKeys.get(stage);
            if (attrs == null) {
                throw badRequest(
                    "hero.statsByLevel must contain all stages when requireAllStages=true",
                    Map.of("path", "/statsByLevel", "missingStage", stage)
                );
            }
            if (expectedAttrs == null) {
                expectedAttrs = attrs;
                continue;
            }
            if (!expectedAttrs.equals(attrs)) {
                throw badRequest(
                    "hero.statsByLevel stage attrs must be consistent when requireAllStages=true",
                    Map.of("path", "/statsByLevel/" + stage)
                );
            }
        }
    }

    private ArrayNode requireArrayNode(JsonNode value, String path) {
        if (value == null || !value.isArray()) {
            throw badRequest("hero.statsByLevel field must be array", Map.of("path", path));
        }
        return (ArrayNode) value;
    }

    private int parseStageKey(String stageKey, String path) {
        if (stageKey == null || stageKey.isBlank()) {
            throw badRequest("hero.statsByLevel stageKey cannot be blank", Map.of("path", path));
        }
        try {
            return Integer.parseInt(stageKey);
        } catch (NumberFormatException ex) {
            throw badRequest("hero.statsByLevel stageKey must be integer string", Map.of("path", path));
        }
    }

    private void validateSkillForPublish(String gameId, ObjectNode skill, Set<String> heroIds, Set<String> itemIds) {
        String ownerType = requireTextForPublish(skill, "ownerType", "/skills/ownerType");
        if (!OWNER_TYPE_PATTERN.matcher(ownerType).matches()) {
            throw semantic("skill.ownerType format invalid", Map.of("path", "/skills/ownerType", "ownerType", ownerType));
        }
        if (!ownerTypeExists(gameId, ownerType)) {
            throw semantic("skill.ownerType not registered", Map.of("path", "/skills/ownerType", "ownerType", ownerType));
        }
        String ownerId = requireTextForPublish(skill, "ownerId", "/skills/ownerId");
        if ("hero".equals(ownerType) && !heroIds.contains(ownerId)) {
            throw semantic("skill.ownerId hero not found", Map.of("path", "/skills/ownerId", "ownerId", ownerId));
        }
        if ("item".equals(ownerType) && !itemIds.contains(ownerId)) {
            throw semantic("skill.ownerId item not found", Map.of("path", "/skills/ownerId", "ownerId", ownerId));
        }

        JsonNode mechanicsConfig = skill.get("mechanicsConfig");
        if (mechanicsConfig == null || !mechanicsConfig.isObject()) {
            throw semantic("skill.mechanicsConfig is required and must be object", Map.of("path", "/skills/mechanicsConfig"));
        }
        validateOptionalObjectForPublish(skill, "skill", "params", "/skills/params");
        validateOptionalObjectForPublish(skill, "skill", "timingProfile", "/skills/timingProfile");
        JsonNode versionNode = mechanicsConfig.get("version");
        if (versionNode == null || !versionNode.canConvertToInt() || versionNode.asInt() != 1) {
            throw semantic("mechanicsConfig.version must be 1", Map.of("path", "/skills/mechanicsConfig/version"));
        }
        if (!mechanicsConfig.path("triggers").isArray()) {
            throw semantic("mechanicsConfig.triggers is required and must be array", Map.of("path", "/skills/mechanicsConfig/triggers"));
        }
    }

    private void validateFormulaProfileForPublish(ObjectNode formulaProfile) {
        String formulaType = requireTextForPublish(formulaProfile, "formulaType", "/formulaProfiles/formulaType").toLowerCase(Locale.ROOT);
        if (!FORMULA_TYPES.contains(formulaType)) {
            throw semantic("formulaProfile.formulaType invalid", Map.of("path", "/formulaProfiles/formulaType", "formulaType", formulaType));
        }
        requireTextForPublish(formulaProfile, "formulaKind", "/formulaProfiles/formulaKind");
        JsonNode params = formulaProfile.get("params");
        if (params == null || !params.isObject()) {
            throw semantic("formulaProfile.params is required and must be object", Map.of("path", "/formulaProfiles/params"));
        }
    }

    private void validateFormulaBindingForPublish(
        ObjectNode formulaBinding,
        Set<String> formulaIds,
        Set<String> skillIds,
        Set<String> heroIds,
        Set<String> itemIds
    ) {
        String targetCategory = requireTextForPublish(formulaBinding, "targetCategory", "/formulaBindings/targetCategory")
            .toLowerCase(Locale.ROOT);
        if (!FORMULA_BINDING_TARGET_CATEGORIES.contains(targetCategory)) {
            throw semantic(
                "formulaBinding.targetCategory invalid",
                Map.of("path", "/formulaBindings/targetCategory", "targetCategory", targetCategory)
            );
        }
        String targetId = requireTextForPublish(formulaBinding, "targetId", "/formulaBindings/targetId");
        String formulaId = requireTextForPublish(formulaBinding, "formulaId", "/formulaBindings/formulaId");
        if (!formulaIds.contains(formulaId)) {
            throw semantic("formulaBinding.formulaId not found", Map.of("path", "/formulaBindings/formulaId", "formulaId", formulaId));
        }
        if (!targetExistsForFormulaBinding(targetCategory, targetId, skillIds, heroIds, itemIds)) {
            throw semantic(
                "formulaBinding target not found",
                Map.of("path", "/formulaBindings/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
        JsonNode overrideParams = formulaBinding.get("overrideParams");
        if (overrideParams != null && !overrideParams.isNull() && !overrideParams.isObject()) {
            throw semantic("formulaBinding.overrideParams must be object", Map.of("path", "/formulaBindings/overrideParams"));
        }
    }

    private void validateCoefficientBucketForPublish(ObjectNode bucket, Set<String> attrKeys) {
        requireTextForPublish(bucket, "bucketKey", "/coefficientBuckets/bucketKey");
        String resolutionDomain = requireTextForPublish(bucket, "resolutionDomain", "/coefficientBuckets/resolutionDomain")
            .toLowerCase(Locale.ROOT);
        if (!COEFFICIENT_BUCKET_RESOLUTION_DOMAINS.contains(resolutionDomain)) {
            throw semantic(
                "coefficientBucket.resolutionDomain invalid",
                Map.of("path", "/coefficientBuckets/resolutionDomain", "resolutionDomain", resolutionDomain)
            );
        }
        requireTextForPublish(bucket, "stageKey", "/coefficientBuckets/stageKey");
        String aggregationMode = requireTextForPublish(bucket, "aggregationMode", "/coefficientBuckets/aggregationMode")
            .toLowerCase(Locale.ROOT);
        if (!COEFFICIENT_BUCKET_AGGREGATION_MODES.contains(aggregationMode)) {
            throw semantic(
                "coefficientBucket.aggregationMode invalid",
                Map.of("path", "/coefficientBuckets/aggregationMode", "aggregationMode", aggregationMode)
            );
        }

        JsonNode targetAttrKeyNode = bucket.get("targetAttrKey");
        if ("attribute".equals(resolutionDomain)) {
            if (targetAttrKeyNode == null || !targetAttrKeyNode.isTextual() || targetAttrKeyNode.asText().isBlank()) {
                throw semantic(
                    "coefficientBucket.targetAttrKey is required when resolutionDomain=attribute",
                    Map.of("path", "/coefficientBuckets/targetAttrKey")
                );
            }
            if (!attrKeys.contains(targetAttrKeyNode.asText())) {
                throw semantic(
                    "coefficientBucket.targetAttrKey not found",
                    Map.of("path", "/coefficientBuckets/targetAttrKey", "targetAttrKey", targetAttrKeyNode.asText())
                );
            }
        } else if (targetAttrKeyNode != null && !targetAttrKeyNode.isNull()) {
            throw semantic(
                "coefficientBucket.targetAttrKey must be null when resolutionDomain=hp_change",
                Map.of("path", "/coefficientBuckets/targetAttrKey")
            );
        }

        JsonNode provisional = bucket.get("provisional");
        if (provisional != null && !provisional.isNull() && !provisional.isBoolean()) {
            throw semantic("coefficientBucket.provisional must be boolean", Map.of("path", "/coefficientBuckets/provisional"));
        }
        JsonNode editorHint = bucket.get("editorHint");
        if (editorHint != null && !editorHint.isNull() && !editorHint.isObject()) {
            throw semantic("coefficientBucket.editorHint must be object", Map.of("path", "/coefficientBuckets/editorHint"));
        }
        JsonNode bucketConfig = bucket.get("bucketConfig");
        if (bucketConfig != null && !bucketConfig.isNull() && !bucketConfig.isObject()) {
            throw semantic("coefficientBucket.bucketConfig must be object", Map.of("path", "/coefficientBuckets/bucketConfig"));
        }
    }

    private void validateStatusActionControlRuleForPublish(ObjectNode rule, Set<Integer> typeIds) {
        String ruleId = requireTextForPublish(rule, "ruleId", "/statusActionControlRules/ruleId");
        JsonNode statusTypeIdNode = rule.get("statusTypeId");
        if (statusTypeIdNode == null || !statusTypeIdNode.canConvertToInt()) {
            throw semantic("statusActionControlRule.statusTypeId must be integer", Map.of("path", "/statusActionControlRules/statusTypeId"));
        }
        int statusTypeId = statusTypeIdNode.asInt();
        if (!typeIds.contains(statusTypeId)) {
            throw semantic(
                "statusActionControlRule.statusTypeId not found",
                Map.of("path", "/statusActionControlRules/statusTypeId", "ruleId", ruleId, "typeId", statusTypeId)
            );
        }

        String ruleKind = requireTextForPublish(rule, "ruleKind", "/statusActionControlRules/ruleKind").toLowerCase(Locale.ROOT);
        if (!STATUS_ACTION_CONTROL_RULE_KINDS.contains(ruleKind)) {
            throw semantic(
                "statusActionControlRule.ruleKind invalid",
                Map.of("path", "/statusActionControlRules/ruleKind", "ruleId", ruleId, "ruleKind", ruleKind)
            );
        }

        validateTypeIdArrayForPublish(rule.get("actionTypeIds"), "/statusActionControlRules/actionTypeIds", typeIds, false);
        validateTypeIdArrayForPublish(rule.get("actionMatchTypeIds"), "/statusActionControlRules/actionMatchTypeIds", typeIds, true);
        JsonNode interruptPhaseTypeIds = rule.get("interruptPhaseTypeIds");
        validateTypeIdArrayForPublish(interruptPhaseTypeIds, "/statusActionControlRules/interruptPhaseTypeIds", typeIds, true);

        int interruptCount = interruptPhaseTypeIds == null || interruptPhaseTypeIds.isNull() ? 0 : interruptPhaseTypeIds.size();
        if ("forbid".equals(ruleKind) && interruptCount > 0) {
            throw semantic(
                "statusActionControlRule.interruptPhaseTypeIds must be empty when ruleKind=forbid",
                Map.of("path", "/statusActionControlRules/interruptPhaseTypeIds", "ruleId", ruleId)
            );
        }
        if ("interrupt".equals(ruleKind) && interruptCount == 0) {
            throw semantic(
                "statusActionControlRule.interruptPhaseTypeIds must be non-empty when ruleKind=interrupt",
                Map.of("path", "/statusActionControlRules/interruptPhaseTypeIds", "ruleId", ruleId)
            );
        }
    }

    private void validateItemForPublish(ObjectNode item, Set<String> skillIds, Set<String> itemIds) {
        String itemId = requireTextForPublish(item, "itemId", "/items/itemId");
        JsonNode skillRefs = item.get("skillRefs");
        if (skillRefs != null && !skillRefs.isNull()) {
            if (!skillRefs.isArray()) {
                throw semantic("item.skillRefs must be array", Map.of("path", "/items/skillRefs"));
            }
            for (int i = 0; i < skillRefs.size(); i++) {
                JsonNode node = skillRefs.get(i);
                if (!node.isTextual()) {
                    throw semantic("item.skillRefs must contain string", Map.of("path", "/items/skillRefs/" + i));
                }
                if (!skillIds.contains(node.asText())) {
                    throw semantic("item.skillRefs reference not found", Map.of("path", "/items/skillRefs/" + i, "skillId", node.asText()));
                }
            }
        }

        JsonNode recipeIds = item.get("recipeIds");
        if (recipeIds != null && !recipeIds.isNull()) {
            if (!recipeIds.isArray()) {
                throw semantic("item.recipeIds must be array", Map.of("path", "/items/recipeIds"));
            }
            for (int i = 0; i < recipeIds.size(); i++) {
                JsonNode node = recipeIds.get(i);
                if (!node.isTextual()) {
                    throw semantic("item.recipeIds must contain string", Map.of("path", "/items/recipeIds/" + i));
                }
                String refId = node.asText();
                if (!refId.equals(itemId) && !itemIds.contains(refId)) {
                    throw semantic("item.recipeIds reference not found", Map.of("path", "/items/recipeIds/" + i, "itemId", refId));
                }
            }
        }
    }

    private void validateTypeRelationForPublish(
        ObjectNode relation,
        Set<Integer> typeIds,
        Set<String> attrKeys,
        Set<String> skillIds,
        Set<String> heroIds,
        Set<String> itemIds
    ) {
        JsonNode typeIdNode = relation.get("typeId");
        if (typeIdNode == null || !typeIdNode.canConvertToInt()) {
            throw semantic("typeRelation.typeId must be integer", Map.of("path", "/typeRelations/typeId"));
        }
        int typeId = typeIdNode.asInt();
        if (!typeIds.contains(typeId)) {
            throw semantic("typeRelation.typeId not found", Map.of("path", "/typeRelations/typeId", "typeId", typeId));
        }
        String targetCategory = requireTextForPublish(relation, "targetCategory", "/typeRelations/targetCategory").toLowerCase(Locale.ROOT);
        if (!TARGET_CATEGORIES.contains(targetCategory)) {
            throw semantic("typeRelation.targetCategory invalid", Map.of("path", "/typeRelations/targetCategory"));
        }
        String targetId = requireTextForPublish(relation, "targetId", "/typeRelations/targetId");
        boolean found = switch (targetCategory) {
            case "equipment" -> itemIds.contains(targetId);
            case "attribute" -> attrKeys.contains(targetId);
            case "skill" -> skillIds.contains(targetId);
            case "character" -> heroIds.contains(targetId);
            case "type" -> {
                try {
                    yield typeIds.contains(Integer.parseInt(targetId));
                } catch (NumberFormatException ex) {
                    throw semantic("typeRelation targetId must be numeric for category type", Map.of("targetId", targetId));
                }
            }
            default -> false;
        };
        if (!found) {
            throw semantic(
                "typeRelation target not found",
                Map.of("path", "/typeRelations/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
    }

    private void validateTypeIdArrayForPublish(JsonNode value, String path, Set<Integer> typeIds, boolean allowEmpty) {
        if (value == null || value.isNull()) {
            if (allowEmpty) {
                return;
            }
            throw semantic("required array is missing", Map.of("path", path));
        }
        if (!value.isArray()) {
            throw semantic("field must be array", Map.of("path", path));
        }
        if (!allowEmpty && value.isEmpty()) {
            throw semantic("field must be non-empty array", Map.of("path", path));
        }
        for (int i = 0; i < value.size(); i++) {
            JsonNode item = value.get(i);
            if (!item.canConvertToInt()) {
                throw semantic("array must contain integers", Map.of("path", path + "/" + i));
            }
            int typeId = item.asInt();
            if (!typeIds.contains(typeId)) {
                throw semantic("typeId not found", Map.of("path", path + "/" + i, "typeId", typeId));
            }
        }
    }

    private ArrayNode requireArray(ObjectNode node, String fieldName) {
        JsonNode value = node.get(fieldName);
        if (value == null || !value.isArray()) {
            throw semantic("bundle." + fieldName + " must be array", Map.of("path", "/" + fieldName));
        }
        return (ArrayNode) value;
    }

    private ObjectNode requireObject(JsonNode node, String path) {
        if (node == null || !node.isObject()) {
            throw semantic("bundle element must be object", Map.of("path", path));
        }
        return (ObjectNode) node;
    }

    private String requireTextForPublish(ObjectNode node, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            throw semantic(fieldName + " is required and must be non-empty string", Map.of("path", path));
        }
        return value.asText();
    }

    private void ensureUpdated(int updatedRows, String message, Map<String, Object> details) {
        if (updatedRows == 0) {
            throw notFound(message, details);
        }
    }

    private void validateMechanicsConfig(ObjectNode config) {
        if (!config.path("version").isInt() || config.path("version").asInt() != 1) {
            throw badRequest("mechanicsConfig.version must be 1", Map.of("path", "/mechanicsConfig/version"));
        }
        if (!config.path("triggers").isArray()) {
            throw badRequest("mechanicsConfig.triggers is required and must be array", Map.of("path", "/mechanicsConfig/triggers"));
        }
    }

    private String normalizeAttributeDefinitionValueKind(ObjectNode attributeDefinition) {
        String valueKind = nullableText(attributeDefinition, "valueKind");
        if (valueKind == null || valueKind.isBlank()) {
            attributeDefinition.put("valueKind", "scalar");
            return "scalar";
        }

        String normalized = valueKind.toLowerCase(Locale.ROOT);
        if (!ATTRIBUTE_VALUE_KINDS.contains(normalized)) {
            throw badRequest("attributeDefinition.valueKind invalid", Map.of("path", "/valueKind", "valueKind", valueKind));
        }
        attributeDefinition.put("valueKind", normalized);
        return normalized;
    }

    private String validateAttributeDefinitionRateTarget(String gameId, ObjectNode attributeDefinition, String valueKind) {
        String rateTargetAttrKey = nullableText(attributeDefinition, "rateTargetAttrKey");
        if ("rate".equals(valueKind)) {
            if (rateTargetAttrKey == null || rateTargetAttrKey.isBlank()) {
                throw badRequest(
                    "attributeDefinition.rateTargetAttrKey is required when valueKind=rate",
                    Map.of("path", "/rateTargetAttrKey")
                );
            }
            if (!attributeDefinition.path("attrKey").asText().equals(rateTargetAttrKey)
                && readStore.loadAttributeDefinition(gameId, rateTargetAttrKey) == null) {
                throw semantic(
                    "attributeDefinition.rateTargetAttrKey not found",
                    Map.of("path", "/rateTargetAttrKey", "rateTargetAttrKey", rateTargetAttrKey)
                );
            }
            attributeDefinition.put("rateTargetAttrKey", rateTargetAttrKey);
            return rateTargetAttrKey;
        }

        if (rateTargetAttrKey != null) {
            throw badRequest(
                "attributeDefinition.rateTargetAttrKey must be null unless valueKind=rate",
                Map.of("path", "/rateTargetAttrKey")
            );
        }
        return null;
    }

    private void validateAttributeDefinitionForPublish(ObjectNode attributeDefinition, Set<String> attrKeys) {
        String valueKind = attributeDefinition.path("valueKind").asText("scalar").toLowerCase(Locale.ROOT);
        if (!ATTRIBUTE_VALUE_KINDS.contains(valueKind)) {
            throw semantic(
                "attributeDefinition.valueKind invalid",
                Map.of("path", "/attributeDefinitions/valueKind", "valueKind", valueKind)
            );
        }

        String rateTargetAttrKey = nullableText(attributeDefinition, "rateTargetAttrKey");
        if ("rate".equals(valueKind)) {
            if (rateTargetAttrKey == null || rateTargetAttrKey.isBlank()) {
                throw semantic(
                    "attributeDefinition.rateTargetAttrKey is required when valueKind=rate",
                    Map.of("path", "/attributeDefinitions/rateTargetAttrKey")
                );
            }
            if (!attrKeys.contains(rateTargetAttrKey)) {
                throw semantic(
                    "attributeDefinition.rateTargetAttrKey not found",
                    Map.of("path", "/attributeDefinitions/rateTargetAttrKey", "rateTargetAttrKey", rateTargetAttrKey)
                );
            }
            return;
        }

        if (rateTargetAttrKey != null) {
            throw semantic(
                "attributeDefinition.rateTargetAttrKey must be null unless valueKind=rate",
                Map.of("path", "/attributeDefinitions/rateTargetAttrKey")
            );
        }
    }

    private int requireExistingTypeId(String gameId, JsonNode value, String path, String fieldLabel) {
        if (value == null || !value.canConvertToInt()) {
            throw badRequest(fieldLabel + " must be integer", Map.of("path", path));
        }
        int typeId = value.asInt();
        if (readStore.loadType(gameId, typeId) == null) {
            throw semantic(fieldLabel + " not found", Map.of("path", path, "typeId", typeId));
        }
        return typeId;
    }

    private ArrayNode requireTypeIdArray(
        String gameId,
        ObjectNode node,
        String fieldName,
        String path,
        boolean allowEmpty
    ) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            ArrayNode empty = objectMapper.createArrayNode();
            node.set(fieldName, empty);
            if (!allowEmpty) {
                throw badRequest(fieldName + " must be non-empty array", Map.of("path", path));
            }
            return empty;
        }
        if (!value.isArray()) {
            throw badRequest(fieldName + " must be array", Map.of("path", path));
        }
        ArrayNode array = (ArrayNode) value;
        if (!allowEmpty && array.isEmpty()) {
            throw badRequest(fieldName + " must be non-empty array", Map.of("path", path));
        }
        for (int i = 0; i < array.size(); i++) {
            JsonNode item = array.get(i);
            if (!item.canConvertToInt()) {
                throw badRequest(fieldName + " must contain integers", Map.of("path", path + "/" + i));
            }
            int typeId = item.asInt();
            if (readStore.loadType(gameId, typeId) == null) {
                throw semantic(fieldName + " contains unknown typeId", Map.of("path", path + "/" + i, "typeId", typeId));
            }
        }
        return array;
    }

    private void validateOptionalObject(ObjectNode node, String resourceName, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value != null && !value.isNull() && !value.isObject()) {
            throw badRequest(resourceName + "." + fieldName + " must be object", Map.of("path", path));
        }
    }

    private void validateOptionalText(ObjectNode node, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value != null && !value.isNull() && !value.isTextual()) {
            throw badRequest(fieldName + " must be string", Map.of("path", path));
        }
    }

    private void validateOptionalObjectForPublish(ObjectNode node, String resourceName, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value != null && !value.isNull() && !value.isObject()) {
            throw semantic(resourceName + "." + fieldName + " must be object", Map.of("path", path));
        }
    }

    private void validateItemRefs(String gameId, ObjectNode item) {
        if (item.has("skillRefs") && !item.path("skillRefs").isNull()) {
            if (!item.path("skillRefs").isArray()) {
                throw badRequest("item.skillRefs must be array", Map.of("path", "/skillRefs"));
            }
            for (int i = 0; i < item.path("skillRefs").size(); i++) {
                JsonNode node = item.path("skillRefs").get(i);
                if (!node.isTextual()) {
                    throw badRequest("item.skillRefs must contain string", Map.of("path", "/skillRefs/" + i));
                }
                if (readStore.loadSkill(gameId, node.asText()) == null) {
                    throw semantic("item.skillRefs reference not found", Map.of("path", "/skillRefs/" + i, "skillId", node.asText()));
                }
            }
        }
        if (item.has("recipeIds") && !item.path("recipeIds").isNull()) {
            if (!item.path("recipeIds").isArray()) {
                throw badRequest("item.recipeIds must be array", Map.of("path", "/recipeIds"));
            }
            String itemId = item.path("itemId").asText();
            for (int i = 0; i < item.path("recipeIds").size(); i++) {
                JsonNode node = item.path("recipeIds").get(i);
                if (!node.isTextual()) {
                    throw badRequest("item.recipeIds must contain string", Map.of("path", "/recipeIds/" + i));
                }
                String refId = node.asText();
                if (!refId.equals(itemId) && readStore.loadItem(gameId, refId) == null) {
                    throw semantic("item.recipeIds reference not found", Map.of("path", "/recipeIds/" + i, "itemId", refId));
                }
            }
        }
    }

    private void validateTypeRelationTarget(String gameId, ObjectNode relation) {
        int typeId = relation.path("typeId").asInt(Integer.MIN_VALUE);
        if (typeId == Integer.MIN_VALUE || readStore.loadType(gameId, typeId) == null) {
            throw semantic("typeRelation.typeId not found", Map.of("path", "/typeId", "typeId", typeId));
        }
        String targetCategory = relation.path("targetCategory").asText("").toLowerCase(Locale.ROOT);
        String targetId = relation.path("targetId").asText();
        validateTypeRelationTargetRef(gameId, targetCategory, targetId, "/targetId");
    }

    private void validateTypeRelationTargetRef(String gameId, String targetCategory, String targetId, String targetPath) {
        if (!TARGET_CATEGORIES.contains(targetCategory)) {
            throw badRequest("typeRelation.targetCategory invalid", Map.of("path", "/targetCategory"));
        }
        boolean found = switch (targetCategory) {
            case "equipment" -> readStore.loadItem(gameId, targetId) != null;
            case "attribute" -> readStore.loadAttributeDefinition(gameId, targetId) != null;
            case "skill" -> readStore.loadSkill(gameId, targetId) != null;
            case "character" -> readStore.loadHero(gameId, targetId) != null;
            case "type" -> readStore.loadType(gameId, parseTypeId(targetId)) != null;
            default -> false;
        };
        if (!found) {
            throw semantic("typeRelation target not found", Map.of("path", targetPath, "targetCategory", targetCategory, "targetId", targetId));
        }
    }

    private void validateFormulaBindingTarget(String gameId, ObjectNode binding) {
        String targetCategory = binding.path("targetCategory").asText("").toLowerCase(Locale.ROOT);
        if (!FORMULA_BINDING_TARGET_CATEGORIES.contains(targetCategory)) {
            throw badRequest("formulaBinding.targetCategory invalid", Map.of("path", "/targetCategory"));
        }
        String targetId = binding.path("targetId").asText();
        boolean found = switch (targetCategory) {
            case "skill" -> readStore.loadSkill(gameId, targetId) != null;
            case "hero" -> readStore.loadHero(gameId, targetId) != null;
            case "item" -> readStore.loadItem(gameId, targetId) != null;
            case "global" -> true;
            default -> false;
        };
        if (!found) {
            throw semantic(
                "formulaBinding target not found",
                Map.of("path", "/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
    }

    private boolean targetExistsForFormulaBinding(
        String targetCategory,
        String targetId,
        Set<String> skillIds,
        Set<String> heroIds,
        Set<String> itemIds
    ) {
        return switch (targetCategory) {
            case "skill" -> skillIds.contains(targetId);
            case "hero" -> heroIds.contains(targetId);
            case "item" -> itemIds.contains(targetId);
            case "global" -> true;
            default -> false;
        };
    }

    private int parseTypeId(String raw) {
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException ex) {
            throw semantic("typeRelation targetId must be numeric for category type", Map.of("targetId", raw));
        }
    }

    private ObjectNode mergeUpsert(ObjectNode body, String idField, String resourceId) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }
        ObjectNode merged = objectMapper.createObjectNode();
        mergeObject(merged, body);
        merged.put(idField, resourceId);
        return merged;
    }

    private void mergeObject(ObjectNode target, ObjectNode patch) {
        Iterator<Map.Entry<String, JsonNode>> it = patch.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> entry = it.next();
            JsonNode current = target.get(entry.getKey());
            if (current != null && current.isObject() && entry.getValue().isObject()) {
                mergeObject((ObjectNode) current, (ObjectNode) entry.getValue());
            } else {
                target.set(entry.getKey(), entry.getValue().deepCopy());
            }
        }
    }

    private long resolveVersionIdForWrite(String gameId) {
        ensureGamePartitions(gameId);
        PostgresReadStore.VersionRecord workspaceVersion = readStore.findVersionByCode(gameId, WORKSPACE_VERSION_CODE);
        if (workspaceVersion != null) {
            return workspaceVersion.versionId();
        }
        try {
            Long workspaceVersionId = gameVersionsMapper.createVersion(gameId, WORKSPACE_VERSION_CODE, null);
            if (workspaceVersionId != null) {
                return workspaceVersionId;
            }
        } catch (DataIntegrityViolationException ex) {
            PostgresReadStore.VersionRecord existingWorkspace = readStore.findVersionByCode(gameId, WORKSPACE_VERSION_CODE);
            if (existingWorkspace != null) {
                return existingWorkspace.versionId();
            }
        }
        throw semantic("No workspace version available for write.", Map.of("gameId", gameId));
    }

    private void ensureGamePartitions(String gameId) {
        if (!ensuredPartitionGames.add(gameId)) {
            return;
        }
        try {
            gamesMapper.ensureGamePartitions(gameId);
        } catch (RuntimeException ex) {
            ensuredPartitionGames.remove(gameId);
            throw ex;
        }
    }

    private boolean ownerTypeExists(String gameId, String ownerType) {
        Long count = ownerCategoriesMapper.countOwnerCategory(gameId, ownerType);
        return count != null && count > 0;
    }

    private String serializeBundle(ObjectNode bundle) {
        try {
            return objectMapper.writeValueAsString(bundle);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Unable to serialize bundle snapshot", ex);
        }
    }

    private String mapText(Map<String, Object> row, String key) {
        Object value = mapValue(row, key);
        return value == null ? null : value.toString();
    }

    private Integer mapInteger(Map<String, Object> row, String key) {
        Object value = mapValue(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        return Integer.parseInt(value.toString());
    }

    private BigDecimal mapBigDecimal(Map<String, Object> row, String key) {
        Object value = mapValue(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        if (value instanceof Number number) {
            return new BigDecimal(number.toString());
        }
        return new BigDecimal(value.toString());
    }

    private Boolean mapBoolean(Map<String, Object> row, String key) {
        Object value = mapValue(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        return Boolean.parseBoolean(value.toString());
    }

    private Object mapValue(Map<String, Object> row, String key) {
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

    private String requireTextField(ObjectNode body, String fieldName, String path) {
        JsonNode value = body.get(fieldName);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            throw badRequest("progressionSchema." + fieldName + " must be non-empty string", Map.of("path", path));
        }
        return value.asText();
    }

    private int requireIntegerField(ObjectNode body, String fieldName, String path) {
        JsonNode value = body.get(fieldName);
        if (value == null || !value.canConvertToInt()) {
            throw badRequest("progressionSchema." + fieldName + " must be integer", Map.of("path", path));
        }
        return value.asInt();
    }

    private String nullableText(ObjectNode node, String fieldName) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        return node.get(fieldName).isTextual() ? node.get(fieldName).asText() : node.get(fieldName).toString();
    }

    private Integer nullableInteger(ObjectNode node, String fieldName) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        if (!node.get(fieldName).isIntegralNumber()) {
            throw badRequest(fieldName + " must be integer", Map.of("path", "/" + fieldName));
        }
        return node.get(fieldName).asInt();
    }

    private Boolean nullableBoolean(ObjectNode node, String fieldName) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        if (!node.get(fieldName).isBoolean()) {
            throw badRequest(fieldName + " must be boolean", Map.of("path", "/" + fieldName));
        }
        return node.get(fieldName).asBoolean();
    }

    private BigDecimal nullableBigDecimal(ObjectNode node, String fieldName) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        if (!node.get(fieldName).isNumber()) {
            throw badRequest(fieldName + " must be number", Map.of("path", "/" + fieldName));
        }
        return node.get(fieldName).decimalValue();
    }

    private ApiException badRequest(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_BODY", message, details);
    }

    private ApiException semantic(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "422.SEMANTIC_ERROR", message, details);
    }

    private ApiException notFound(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.NOT_FOUND, "404.NOT_FOUND", message, details);
    }

    private ApiException conflict(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.CONFLICT, "409.CONFLICT", message, details);
    }
}
