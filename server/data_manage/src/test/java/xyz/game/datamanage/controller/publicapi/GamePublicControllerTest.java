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
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;

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
        lol.putNull("representativeImageKey");
        games.addObject().put("gameId", "dota2").put("gameName", "Dota 2")
            .put("representativeImageKey", "dota_cover");
        when(gameDataService.listGames()).thenReturn(games);

        String body = mockMvc.perform(get("/api/games"))
            .andExpect(status().isOk())
            .andExpect(header().exists(HttpHeaders.ETAG))
            .andExpect(jsonPath("$[0].gameId").value("lol"))
            .andExpect(jsonPath("$[0].gameName").value("英雄联盟"))
            .andExpect(jsonPath("$[0].representativeImageKey").value(nullValue()))
            .andExpect(jsonPath("$[0].gameImgUrl").doesNotExist())
            .andExpect(jsonPath("$[1].representativeImageKey").value("dota_cover"))
            .andExpect(jsonPath("$[0].progressionSchema").doesNotExist())
            .andReturn()
            .getResponse()
            .getContentAsString();

        ObjectNode first = (ObjectNode) objectMapper.readTree(body).get(0);
        assertEquals(Set.of("gameId", "gameName", "representativeImageKey"), fieldNames(first));
    }

    @Test
    void danglingRepresentativeImageReturnsConflictWithLocation() throws Exception {
        when(gameDataService.listGames()).thenThrow(new ApiException(
            HttpStatus.CONFLICT, "409.RELATION_DANGLING", "游戏代表图片关系指向不存在的图片",
            Map.of("gameId", "lol", "sourceType", "GAME", "sourceParentKey", "",
                "sourceKey", "lol", "imageKey", "missing_cover")
        ));

        mockMvc.perform(get("/api/games"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("409.RELATION_DANGLING"))
            .andExpect(jsonPath("$.error.details.sourceType").value("GAME"))
            .andExpect(jsonPath("$.error.details.sourceKey").value("lol"))
            .andExpect(jsonPath("$.error.details.imageKey").value("missing_cover"));
    }

    private static Set<String> fieldNames(ObjectNode node) {
        List<String> names = new ArrayList<>();
        Iterator<String> iterator = node.fieldNames();
        iterator.forEachRemaining(names::add);
        return new LinkedHashSet<>(names);
    }
}
