package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameProgressionSchemaMapper;

@Component
public class PostgresReadStore {

    private static final String DEFAULT_PROGRESSION_KIND = "LEVEL";
    private static final int DEFAULT_STAGE_MIN = 1;
    private static final int DEFAULT_STAGE_MAX = 18;
    private static final String DEFAULT_STAGE_LABEL = "Level";
    private static final boolean DEFAULT_REQUIRE_ALL_STAGES = true;

    private final GamesMapper gamesMapper;
    private final GameVersionsMapper gameVersionsMapper;
    private final ImagesMapper imagesMapper;
    private final CombatGameProgressionSchemaMapper progressionSchemaMapper;
    private final ObjectMapper objectMapper;
    private final PostgresJsonSupport jsonSupport;

    public PostgresReadStore(
        GamesMapper gamesMapper,
        GameVersionsMapper gameVersionsMapper,
        ImagesMapper imagesMapper,
        CombatGameProgressionSchemaMapper progressionSchemaMapper,
        ObjectMapper objectMapper,
        PostgresJsonSupport jsonSupport
    ) {
        this.gamesMapper = gamesMapper;
        this.gameVersionsMapper = gameVersionsMapper;
        this.imagesMapper = imagesMapper;
        this.progressionSchemaMapper = progressionSchemaMapper;
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
        Map<String, Object> row = progressionSchemaMapper.findByGameId(gameId);
        ObjectNode node = objectMapper.createObjectNode();
        if (row == null) {
            node.put("progressionKind", DEFAULT_PROGRESSION_KIND);
            node.put("stageMin", DEFAULT_STAGE_MIN);
            node.put("stageMax", DEFAULT_STAGE_MAX);
            node.put("stageLabel", DEFAULT_STAGE_LABEL);
            node.put("requireAllStages", DEFAULT_REQUIRE_ALL_STAGES);
            return node;
        }
        node.put("progressionKind", text(row, "progressionKind"));
        node.put("stageMin", intValue(row, "stageMin", DEFAULT_STAGE_MIN));
        node.put("stageMax", intValue(row, "stageMax", DEFAULT_STAGE_MAX));
        node.put("stageLabel", text(row, "stageLabel"));
        node.put("requireAllStages", boolValue(row, "requireAllStages", DEFAULT_REQUIRE_ALL_STAGES));
        return node;
    }

    public VersionRecord findCurrentPublishedVersion(String gameId) {
        Map<String, Object> row = gameVersionsMapper.findCurrentPublishedVersion(gameId);
        return row == null ? null : mapVersionRecord(row);
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

    public ObjectNode loadImage(String gameId, String uri) {
        Map<String, Object> row = imagesMapper.findImageByUri(gameId, uri);
        return row == null ? null : mapImageRow(row);
    }

    private ObjectNode mapImageRow(Map<String, Object> row) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("uri", text(row, "uri"));
        node.put("imageBase64", text(row, "imageBase64"));
        node.put("updatedAt", jsonSupport.timestampToIso(timestamp(row, "updatedAt")));
        return node;
    }

    private VersionRecord mapVersionRecord(Map<String, Object> row) {
        Long versionId = longValue(row, "versionId");
        Timestamp updatedAt = timestamp(row, "updatedAt");
        Timestamp publishedAt = timestamp(row, "publishedAt");
        java.sql.Date releaseDate = null;
        Object releaseDateValue = row.get("releaseDate");
        if (releaseDateValue instanceof java.sql.Date sqlDate) {
            releaseDate = sqlDate;
        } else if (releaseDateValue instanceof java.util.Date utilDate) {
            releaseDate = new java.sql.Date(utilDate.getTime());
        }
        return new VersionRecord(
            versionId == null ? -1L : versionId,
            text(row, "versionCode"),
            releaseDate == null ? null : releaseDate.toLocalDate(),
            longValueOrZero(row, "changeRevision"),
            updatedAt == null ? Instant.now() : updatedAt.toInstant(),
            publishedAt == null ? null : publishedAt.toInstant()
        );
    }

    private void putNullableText(ObjectNode node, String fieldName, String value) {
        if (value != null) {
            node.put(fieldName, value);
        }
    }

    private static String text(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private static Long longValue(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (value instanceof Number number) {
            return number.longValue();
        }
        return value == null ? null : Long.parseLong(value.toString());
    }

    private static long longValueOrZero(Map<String, Object> row, String key) {
        Long value = longValue(row, key);
        return value == null ? 0L : value;
    }

    private static int intValue(Map<String, Object> row, String key, int fallback) {
        Object value = row.get(key);
        if (value instanceof Number number) {
            return number.intValue();
        }
        return value == null ? fallback : Integer.parseInt(value.toString());
    }

    private static boolean boolValue(Map<String, Object> row, String key, boolean fallback) {
        Object value = row.get(key);
        if (value instanceof Boolean bool) {
            return bool;
        }
        return value == null ? fallback : Boolean.parseBoolean(value.toString());
    }

    private static Timestamp timestamp(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (value instanceof Timestamp timestamp) {
            return timestamp;
        }
        if (value instanceof java.util.Date date) {
            return new Timestamp(date.getTime());
        }
        return null;
    }

    public record VersionRecord(
        long versionId,
        String versionCode,
        java.time.LocalDate releaseDate,
        long changeRevision,
        Instant updatedAt,
        Instant publishedAt
    ) {
    }
}
