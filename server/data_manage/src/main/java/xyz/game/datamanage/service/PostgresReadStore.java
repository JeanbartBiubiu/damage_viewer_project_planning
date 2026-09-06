package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.support.error.ApiException;

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
            String gameId = text(row, "gameId");
            String imageKey = text(row, "representativeImageKey");
            if (Boolean.TRUE.equals(row.get("representativeImageDangling"))) {
                throw new ApiException(
                    HttpStatus.CONFLICT,
                    "409.RELATION_DANGLING",
                    "游戏代表图片关系指向不存在的图片",
                    Map.of(
                        "gameId", gameId,
                        "sourceType", "GAME",
                        "sourceParentKey", "",
                        "sourceKey", gameId,
                        "imageKey", imageKey
                    )
                );
            }
            ObjectNode node = objectMapper.createObjectNode();
            node.put("gameId", gameId);
            node.put("gameName", text(row, "gameName"));
            if (imageKey == null) {
                node.putNull("representativeImageKey");
            } else {
                node.put("representativeImageKey", imageKey);
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
