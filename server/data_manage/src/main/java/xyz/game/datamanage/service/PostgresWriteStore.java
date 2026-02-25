package xyz.game.datamanage.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.AttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.EditLogMapper;
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.HeroesMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.ItemsMapper;
import xyz.game.datamanage.mapper.OwnerCategoriesMapper;
import xyz.game.datamanage.mapper.SkillsMapper;
import xyz.game.datamanage.mapper.TypeRelationsMapper;
import xyz.game.datamanage.mapper.TypesMapper;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.http.EtagUtil;

@Component
public class PostgresWriteStore {

    private static final Pattern OWNER_TYPE_PATTERN = Pattern.compile("^[a-z0-9_]+$");
    private static final Set<String> TARGET_CATEGORIES = Set.of("equipment", "attribute", "skill", "character", "type");

    private final HeroesMapper heroesMapper;
    private final SkillsMapper skillsMapper;
    private final ItemsMapper itemsMapper;
    private final AttributeDefinitionsMapper attributeDefinitionsMapper;
    private final TypesMapper typesMapper;
    private final TypeRelationsMapper typeRelationsMapper;
    private final ImagesMapper imagesMapper;
    private final OwnerCategoriesMapper ownerCategoriesMapper;
    private final GameVersionsMapper gameVersionsMapper;
    private final EditLogMapper editLogMapper;
    private final ObjectMapper objectMapper;
    private final PostgresReadStore readStore;
    private final PostgresJsonSupport jsonSupport;

    public PostgresWriteStore(
        HeroesMapper heroesMapper,
        SkillsMapper skillsMapper,
        ItemsMapper itemsMapper,
        AttributeDefinitionsMapper attributeDefinitionsMapper,
        TypesMapper typesMapper,
        TypeRelationsMapper typeRelationsMapper,
        ImagesMapper imagesMapper,
        OwnerCategoriesMapper ownerCategoriesMapper,
        GameVersionsMapper gameVersionsMapper,
        EditLogMapper editLogMapper,
        ObjectMapper objectMapper,
        PostgresReadStore readStore,
        PostgresJsonSupport jsonSupport
    ) {
        this.heroesMapper = heroesMapper;
        this.skillsMapper = skillsMapper;
        this.itemsMapper = itemsMapper;
        this.attributeDefinitionsMapper = attributeDefinitionsMapper;
        this.typesMapper = typesMapper;
        this.typeRelationsMapper = typeRelationsMapper;
        this.imagesMapper = imagesMapper;
        this.ownerCategoriesMapper = ownerCategoriesMapper;
        this.gameVersionsMapper = gameVersionsMapper;
        this.editLogMapper = editLogMapper;
        this.objectMapper = objectMapper;
        this.readStore = readStore;
        this.jsonSupport = jsonSupport;
    }

