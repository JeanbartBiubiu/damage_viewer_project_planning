package xyz.game.datamanage.controller.publicapi;

import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = GamePublicController.class)
class GamePublicControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private GameDataService gameDataService;

    @MockitoBean
    private JwtVerifier jwtVerifier;

    @Test
    void listGamesReturnsOnlyFrozenSummaryFields() throws Exception {
        ArrayNode games = JsonNodeFactory.instance.arrayNode();
        ObjectNode lol = games.addObject();
        lol.put("gameId", "lol");
        lol.put("gameName", "英雄联盟");
        lol.putNull("gameImgUrl");
        when(gameDataService.listGames()).thenReturn(games);

        String body = mockMvc.perform(get("/api/games"))
            .andExpect(status().isOk())
            .andExpect(header().exists(HttpHeaders.ETAG))
            .andExpect(jsonPath("$[0].gameId").value("lol"))
            .andExpect(jsonPath("$[0].gameName").value("英雄联盟"))
            .andExpect(jsonPath("$[0].gameImgUrl").value(nullValue()))
            .andExpect(jsonPath("$[0].progressionSchema").doesNotExist())
            .andReturn()
            .getResponse()
            .getContentAsString();

        ObjectNode first = (ObjectNode) objectMapper.readTree(body).get(0);
        assertEquals(Set.of("gameId", "gameName", "gameImgUrl"), fieldNames(first));
    }

    private static Set<String> fieldNames(ObjectNode node) {
        List<String> names = new ArrayList<>();
        Iterator<String> iterator = node.fieldNames();
        iterator.forEachRemaining(names::add);
        return new LinkedHashSet<>(names);
    }
}
