package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.springframework.stereotype.Service;

@Service
public class GameDataService {

    private final PostgresReadStore readStore;
    private final PostgresWriteStore writeStore;

    public GameDataService(
        PostgresReadStore readStore,
        PostgresWriteStore writeStore
    ) {
        this.readStore = readStore;
        this.writeStore = writeStore;
    }

    public ArrayNode listGames() {
        return readStore.listGames();
    }

    public void recordEditLog(java.util.UUID accountId, String username, String method, String path, JsonNode requestBody, int responseCode) {
        writeStore.recordEditLog(accountId, username, method, path, requestBody, responseCode);
    }
}
