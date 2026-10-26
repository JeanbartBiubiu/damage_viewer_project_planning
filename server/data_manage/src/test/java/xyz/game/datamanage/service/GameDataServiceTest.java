package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class GameDataServiceTest {

    @Mock private PostgresReadStore readStore;
    @Mock private PostgresWriteStore writeStore;

    @Test
    void eachReadReturnsTheCurrentPostgresSnapshot() {
        ArrayNode before = JsonNodeFactory.instance.arrayNode();
        before.addObject().put("gameId", "lol").put("gameName", "英雄联盟")
            .put("representativeImageKey", "lol_cover");
        ArrayNode after = JsonNodeFactory.instance.arrayNode();
        after.addObject().put("gameId", "lol").put("gameName", "英雄联盟")
            .putNull("representativeImageKey");
        when(readStore.listGames()).thenReturn(before, after);
        GameDataService service = new GameDataService(readStore, writeStore);

        assertSame(before, service.listGames());
        assertSame(after, service.listGames());
        assertEquals("lol_cover", before.get(0).get("representativeImageKey").asText());
        verify(readStore, times(2)).listGames();
    }

    @Test
    void databaseFailureAfterASuccessfulReadDoesNotReturnTheEarlierSnapshot() {
        ArrayNode earlier = JsonNodeFactory.instance.arrayNode();
        earlier.addObject().put("gameId", "lol").put("gameName", "英雄联盟");
        IllegalStateException failure = new IllegalStateException("数据库读取失败");
        when(readStore.listGames()).thenReturn(earlier).thenThrow(failure);
        GameDataService service = new GameDataService(readStore, writeStore);

        assertSame(earlier, service.listGames());
        assertSame(failure, assertThrows(IllegalStateException.class, service::listGames));
        verify(readStore, times(2)).listGames();
    }
}
