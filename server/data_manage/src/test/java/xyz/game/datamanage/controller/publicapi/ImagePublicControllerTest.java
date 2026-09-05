package xyz.game.datamanage.controller.publicapi;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.model.image.ImagePublicItemResponse;
import xyz.game.datamanage.model.image.ImagePublicListResponse;
import xyz.game.datamanage.service.image.ImageService;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = ImagePublicController.class)
class ImagePublicControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ImageService imageService;

    @MockitoBean
    private JwtVerifier jwtVerifier;

    @Test
    void getImagesReturnsStoredPayload() throws Exception {
        ImagePublicListResponse response = new ImagePublicListResponse(
            "lol",
            List.of(new ImagePublicItemResponse(
                "icon",
                true,
                "data:image/png;base64,abc",
                OffsetDateTime.parse("2026-09-05T00:00:00Z")
            ))
        );
        when(imageService.listPublic("lol", null)).thenReturn(response);

        mockMvc.perform(get("/api/games/lol/images"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.images[0].imageKey").value("icon"));
    }
}
