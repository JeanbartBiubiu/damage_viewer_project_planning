package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Map;
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

    public ObjectNode upsertImage(String gameId, String uri, ObjectNode body) {
        validateGameId(gameId);
        assertGameExists(gameId);
        jsonSupport.validateNoVersionFields(body, "");
        ObjectNode response = writeStore.upsertImage(gameId, uri, body);
        evictCache("images");
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
