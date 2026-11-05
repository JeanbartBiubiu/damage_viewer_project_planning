package xyz.game.datamanage.controller.publicapi;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import xyz.game.datamanage.config.WebCorsConfig;
import xyz.game.datamanage.controller.adminapi.VisitStatisticsAdminController;
import xyz.game.datamanage.service.VisitStatisticsService;
import xyz.game.datamanage.service.VisitStatisticsService.DayStatistics;
import xyz.game.datamanage.support.account.*;
import xyz.game.datamanage.support.auth.AccountControllerTestConfig;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class VisitControllerTest {
    private final VisitStatisticsService statistics = mock(VisitStatisticsService.class);
    private final AccountSessions sessions = mock(AccountSessions.class);
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        var properties = new AccountProperties();
        var json = new ObjectMapper().findAndRegisterModules()
            .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mvc = MockMvcBuilders.standaloneSetup(new VisitPublicController(statistics), new VisitStatisticsAdminController(statistics))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(json))
            .addFilters(new WebCorsConfig().accountCorsFilter(properties).getFilter(),
                new AdminAuthFilter(json, sessions, new AccountBrowser(properties)))
            .build();
    }

    private MockHttpServletRequestBuilder report(String body) {
        return post("/api/visits").contentType("application/json").header("Origin", "https://localhost:5173")
            .header("X-Damage-Client", "web").content(body);
    }

    @Test
    void anonymousReportIgnoresStaleCredentialsAndDoesNotCreateSession() throws Exception {
        var visitor = UUID.randomUUID();
        mvc.perform(report("{\"visitorId\":\"" + visitor + "\"}").cookie(new Cookie(AccountBrowser.SESSION, "invalid")))
            .andExpect(status().isNoContent()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().doesNotExist("Set-Cookie"));
        verify(statistics).recordVisit(visitor);
        verifyNoInteractions(sessions);
    }

    @Test
    void invalidVisitorIdentifiersNeverReachStorage() throws Exception {
        for (String body : List.of("{}", "{\"visitorId\":null}", "{\"visitorId\":\"\"}",
                "{\"visitorId\":\"1-1-1-1-1\"}", "{\"visitorId\":\"not-a-uuid\"}")) {
            mvc.perform(report(body)).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(statistics, sessions);
    }

    @Test
    void reportsRequireAllowedBrowserOriginAndClientMarker() throws Exception {
        String body = "{\"visitorId\":\"" + UUID.randomUUID() + "\"}";
        mvc.perform(post("/api/visits").contentType("application/json").content(body)).andExpect(status().isForbidden());
        mvc.perform(post("/api/visits").contentType("application/json").header("Origin", "https://localhost:5173").content(body))
            .andExpect(status().isForbidden());
        mvc.perform(post("/api/visits").contentType("application/json").header("Origin", "https://other.example")
            .header("X-Damage-Client", "web").content(body)).andExpect(status().isForbidden());
        verifyNoInteractions(statistics, sessions);
    }

    @Test
    void getCannotIncrementVisitsAndPreflightIsAllowedWithoutSession() throws Exception {
        mvc.perform(get("/api/visits")).andExpect(status().isMethodNotAllowed());
        mvc.perform(options("/api/visits").header(HttpHeaders.ORIGIN, "https://localhost:5173")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Content-Type,X-Damage-Client"))
            .andExpect(status().isOk()).andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "https://localhost:5173"));
        verifyNoInteractions(statistics, sessions);
    }

    @Test
    void statisticsRequireSessionAndEditorPrivilege() throws Exception {
        when(sessions.resolve(null)).thenThrow(AccountErrors.invalid());
        mvc.perform(get("/api/admin/visits/last30days")).andExpect(status().isUnauthorized());
        AuthContext editor = AccountControllerTestConfig.editor();
        AuthContext reader = new AuthContext(editor.accountId(), editor.username(), false, editor.sessionId(), editor.authEpoch(), editor.expiresAt());
        doReturn(new AccountSessions.Resolved(reader, new byte[32])).when(sessions).resolve(null);
        mvc.perform(get("/api/admin/visits/last30days")).andExpect(status().isForbidden());
        verifyNoInteractions(statistics);
    }

    @Test
    void editorReadsStatisticsWithoutAllowingAnonymousCorsOrCaching() throws Exception {
        when(sessions.resolve(null)).thenReturn(new AccountSessions.Resolved(AccountControllerTestConfig.editor(), new byte[32]));
        when(statistics.last30Days()).thenReturn(List.of(new DayStatistics(LocalDate.of(2026, 11, 5), 12, 3)));
        mvc.perform(get("/api/admin/visits/last30days").header("Origin", "https://localhost:5173"))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "https://localhost:5173"))
            .andExpect(jsonPath("$[0].date").value("2026-11-05"))
            .andExpect(jsonPath("$[0].pv").value(12)).andExpect(jsonPath("$[0].uv").value(3));
    }
}
