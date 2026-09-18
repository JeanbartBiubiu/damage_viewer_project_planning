package xyz.game.datamanage.controller.adminapi.status;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.status.StatusCreateRequest;
import xyz.game.datamanage.model.status.StatusListQuery;
import xyz.game.datamanage.model.status.StatusListResponse;
import xyz.game.datamanage.model.status.StatusRecordStatus;
import xyz.game.datamanage.model.status.StatusKind;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.model.status.StatusUpdateRequest;
import xyz.game.datamanage.service.status.StatusService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = StatusAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class StatusAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/statuses";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private StatusService service;
    @MockitoBean private AdminEditLogHelper logHelper;
    @MockitoBean private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("admin@example.com", true, true));
    }

    @Test
    void listsGetsCreatesUpdatesAndDeletesWithFullResponseAndEditLogs() throws Exception {
        StatusResponse response = response();
        when(service.list(eq("lol"), any(StatusListQuery.class)))
            .thenReturn(new StatusListResponse(List.of(response), 1));
        when(service.get("lol", "poison")).thenReturn(response);
        when(service.create(eq("lol"), any(StatusCreateRequest.class))).thenReturn(response);
        when(service.update(eq("lol"), eq("poison"), any(StatusUpdateRequest.class))).thenReturn(response);

        mockMvc.perform(get(BASE_PATH).queryParam("status", "ENABLED"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].statusKey").value("poison"))
            .andExpect(jsonPath("$.items[0].status").value("ENABLED"));

        mockMvc.perform(get(BASE_PATH + "/poison"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.statusKey").value("poison"))
            .andExpect(jsonPath("$.name").value("中毒"))
            .andExpect(jsonPath("$.description").value(nullValue()))
            .andExpect(jsonPath("$.status").value("ENABLED"))
            .andExpect(jsonPath("$.sortOrder").value(10));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"statusKey":"poison","name":"中毒","description":null,"statusKind":"STUN","status":"ENABLED","sortOrder":10}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.statusKey").value("poison"))
            .andExpect(jsonPath("$.status").value("ENABLED"));

        mockMvc.perform(put(BASE_PATH + "/poison")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"中毒","description":null,"statusKind":"STUN","status":"ENABLED","sortOrder":10}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ENABLED"));

        mockMvc.perform(delete(BASE_PATH + "/poison"))
            .andExpect(status().isNoContent());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    @Test
    void invalidJsonEnumReturnsInvalidBodyBeforeService() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"statusKey":"poison","name":"中毒","status":"ARCHIVED","sortOrder":10}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        verify(service, never()).create(any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void putStatusKeyIsRejectedAsImmutable() throws Exception {
        mockMvc.perform(put(BASE_PATH + "/poison")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"statusKey":"poison","name":"中毒","statusKind":"STUN","status":"ENABLED","sortOrder":10}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("statusKey"));

        verify(service, never()).update(any(), any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void rejectsMissingOrUnknownStatusKindAtHttpBoundary() throws Exception {
        mockMvc.perform(post(BASE_PATH).contentType(MediaType.APPLICATION_JSON).content("""
            {"statusKey":"slow","name":"减速","status":"ENABLED","sortOrder":0}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("statusKind"));
        mockMvc.perform(post(BASE_PATH).contentType(MediaType.APPLICATION_JSON).content("""
            {"statusKey":"slow","name":"减速","statusKind":"UNKNOWN","status":"ENABLED","sortOrder":0}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));
        verify(service, never()).create(any(), any());
    }

    private static StatusResponse response() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-27T00:00:00Z");
        return new StatusResponse(
            "lol", "poison", "中毒", null, StatusKind.STUN, StatusRecordStatus.ENABLED, 10, timestamp, timestamp
        );
    }
}
