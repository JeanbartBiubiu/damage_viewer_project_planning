package xyz.game.datamanage.controller.adminapi.imagerelation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.model.imagerelation.ImageOptionResponse;
import xyz.game.datamanage.model.imagerelation.RepresentativeImageResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.imagerelation.ImageRelationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = ImageRelationAdminController.class)
@Import({AdminAuthFilter.class, ImageRelationService.class})
class ImageRelationAdminControllerTest {
    @MockitoBean private xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;
    private static final String ROOT = "/api/admin/games/lol";
    @Autowired MockMvc mvc;
    @MockitoBean GamesMapper games;
    @MockitoBean ImageRelationMapper mapper;
    @MockitoBean GameDataService gameData;
    @MockitoBean JwtVerifier jwt;

    @BeforeEach
    void setup() {
        when(jwt.isDisabled()).thenReturn(true);
        when(jwt.developmentAuthContext()).thenReturn(new AuthContext("author@example.com", true, true));
        when(games.countGames("lol")).thenReturn(1L);
    }

    static Stream<Arguments> sourcePaths() {
        return Stream.of(
            Arguments.of("", "GAME", "", "lol"),
            Arguments.of("/characters/ezreal", "CHARACTER", "", "ezreal"),
            Arguments.of("/attributes/hp", "ATTRIBUTE", "", "hp"),
            Arguments.of("/equipment/sword", "EQUIPMENT", "", "sword"),
            Arguments.of("/skills/q", "SKILL", "", "q"),
            Arguments.of("/skills/q/effects/hit", "SKILL_EFFECT", "q", "hit"),
            Arguments.of("/statuses/burn", "STATUS", "", "burn"),
            Arguments.of("/runes/focus", "RUNE", "", "focus"),
            Arguments.of("/rune-paths/precision", "RUNE_PATH", "", "precision")
        );
    }

    @ParameterizedTest
    @MethodSource("sourcePaths")
    void allExplicitPathsSupportEmptyReadSetReadAndDelete(String prefix, String type, String parent, String key) throws Exception {
        String path = ROOT + prefix + "/representative-image";
        when(mapper.countSource("lol", type, parent, key)).thenReturn(1L);
        if (type.equals("SKILL_EFFECT")) when(mapper.countSource("lol", "SKILL", "", "q")).thenReturn(1L);
        mvc.perform(get(path)).andExpect(status().isOk()).andExpect(content().json("{\"image\":null}"));
        when(mapper.findImage("lol", "icon")).thenReturn(new RepresentativeImageResponse.Image("icon", "图标", true));
        mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content("{\"imageKey\":\" icon \"}"))
            .andExpect(status().isOk()).andExpect(content().json("{\"image\":{\"imageKey\":\"icon\",\"name\":\"图标\",\"enabled\":true}}"));
        verify(mapper).put("lol", type, parent, key, "icon");
        ArgumentCaptor<JsonNode> body = ArgumentCaptor.forClass(JsonNode.class);
        verify(gameData).recordEditLog(eq("author@example.com"), eq("PUT"), eq(path), body.capture(), eq(200));
        assertEquals(type, body.getValue().get("sourceType").asText());
        assertEquals(parent, body.getValue().get("sourceParentKey").asText());
        assertFalse(body.getValue().has("imageBase64"));

        when(mapper.findImageKey("lol", type, parent, key)).thenReturn("icon");
        mvc.perform(get(path)).andExpect(status().isOk()).andExpect(jsonPath("$.image.imageKey").value("icon"));
        when(mapper.deleteForSource("lol", type, parent, key)).thenReturn(1);
        mvc.perform(delete(path)).andExpect(status().isNoContent()).andExpect(content().string(""));
        verify(mapper).deleteForSource("lol", type, parent, key);
        verify(gameData).recordEditLog(eq("author@example.com"), eq("DELETE"), eq(path), any(JsonNode.class), eq(204));
    }

    @Test
    void invalidUnknownAndReadOnlyFieldsAreRejectedBeforeLogging() throws Exception {
        String path = ROOT + "/representative-image";
        for (String body : List.of("{}", "{\"imageKey\":null}", "{\"imageKey\":\" \"}", "{\"imageKey\":\"a/b\"}")) {
            mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("imageKey"));
        }
        mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content("{\"imageKey\":\"icon\",\"enabled\":true}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));
        mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content("{\"imageKey\":[]}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));
        verifyNoInteractions(mapper, gameData);
    }

    @Test
    void disabledDanglingAndMissingRelationsReturnFrozenErrors() throws Exception {
        String path = ROOT + "/representative-image";
        when(mapper.countSource("lol", "GAME", "", "lol")).thenReturn(1L);
        mvc.perform(delete(path)).andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("404.RELATION_NOT_FOUND"));
        when(mapper.findImage("lol", "icon")).thenReturn(new RepresentativeImageResponse.Image("icon", "图标", false));
        mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content("{\"imageKey\":\"icon\"}"))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("409.REFERENCE_DISABLED"));
        when(mapper.findImageKey("lol", "GAME", "", "lol")).thenReturn("missing");
        mvc.perform(get(path)).andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("409.RELATION_DANGLING"))
            .andExpect(jsonPath("$.error.details.imageKey").value("missing"));
        verifyNoInteractions(gameData);
    }

    @Test
    void candidatePathValidatesKeywordAndNeverReturnsImageContent() throws Exception {
        for (String suffix : List.of("", "?keyword=", "?keyword=" + "x".repeat(101))) {
            mvc.perform(get(ROOT + "/image-options" + suffix))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));
        }
        mvc.perform(get(ROOT + "/image-options").param("keyword", "   "))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));
        when(mapper.listOptions("lol", "icon")).thenReturn(List.of(new ImageOptionResponse.Item("icon", "图标")));
        mvc.perform(get(ROOT + "/image-options").param("keyword", " icon "))
            .andExpect(status().isOk()).andExpect(content().json("{\"items\":[{\"imageKey\":\"icon\",\"name\":\"图标\"}],\"total\":1}"))
            .andExpect(jsonPath("$.items[0].imageBase64").doesNotExist());
    }

    @Test
    void usageResponseKeepsAllSevenEmptyArrays() throws Exception {
        when(mapper.findImage("lol", "icon")).thenReturn(new RepresentativeImageResponse.Image("icon", "图标", true));
        mvc.perform(get(ROOT + "/images/icon/usages")).andExpect(status().isOk())
            .andExpect(content().json("{\"imageKey\":\"icon\",\"games\":[],\"characters\":[],\"attributes\":[],\"equipment\":[],\"skills\":[],\"skillEffects\":[],\"statuses\":[]}"));
    }

    @Test
    void genericSourceWriteRouteDoesNotExist() throws Exception {
        mvc.perform(put(ROOT + "/image-relations/CHARACTER/ezreal").contentType(MediaType.APPLICATION_JSON).content("{\"imageKey\":\"icon\"}"))
            .andExpect(status().isNotFound());
    }
}
