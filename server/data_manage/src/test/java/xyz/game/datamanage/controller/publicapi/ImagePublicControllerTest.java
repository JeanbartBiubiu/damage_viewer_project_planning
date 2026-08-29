package xyz.game.datamanage.controller.publicapi;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = ImagePublicController.class)
class ImagePublicControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GameDataService gameDataService;

    @MockitoBean
    private JwtVerifier jwtVerifier;

    @Test
    void getImagesReturnsStoredPayload() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", "lol");
        response.putArray("images").addObject()
            .put("uri", "icon")
            .put("imageBase64", "data:image/png;base64,abc");
        when(gameDataService.getImages("lol", null)).thenReturn(response);

        mockMvc.perform(get("/api/games/lol/images"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.images[0].uri").value("icon"));
    }
}