    @Transactional
    public ObjectNode upsertHero(String gameId, String heroId, ObjectNode body, boolean patch) {
        ObjectNode merged = mergeUpsert(readStore.loadHero(gameId, heroId), body, patch, "hero", heroId, "heroId");
        jsonSupport.requireText(merged, "name", "hero");
        JsonNode baseStats = merged.get("baseStats");
        if (baseStats == null || !baseStats.isObject()) {
            throw badRequest("hero.baseStats is required and must be object", Map.of("path", "/baseStats"));
        }

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
    public ObjectNode upsertSkill(String gameId, String skillId, ObjectNode body, boolean patch) {
        ObjectNode merged = mergeUpsert(readStore.loadSkill(gameId, skillId), body, patch, "skill", skillId, "skillId");
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
            jsonSupport.toJsonString(merged.get("mechanicsConfig"), "/mechanicsConfig")
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertItem(String gameId, String itemId, ObjectNode body, boolean patch) {
        ObjectNode merged = mergeUpsert(readStore.loadItem(gameId, itemId), body, patch, "item", itemId, "itemId");
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
    public ObjectNode upsertAttributeDefinition(String gameId, String attrKey, ObjectNode body, boolean patch) {
        ObjectNode merged = mergeUpsert(
            readStore.loadAttributeDefinition(gameId, attrKey),
            body,
            patch,
            "attributeDefinition",
            attrKey,
            "attrKey"
        );
        if (merged.has("defaultValue") && !merged.path("defaultValue").isNull() && !merged.path("defaultValue").isNumber()) {
            throw badRequest("attributeDefinition.defaultValue must be number", Map.of("path", "/defaultValue"));
        }

        long versionId = resolveVersionIdForWrite(gameId);
        attributeDefinitionsMapper.upsertAttributeDefinition(
            gameId,
            attrKey,
            versionId,
            nullableText(merged, "attrName"),
            nullableText(merged, "attrType"),
            nullableBigDecimal(merged, "defaultValue")
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertType(String gameId, int typeId, ObjectNode body, boolean patch) {
        ObjectNode merged = mergeUpsert(readStore.loadType(gameId, typeId), body, patch, "type", Integer.toString(typeId), "typeId");
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
        ObjectNode body,
        boolean patch
    ) {
        String relationKey = typeId + "|" + targetCategory + "|" + targetId;
        ObjectNode merged = mergeUpsert(
            readStore.loadTypeRelation(gameId, typeId, targetCategory, targetId),
            body,
            patch,
            "typeRelation",
            relationKey,
            "targetId"
        );
        merged.put("typeId", typeId);
        merged.put("targetCategory", targetCategory);
        merged.put("targetId", targetId);
        validateTypeRelationTarget(gameId, merged);

        long versionId = resolveVersionIdForWrite(gameId);
        typeRelationsMapper.upsertTypeRelation(
            gameId,
            typeId,
            versionId,
            targetCategory,
            targetId,
            jsonSupport.toJsonStringOrNull(merged.get("extend"))
        );
        return merged;
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
    public ObjectNode createVersion(String gameId, ObjectNode requestBody) {
        if (requestBody == null || requestBody.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }
        String versionCode = jsonSupport.requireText(requestBody, "versionCode", "version");
        LocalDate releaseDate = null;
        if (requestBody.hasNonNull("releaseDate")) {
            try {
                releaseDate = LocalDate.parse(requestBody.path("releaseDate").asText());
            } catch (DateTimeParseException ex) {
                throw badRequest("releaseDate must be ISO date", Map.of("path", "/releaseDate"));
            }
        }

        Long versionId;
        try {
            versionId = gameVersionsMapper.createVersion(gameId, versionCode, releaseDate == null ? null : Date.valueOf(releaseDate));
        } catch (DataIntegrityViolationException ex) {
            throw conflict("Version code already exists", Map.of("gameId", gameId, "versionCode", versionCode));
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        response.put("versionId", versionId == null ? -1L : versionId);
        response.put("versionCode", versionCode);
        return response;
    }

    @Transactional
    public ObjectNode publishVersion(String gameId, long versionId) {
        PostgresReadStore.VersionRecord version = readStore.findVersionById(gameId, versionId);
        if (version == null) {
            throw notFound("Version not found", Map.of("gameId", gameId, "versionId", versionId));
        }
        ObjectNode unsignedBundle = readStore.buildBundle(gameId, version, "");
        String dataHash = buildDataHash(unsignedBundle);
        gameVersionsMapper.clearCurrentVersion(gameId);
        int updatedRows = gameVersionsMapper.markVersionCurrent(dataHash, Timestamp.from(Instant.now()), gameId, versionId);
        if (updatedRows == 0) {
            throw notFound("Version not found", Map.of("gameId", gameId, "versionId", versionId));
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        response.put("versionId", versionId);
        response.put("versionCode", version.versionCode());
        response.put("dataHash", dataHash);
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

    private void validateMechanicsConfig(ObjectNode config) {
        if (!config.path("version").isInt() || config.path("version").asInt() != 1) {
            throw badRequest("mechanicsConfig.version must be 1", Map.of("path", "/mechanicsConfig/version"));
        }
        if (!config.path("triggers").isArray()) {
            throw badRequest("mechanicsConfig.triggers is required and must be array", Map.of("path", "/mechanicsConfig/triggers"));
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
        if (!TARGET_CATEGORIES.contains(targetCategory)) {
            throw badRequest("typeRelation.targetCategory invalid", Map.of("path", "/targetCategory"));
        }
        String targetId = relation.path("targetId").asText();
        boolean found = switch (targetCategory) {
            case "equipment" -> readStore.loadItem(gameId, targetId) != null;
            case "attribute" -> readStore.loadAttributeDefinition(gameId, targetId) != null;
            case "skill" -> readStore.loadSkill(gameId, targetId) != null;
            case "character" -> readStore.loadHero(gameId, targetId) != null;
            case "type" -> readStore.loadType(gameId, parseTypeId(targetId)) != null;
            default -> false;
        };
        if (!found) {
            throw semantic("typeRelation target not found", Map.of("path", "/targetId", "targetCategory", targetCategory, "targetId", targetId));
        }
    }

    private int parseTypeId(String raw) {
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException ex) {
            throw semantic("typeRelation targetId must be numeric for category type", Map.of("targetId", raw));
        }
    }

    private ObjectNode mergeUpsert(
        ObjectNode existing,
        ObjectNode body,
        boolean patch,
        String resourceName,
        String resourceId,
        String idField
    ) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }
        if (patch && existing == null) {
            throw notFound(resourceName + " not found", Map.of("id", resourceId));
        }
        ObjectNode merged = patch ? existing.deepCopy() : objectMapper.createObjectNode();
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
        Long currentVersion = readStore.findCurrentVersionId(gameId);
        if (currentVersion != null) {
            return currentVersion;
        }
        Long latestVersion = readStore.findLatestVersionId(gameId);
        if (latestVersion != null) {
            return latestVersion;
        }
        throw semantic("No version available for write. Create version first.", Map.of("gameId", gameId));
    }

    private boolean ownerTypeExists(String gameId, String ownerType) {
        Long count = ownerCategoriesMapper.countOwnerCategory(gameId, ownerType);
        return count != null && count > 0;
    }

    private String buildDataHash(ObjectNode bundle) {
        ObjectNode hashSource = bundle.deepCopy();
        ((ObjectNode) hashSource.get("meta")).remove("dataHash");
        ((ObjectNode) hashSource.get("meta")).remove("generatedAt");
        return EtagUtil.hashJson(hashSource, objectMapper);
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
