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
import xyz.game.datamanage.mapper.ImagesMapper;

@Component
public class PostgresReadStore {

    private final GamesMapper gamesMapper;
    private final ImagesMapper imagesMapper;
    private final ObjectMapper objectMapper;
    private final PostgresJsonSupport jsonSupport;

    public PostgresReadStore(
        GamesMapper gamesMapper,
        ImagesMapper imagesMapper,
        ObjectMapper objectMapper,
        PostgresJsonSupport jsonSupport
    ) {
        this.gamesMapper = gamesMapper;
        this.imagesMapper = imagesMapper;
        this.objectMapper = objectMapper;
        this.jsonSupport = jsonSupport;
    }

    public ArrayNode listGames() {
        ArrayNode array = objectMapper.createArrayNode();
        for (Map<String, Object> row : gamesMapper.listGames()) {
            ObjectNode node = objectMapper.createObjectNode();
            node.put("gameId", text(row, "gameId"));
            node.put("gameName", text(row, "gameName"));
            String gameImgUrl = text(row, "gameImgUrl");
            if (gameImgUrl == null) {
                node.putNull("gameImgUrl");
            } else {
                node.put("gameImgUrl", gameImgUrl);
            }
            array.add(node);
        }
        return array;
    }

    public boolean gameExists(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        return count != null && count > 0;
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

    private static String text(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? null : String.valueOf(value);
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
}
