package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class AccountControllerTest {
    private final AccountService service=mock(AccountService.class);
    private final AccountSessions sessions=mock(AccountSessions.class);
    private MockMvc mvc;
    private final Instant now=Instant.parse("2026-11-04T00:00:00Z");
    @BeforeEach void setup() {
        AccountBrowser browser=new AccountBrowser(new AccountProperties());
        ObjectMapper json=Jackson2ObjectMapperBuilder.json().featuresToEnable(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY)
            .featuresToDisable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();
        mvc=MockMvcBuilders.standaloneSetup(new AccountController(service,browser)).setControllerAdvice(new AccountExceptionHandler())
            .setMessageConverters(new MappingJackson2HttpMessageConverter(json)).addFilters(new AdminAuthFilter(json,sessions,browser,org.mockito.Mockito.mock(xyz.game.datamanage.support.maintenance.MaintenanceSessions.class))).build();
    }
    private MockHttpServletRequestBuilder postJson(String path,String body) {
        return post("/api/auth/"+path).contentType("application/json").header("Origin","https://localhost:5173").header("X-Damage-Client","web").content(body);
    }
    @Test void registerReturnsOnlyFrozenFlowViewAndSecureSeparateCookies() throws Exception {
        UUID account=UUID.randomUUID();
        when(service.register(eq("fixture_author"),eq("fixture-password"),anyString())).thenReturn(new AccountService.Issued(
            Map.of("accountId",account,"purpose","register","phase","started","expiresAt",now.plusSeconds(600)),"t".repeat(43),"c".repeat(43),now,now.plusSeconds(600),false));
        var result=mvc.perform(postJson("register","{\"username\":\"fixture_author\",\"password\":\"fixture-password\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.purpose").value("register")).andExpect(jsonPath("$.phase").value("started"))
            .andExpect(jsonPath("$.accountId").value(account.toString())).andExpect(jsonPath("$.expiresAt").isString()).andExpect(jsonPath("$.token").doesNotExist())
            .andExpect(header().string("Cache-Control","no-store")).andReturn();
        assertTrue("c".repeat(43).equals(result.getResponse().getHeader(AccountBrowser.FLOW_CSRF_HEADER)));
        var cookies=result.getResponse().getHeaders("Set-Cookie"); assertEquals(2,cookies.size());
        assertTrue(cookies.stream().allMatch(s->s.contains("Secure") && s.contains("SameSite=Strict") && s.contains("Path=/") && !s.contains("Domain=")));
        assertTrue(cookies.stream().anyMatch(s->s.startsWith(AccountBrowser.FLOW+"=") && s.contains("HttpOnly")));
        assertTrue(cookies.stream().anyMatch(s->s.startsWith(AccountBrowser.FLOW_CSRF+"=") && !s.contains("HttpOnly")));
    }
    @Test void rejectsPrivilegeFieldsUnknownFieldsDuplicateKeysAndNumericTotpWithoutEchoingInput() throws Exception {
        for (String body:java.util.List.of("{\"username\":\"fixture\",\"password\":\"fixture-password\",\"canLogin\":1}",
            "{\"username\":\"fixture\",\"password\":\"fixture-password\",\"canEdit\":true}",
            "{\"username\":\"fixture\",\"password\":\"fixture-password\",\"password\":\"another-secret\"}")) {
            var response=mvc.perform(postJson("register",body)).andExpect(status().isBadRequest()).andReturn().getResponse();
            assertFalse(response.getContentAsString().contains("fixture-password"));assertFalse(response.getContentAsString().contains("another-secret"));
        }
        mvc.perform(postJson("login/totp","{\"totpCode\":12345}")).andExpect(status().isBadRequest());verifyNoInteractions(service);
    }
    @Test void totpStringPreservesLeadingZeroAndSessionResponseMatchesMeContract() throws Exception {
        UUID account=UUID.randomUUID();
        Instant expiry=now.plus(java.time.Duration.ofDays(30));
        when(service.loginTotp(any(),eq("012345"))).thenReturn(new AccountService.Issued(Map.of("accountId",account,"username","fixture_author","canLogin",1,"expiresAt",expiry),"s".repeat(43),"c".repeat(43),now,expiry,true));
        var response=mvc.perform(postJson("login/totp","{\"totpCode\":\"012345\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.canLogin").value(1)).andExpect(jsonPath("$.canEdit").doesNotExist())
            .andExpect(jsonPath("$.username").value("fixture_author")).andExpect(jsonPath("$.expiresAt").value(expiry.toString()))
            .andReturn().getResponse();
        var issued=response.getHeaders("Set-Cookie");
        assertEquals(2,issued.size());
        for(String name:java.util.List.of(AccountBrowser.SESSION,AccountBrowser.CSRF)) {
            String cookie=issued.stream().filter(value->value.startsWith(name+"=")).findFirst().orElseThrow();
            assertTrue(cookie.contains("Max-Age=2592000"));assertTrue(cookie.contains("Secure"));assertTrue(cookie.contains("SameSite=Strict"));
            assertEquals(name.equals(AccountBrowser.SESSION),cookie.contains("HttpOnly"));
        }
        verify(service).loginTotp(any(),eq("012345"));
    }
    @Test void completedFlowRetainsOriginalFlowCookieAndClearsOnlySession() throws Exception {
        when(service.confirmRecoveryCodes(any())).thenAnswer(i->{((jakarta.servlet.http.HttpServletRequest)i.getArgument(0)).setAttribute(AccountBrowser.FLOW_CSRF_RESPONSE_ATTR,"c".repeat(43));return Map.of("phase","completed");});
        var response=mvc.perform(postJson("flow/recovery-codes/confirm","{}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.phase").value("completed")).andReturn().getResponse();
        assertTrue(response.getHeaders("Set-Cookie").stream().noneMatch(s->s.startsWith(AccountBrowser.FLOW+"=") || s.startsWith(AccountBrowser.FLOW_CSRF+"=")));
        assertTrue(response.getHeaders("Set-Cookie").stream().allMatch(s->s.contains("Max-Age=0")));
        assertTrue("c".repeat(43).equals(response.getHeader(AccountBrowser.FLOW_CSRF_HEADER)));
    }
    @Test void rateLimitResponseCarriesRetryAfterAndSafeErrorWrapper() throws Exception {
        when(service.login(anyString(),anyString(),anyString())).thenThrow(new xyz.game.datamanage.support.error.ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,"AUTH.RATE_LIMITED","稍后重试",Map.of("retryAfter",18)));
        mvc.perform(postJson("login","{\"username\":\"fixture\",\"password\":\"fixture-password\"}"))
            .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After","18")).andExpect(jsonPath("$.error.code").value("AUTH.RATE_LIMITED"));
    }
}
