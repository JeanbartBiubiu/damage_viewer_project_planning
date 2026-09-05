package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.mapper.GamesMapper;

@Component
public class PostgresReadStore {

    private final GamesMapper gamesMapper;
    private final ObjectMapper objectMapper;

    public PostgresReadStore(
        GamesMapper gamesMapper,
        ObjectMapper objectMapper
    ) {
        this.gamesMapper = gamesMapper;
        this.objectMapper = objectMapper;
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

    private static String text(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? null : String.valueOf(value);
    }
}
