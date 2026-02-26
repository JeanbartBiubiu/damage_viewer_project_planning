package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
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
    private static final Set<String> VERSION_CREATE_ALLOWED_FIELDS = Set.of("versionCode", "releaseDate");
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

    @Cacheable(cacheNames = "currentVersion", key = "#gameId")
    public ObjectNode getCurrentVersion(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        PostgresReadStore.VersionRecord current = readStore.findCurrentPublishedVersion(gameId);
        if (current == null) {
            throw notFound("Current published version not found", Map.of("gameId", gameId));
        }

        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", gameId);
        response.put("versionId", current.versionId());
        response.put("versionCode", current.versionCode());
        response.put("dataHash", current.dataHash());
        response.put("updatedAt", current.updatedAt().toString());
        return response;
    }

    public String getBundleDataHash(String gameId, long versionId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        PostgresReadStore.VersionRecord current = readStore.findCurrentPublishedVersion(gameId);
        if (current == null || current.versionId() != versionId) {
            throw notFound("Only current version bundle is supported", Map.of("gameId", gameId, "versionId", versionId));
        }
        return current.dataHash();
    }

    @Cacheable(cacheNames = "bundle", key = "#gameId + ':' + #versionId")
    public ObjectNode getBundle(String gameId, long versionId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        PostgresReadStore.VersionRecord current = readStore.findCurrentPublishedVersion(gameId);
        if (current == null || current.versionId() != versionId) {
            throw notFound("Only current version bundle is supported", Map.of("gameId", gameId, "versionId", versionId));
        }
        return readStore.buildBundle(gameId, current, current.dataHash());
    }

    @Cacheable(cacheNames = "images", key = "#gameId + ':' + (#updatedAfterRaw == null ? '' : #updatedAfterRaw)")
    public ObjectNode getImages(String gameId, String updatedAfterRaw) {
        validateGameId(gameId);
        assertGameExists(gameId);
        Instant updatedAfter = parseOptionalInstant(updatedAfterRaw);
        return readStore.getImages(gameId, updatedAfter);
    }

    @Cacheable(cacheNames = "ownerCategories", key = "#gameId")
    public ObjectNode getOwnerCategories(String gameId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        return readStore.getOwnerCategories(gameId);
    }

    public ObjectNode upsertHero(String gameId, String heroId, ObjectNode body, boolean patch) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertHero(gameId, heroId, body, patch);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertSkill(String gameId, String skillId, ObjectNode body, boolean patch) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertSkill(gameId, skillId, body, patch);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertItem(String gameId, String itemId, ObjectNode body, boolean patch) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertItem(gameId, itemId, body, patch);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertAttributeDefinition(String gameId, String attrKey, ObjectNode body, boolean patch) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertAttributeDefinition(gameId, attrKey, body, patch);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertType(String gameId, int typeId, ObjectNode body, boolean patch) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertType(gameId, typeId, body, patch);
        evictNonPublishedReadCaches();
        return response;
    }

    public ObjectNode upsertTypeRelation(
        String gameId,
        int typeId,
        String targetCategory,
        String targetId,
        ObjectNode body,
        boolean patch
    ) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertTypeRelation(gameId, typeId, targetCategory, targetId, body, patch);
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

    public ObjectNode createVersion(String gameId, ObjectNode requestBody) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateAllowedTopLevelFields(requestBody, VERSION_CREATE_ALLOWED_FIELDS);
        return writeStore.createVersion(gameId, requestBody);
    }

    public ObjectNode publishVersion(String gameId, long versionId) {
        validateGameId(gameId);
        assertGameExists(gameId);
        ObjectNode response = writeStore.publishVersion(gameId, versionId);
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
