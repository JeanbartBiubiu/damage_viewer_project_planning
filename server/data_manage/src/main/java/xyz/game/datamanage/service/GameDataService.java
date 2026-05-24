package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class GameDataService {

    private static final Pattern GAME_ID_PATTERN = Pattern.compile("^[a-z0-9_]+$");
    private static final Set<String> VERSION_PUBLISH_ALLOWED_FIELDS = Set.of("versionCode", "releaseDate");
    private static final List<String> READ_CACHE_NAMES = List.of(
        "games",
        "currentVersion",
        "bundle",
        "images",
        "ownerCategories"
    );
    private static final List<String> NON_PUBLISHED_READ_CACHE_NAMES = List.of(
        "games",
        "images",
        "ownerCategories"
    );

    private final PostgresReadStore readStore;
    private final PostgresWriteStore writeStore;
    private final PostgresJsonSupport jsonSupport;
    private final CacheManager cacheManager;

    public GameDataService(
        PostgresReadStore readStore,
        PostgresWriteStore writeStore,
        PostgresJsonSupport jsonSupport,
        CacheManager cacheManager
    ) {
        this.readStore = readStore;
        this.writeStore = writeStore;
        this.jsonSupport = jsonSupport;
        this.cacheManager = cacheManager;
    }

    @Cacheable(cacheNames = "games", key = "'all'")
    public ArrayNode listGames() {
        return readStore.listGames();
    }

    @Cacheable(cacheNames = "currentVersion", key = "#p0")
    public ObjectNode getCurrentVersion(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        PostgresReadStore.VersionRecord current = readStore.findCurrentPublishedVersion(gameId);
        if (current == null) {
            throw notFound("Current published version not found", Map.of("gameId", gameId));
        }

        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", gameId);
        response.put("versionCode", current.versionCode());
        if (current.releaseDate() != null) {
            response.put("releaseDate", current.releaseDate().toString());
        }
        if (current.publishedAt() != null) {
            response.put("publishedAt", current.publishedAt().toString());
        }
        response.put("updatedAt", current.updatedAt().toString());
        return response;
    }

    @Cacheable(cacheNames = "bundle", key = "#p0 + ':' + #p1")
    public ObjectNode getBundle(String gameId, String versionCode) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode snapshot = readStore.getPublishedBundleSnapshot(gameId, versionCode);
        if (snapshot == null) {
            throw notFound("Published bundle snapshot not found", Map.of("gameId", gameId, "versionCode", versionCode));
        }
        return snapshot;
    }

    @Cacheable(
        cacheNames = "images",
        key = "#p0 + ':' + #p1",
        condition = "#p1 != null && !#p1.isBlank()"
    )
    public ObjectNode getImages(String gameId, String updatedAfterRaw) {
        validateGameId(gameId);
        assertGameExists(gameId);
        Instant updatedAfter = parseOptionalInstant(updatedAfterRaw);
        return readStore.getImages(gameId, updatedAfter);
    }

    @Cacheable(cacheNames = "ownerCategories", key = "#p0")
    public ObjectNode getOwnerCategories(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getOwnerCategories(gameId);
    }

    public ObjectNode getProgressionSchema(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.loadProgressionSchemaOrDefault(gameId);
    }

    public ObjectNode listHeroes(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getHeroes(gameId);
    }

    public ObjectNode listSkills(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getSkills(gameId);
    }

    public ObjectNode listItems(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getItems(gameId);
    }

    public ObjectNode listAttributeDefinitions(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getAttributeDefinitions(gameId);
    }

    public ObjectNode listTypes(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getTypes(gameId);
    }

    public ObjectNode listTypeRelations(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getTypeRelations(gameId);
    }

    public ObjectNode upsertHero(String gameId, String heroId, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertHero(gameId, heroId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertProgressionSchema(String gameId, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = writeStore.upsertProgressionSchema(gameId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertSkill(String gameId, String skillId, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertSkill(gameId, skillId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listSkillMounts(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getSkillMounts(gameId);
    }

    public ObjectNode getSkillMount(String gameId, String targetCategory, String targetId, String skillId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        String normalizedTargetCategory = targetCategory == null ? null : targetCategory.toLowerCase(Locale.ROOT);
        ObjectNode response = readStore.loadSkillMount(gameId, normalizedTargetCategory, targetId, skillId);
        if (response == null) {
            throw notFound(
                "Skill mount not found",
                Map.of(
                    "gameId", gameId,
                    "targetCategory", normalizedTargetCategory,
                    "targetId", targetId,
                    "skillId", skillId
                )
            );
        }
        return response;
    }

    public ObjectNode upsertSkillMount(
        String gameId,
        String targetCategory,
        String targetId,
        String skillId,
        ObjectNode body
    ) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertSkillMount(gameId, targetCategory, targetId, skillId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertItem(String gameId, String itemId, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertItem(gameId, itemId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listFormulaProfiles(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getFormulaProfiles(gameId);
    }

    public ObjectNode getFormulaProfile(String gameId, String formulaId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = readStore.loadFormulaProfile(gameId, formulaId);
        if (response == null) {
            throw notFound("Formula profile not found", Map.of("gameId", gameId, "formulaId", formulaId));
        }
        return response;
    }

    public ObjectNode upsertFormulaProfile(String gameId, String formulaId, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertFormulaProfile(gameId, formulaId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listFormulaBindings(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getFormulaBindings(gameId);
    }

    public ObjectNode getFormulaBinding(String gameId, String targetCategory, String targetId, String bindingKey) {
        validateGameId(gameId);
        assertGameExists(gameId);
        String normalizedTargetCategory = targetCategory == null ? null : targetCategory.toLowerCase(Locale.ROOT);
        ObjectNode response = readStore.loadFormulaBinding(gameId, normalizedTargetCategory, targetId, bindingKey);
        if (response == null) {
            throw notFound(
                "Formula binding not found",
                Map.of("gameId", gameId, "targetCategory", normalizedTargetCategory, "targetId", targetId, "bindingKey", bindingKey)
            );
        }
        return response;
    }

    public ObjectNode upsertFormulaBinding(
        String gameId,
        String targetCategory,
        String targetId,
        String bindingKey,
        ObjectNode body
    ) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertFormulaBinding(gameId, targetCategory, targetId, bindingKey, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listCoefficientBuckets(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getCoefficientBuckets(gameId);
    }

    public ObjectNode getCoefficientBucket(String gameId, String bucketKey) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = readStore.loadCoefficientBucket(gameId, bucketKey);
        if (response == null) {
            throw notFound("Coefficient bucket not found", Map.of("gameId", gameId, "bucketKey", bucketKey));
        }
        return response;
    }

    public ObjectNode upsertCoefficientBucket(String gameId, String bucketKey, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertCoefficientBucket(gameId, bucketKey, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listStatusActionControlRules(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getStatusActionControlRules(gameId);
    }

    public ObjectNode getStatusActionControlRule(String gameId, String ruleId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = readStore.loadStatusActionControlRule(gameId, ruleId);
        if (response == null) {
            throw notFound("Status action control rule not found", Map.of("gameId", gameId, "ruleId", ruleId));
        }
        return response;
    }

    public ObjectNode upsertStatusActionControlRule(String gameId, String ruleId, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertStatusActionControlRule(gameId, ruleId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listStatusDefinitions(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getStatusDefinitions(gameId);
    }

    public ObjectNode getStatusDefinition(String gameId, String statusId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = readStore.loadStatusDefinition(gameId, statusId);
        if (response == null) {
            throw notFound("Status definition not found", Map.of("gameId", gameId, "statusId", statusId));
        }
        return response;
    }

    public ObjectNode upsertStatusDefinition(String gameId, String statusId, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertStatusDefinition(gameId, statusId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listControlStateProfiles(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getControlStateProfiles(gameId);
    }

    public ObjectNode getControlStateProfile(String gameId, String controlProfileId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = readStore.loadControlStateProfile(gameId, controlProfileId);
        if (response == null) {
            throw notFound("Control state profile not found", Map.of("gameId", gameId, "controlProfileId", controlProfileId));
        }
        return response;
    }

    public ObjectNode upsertControlStateProfile(String gameId, String controlProfileId, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertControlStateProfile(gameId, controlProfileId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listStatusModifierGroups(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getStatusModifierGroups(gameId);
    }

    public ObjectNode getStatusModifierGroup(String gameId, String statusId, String groupKey) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = readStore.loadStatusModifierGroup(gameId, statusId, groupKey);
        if (response == null) {
            throw notFound("Status modifier group not found", Map.of("gameId", gameId, "statusId", statusId, "groupKey", groupKey));
        }
        return response;
    }

    public ObjectNode upsertStatusModifierGroup(String gameId, String statusId, String groupKey, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertStatusModifierGroup(gameId, statusId, groupKey, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listStatusAttributeModifiers(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getStatusAttributeModifiers(gameId);
    }

    public ObjectNode getStatusAttributeModifier(String gameId, String statusId, String groupKey, String modifierId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = readStore.loadStatusAttributeModifier(gameId, statusId, groupKey, modifierId);
        if (response == null) {
            throw notFound(
                "Status attribute modifier not found",
                Map.of("gameId", gameId, "statusId", statusId, "groupKey", groupKey, "modifierId", modifierId)
            );
        }
        return response;
    }

    public ObjectNode upsertStatusAttributeModifier(
        String gameId,
        String statusId,
        String groupKey,
        String modifierId,
        ObjectNode body
    ) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertStatusAttributeModifier(gameId, statusId, groupKey, modifierId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode listStatusPeriodicHpEffects(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getStatusPeriodicHpEffects(gameId);
    }

    public ObjectNode getStatusPeriodicHpEffect(String gameId, String statusId, String groupKey, String effectId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = readStore.loadStatusPeriodicHpEffect(gameId, statusId, groupKey, effectId);
        if (response == null) {
            throw notFound(
                "Status periodic hp effect not found",
                Map.of("gameId", gameId, "statusId", statusId, "groupKey", groupKey, "effectId", effectId)
            );
        }
        return response;
    }

    public ObjectNode upsertStatusPeriodicHpEffect(
        String gameId,
        String statusId,
        String groupKey,
        String effectId,
        ObjectNode body
    ) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertStatusPeriodicHpEffect(gameId, statusId, groupKey, effectId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertAttributeDefinition(String gameId, String attrKey, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertAttributeDefinition(gameId, attrKey, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertType(String gameId, int typeId, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertType(gameId, typeId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertTypeRelation(
        String gameId,
        int typeId,
        String targetCategory,
        String targetId,
        ObjectNode body
    ) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertTypeRelation(gameId, typeId, targetCategory, targetId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode replaceTypeRelationsForTarget(
        String gameId,
        String targetCategory,
        String targetId,
        ObjectNode body
    ) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.replaceTypeRelationsForTarget(gameId, targetCategory, targetId, body);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertImage(String gameId, String uri, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertImage(gameId, uri, body);
        evictCache("images");
        return response;
    }

    public ObjectNode publishVersion(String gameId, ObjectNode requestBody) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateAllowedTopLevelFields(requestBody, VERSION_PUBLISH_ALLOWED_FIELDS);
        ObjectNode response = writeStore.publishVersion(gameId, requestBody);
        evictReadCaches();
        return response;
    }

    public void recordEditLog(String email, String method, String path, JsonNode requestBody, int responseCode) {
        writeStore.recordEditLog(email, method, path, requestBody, responseCode);
    }

    private void validateGameId(String gameId) {
        if (gameId == null || !GAME_ID_PATTERN.matcher(gameId).matches()) {
            throw badRequest("Invalid gameId format", Map.of("path", "/gameId", "reason", "must match ^[a-z0-9_]+$"));
        }
    }

    private void assertGameExists(String gameId) {
        if (!readStore.gameExists(gameId)) {
            throw notFound("Game not found", Map.of("gameId", gameId));
        }
    }

    private Instant parseOptionalInstant(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(raw);
        } catch (DateTimeParseException ex) {
            throw badRequest("updatedAfter must be ISO-8601 timestamp", Map.of("path", "/updatedAfter"));
        }
    }

    private void evictReadCaches() {
        evictCaches(READ_CACHE_NAMES);
    }

    private void evictNonPublishedReadCaches() {
        // Temporary mitigation for bundle leakage risk:
        // non-publish writes intentionally do not clear currentVersion/bundle caches.
        evictCaches(NON_PUBLISHED_READ_CACHE_NAMES);
    }

    private void evictCaches(List<String> cacheNames) {
        for (String cacheName : cacheNames) {
            evictCache(cacheName);
        }
    }

    private void evictCache(String cacheName) {
        Cache cache = cacheManager.getCache(cacheName);
        if (cache != null) {
            cache.clear();
        }
    }

    private ApiException badRequest(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_BODY", message, details);
    }

    private ApiException notFound(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.NOT_FOUND, "404.NOT_FOUND", message, details);
    }
}
