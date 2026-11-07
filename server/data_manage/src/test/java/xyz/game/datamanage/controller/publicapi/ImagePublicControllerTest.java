package xyz.game.datamanage.controller.publicapi;

import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.image.ImageMapper;
import xyz.game.datamanage.model.image.ImagePublicItemResponse;
import xyz.game.datamanage.model.image.ImagePublicListResponse;
import xyz.game.datamanage.service.image.ImageService;
import xyz.game.datamanage.service.image.ImageContentValidator;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = ImagePublicController.class)
@org.springframework.context.annotation.Import(xyz.game.datamanage.support.auth.AccountControllerTestConfig.class)
class ImagePublicControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ImageService imageService;



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
            .andExpect(jsonPath("$.images[0].imageKey").value("icon"))
            .andExpect(jsonPath("$.images[0].imageBase64").value("data:image/png;base64,abc"));
    }

    @Test
    void realServiceRejectsOverflowingCursorBeforeImageQuery() throws Exception {
        GamesMapper games = mock(GamesMapper.class);
        ImageMapper images = mock(ImageMapper.class);
        when(games.countGames("lol")).thenReturn(1L);
        MockMvc mvc = realServiceMvc(games, images);

        for (String cursor : List.of(
            "+1000000000-12-31T23:59:59.999999999Z",
            "-1000000000-01-01T00:00:00Z"
        )) {
            mvc.perform(get("/api/games/lol/images").param("updatedAfter", cursor))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("updatedAfter"))
                .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("FORMAT_INVALID"));
        }
        verify(images, never()).listPublic(any(), any());
    }

    @Test
    void realServicePassesValidCursorWithNanosecondsUnchanged() throws Exception {
        GamesMapper games = mock(GamesMapper.class);
        ImageMapper images = mock(ImageMapper.class);
        when(games.countGames("lol")).thenReturn(1L);
        Instant instant = Instant.parse("2026-11-07T00:00:00.123456789Z");
        when(images.listPublic(eq("lol"), any(Timestamp.class))).thenReturn(List.of(
            new ImagePublicItemResponse("icon", true, "data:image/png;base64,abc", instant.atOffset(java.time.ZoneOffset.UTC))
        ));

        realServiceMvc(games, images).perform(get("/api/games/lol/images").param("updatedAfter", instant.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.images[0].imageKey").value("icon"));

        org.mockito.ArgumentCaptor<Timestamp> cursor = org.mockito.ArgumentCaptor.forClass(Timestamp.class);
        verify(images).listPublic(eq("lol"), cursor.capture());
        org.junit.jupiter.api.Assertions.assertEquals(instant, cursor.getValue().toInstant());
    }

    private static MockMvc realServiceMvc(GamesMapper games, ImageMapper images) {
        ImageService service = new ImageService(games, images, new ImageContentValidator(), mock(GameConfigurationWriteGuard.class));
        return MockMvcBuilders.standaloneSetup(new ImagePublicController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }
}
