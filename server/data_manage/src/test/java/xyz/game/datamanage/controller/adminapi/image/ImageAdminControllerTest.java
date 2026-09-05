package xyz.game.datamanage.controller.adminapi.image;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.image.ImageCreateRequest;
import xyz.game.datamanage.model.image.ImageListQuery;
import xyz.game.datamanage.model.image.ImageListResponse;
import xyz.game.datamanage.model.image.ImageResponse;
import xyz.game.datamanage.model.image.ImageUpdateRequest;
import xyz.game.datamanage.service.image.ImageService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = ImageAdminController.class)
@Import(AdminAuthFilter.class)
class ImageAdminControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ImageService imageService;

    @MockitoBean
    private AdminEditLogHelper adminEditLogHelper;

    @MockitoBean
    private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("author@example.com", true, true));
    }

    @Test
    void listAndGetUseFrozenImageKeyContract() throws Exception {
        ImageResponse image = image("icon");
        when(imageService.list(eq("lol"), any(ImageListQuery.class)))
            .thenReturn(new ImageListResponse(List.of(image), 1));
        when(imageService.get("lol", "icon")).thenReturn(image);

        mockMvc.perform(get("/api/admin/games/lol/images?keyword=ico&enabled=true"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].imageKey").value("icon"));
        mockMvc.perform(get("/api/admin/games/lol/images/icon"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.imageKey").value("icon"));
    }

    @Test
    void createLogsMetadataWithoutImageContent() throws Exception {
        when(imageService.create(eq("lol"), any())).thenReturn(image("icon"));

        mockMvc.perform(
                post("/api/admin/games/lol/images")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "imageKey":"icon",
                          "name":"图标",
                          "description":null,
                          "imageBase64":"data:image/png;base64,abc"
                        }
                        """)
            )
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.imageKey").value("icon"));

        ArgumentCaptor<JsonNode> logBody = ArgumentCaptor.forClass(JsonNode.class);
        verify(adminEditLogHelper).log(any(), any(), logBody.capture(), eq(201));
        assertFalse(logBody.getValue().has("imageBase64"));
        assertTrue(logBody.getValue().get("imageReplaced").asBoolean());
    }

    @Test
    void updateCanKeepExistingContent() throws Exception {
        when(imageService.update(eq("lol"), eq("icon"), any(ImageUpdateRequest.class)))
            .thenReturn(image("icon"));

        mockMvc.perform(
                put("/api/admin/games/lol/images/icon")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "name":"图标",
                          "description":"说明",
                          "enabled":false
                        }
                        """)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.imageKey").value("icon"));

        ArgumentCaptor<JsonNode> logBody = ArgumentCaptor.forClass(JsonNode.class);
        verify(adminEditLogHelper).log(any(), any(), logBody.capture(), eq(200));
        assertFalse(logBody.getValue().has("imageBase64"));
        assertFalse(logBody.getValue().get("imageReplaced").asBoolean());
    }

    @Test
    void jsonBindingKeepsUnknownFieldsForServiceValidation() throws Exception {
        when(imageService.create(eq("lol"), any())).thenReturn(image("icon"));

        mockMvc.perform(
                post("/api/admin/games/lol/images")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "imageKey":"icon",
                          "name":"图标",
                          "imageBase64":"data:image/png;base64,abc",
                          "width":64
                        }
                        """)
            )
            .andExpect(status().isCreated());

        ArgumentCaptor<ImageCreateRequest> body = ArgumentCaptor.forClass(ImageCreateRequest.class);
        verify(imageService).create(eq("lol"), body.capture());
        assertTrue(body.getValue().unknownFields().contains("width"));
    }

    @Test
    void explicitNullImageContentRemainsDistinguishableFromOmission() throws Exception {
        when(imageService.update(eq("lol"), eq("icon"), any(ImageUpdateRequest.class)))
            .thenReturn(image("icon"));

        mockMvc.perform(
                put("/api/admin/games/lol/images/icon")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "name":"图标",
                          "description":null,
                          "enabled":true,
                          "imageBase64":null
                        }
                        """)
            )
            .andExpect(status().isOk());

        ArgumentCaptor<ImageUpdateRequest> body = ArgumentCaptor.forClass(ImageUpdateRequest.class);
        verify(imageService).update(eq("lol"), eq("icon"), body.capture());
        assertTrue(body.getValue().replacesContent());
        assertTrue(body.getValue().imageBase64().isNull());
    }

    private static ImageResponse image(String key) {
        OffsetDateTime now = OffsetDateTime.parse("2026-09-05T00:00:00Z");
        return new ImageResponse(
            "lol",
            key,
            "图标",
            null,
            "data:image/png;base64,abc",
            "image/png",
            3,
            32,
            32,
            true,
            now,
            now
        );
    }
}
