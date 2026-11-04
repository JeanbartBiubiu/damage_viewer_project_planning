package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 使用真实Spring MVC路径匹配：即使过滤器未执行，已映射内部入口仍先认证再查账号。 */
class InternalAccountRoutingTest {
    @TempDir Path directory;
    private final AccountMaintenance maintenance=mock(AccountMaintenance.class);
    private final UUID account=UUID.randomUUID();
    private final String token="x".repeat(43);
    private MockMvc controllerOnly,withFilter;
    @BeforeEach void setup() throws Exception {
        AccountProperties p=new AccountProperties();p.setInternalTokenPath(directory.resolve("internal-token.txt"));Files.writeString(p.getInternalTokenPath(),token);
        InternalAccountGuard guard=new InternalAccountGuard(p);var controller=new InternalAccountController(maintenance,guard);
        controllerOnly=MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new AccountExceptionHandler()).build();
        withFilter=MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new AccountExceptionHandler())
            .addFilters(new InternalAccountFilter(guard,new ObjectMapper())).build();
    }
    private MockHttpServletRequestBuilder request(String path) {
        return post(URI.create(path)).contentType("application/json").content("{\"enablementReference\":\"fixture-reference\"}")
            .with(r->{r.setRemoteAddr("127.0.0.1");return r;});
    }
    private List<String> mappedVariants() {
        return List.of("/internal;probe/accounts/"+account+"/enable-login",
            "/internal/accounts;probe/"+account+"/enable-login",
            "/internal/accounts/"+account+";probe/enable-login",
            "/internal/accounts/"+account+"/enable-login;probe",
            "/%69nternal/accounts/"+account+"/enable-login",
            "/internal/%61ccounts/"+account+"/enable-login");
    }
    @Test void matrixAndPercentEncodedMappedPathsCannotBypassTheControllerGuardEvenWithoutFilter() throws Exception {
        for (String path:mappedVariants()) {
            controllerOnly.perform(request(path)).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("AUTH.INTERNAL_UNAUTHORIZED"));
            withFilter.perform(request(path)).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("AUTH.INTERNAL_UNAUTHORIZED"));
        }
        verifyNoInteractions(maintenance);
    }
    @Test void encodedOrMatrixPathStillRequiresTrustedDirectAddressEvenWithCorrectServiceCredential() throws Exception {
        for(String path:mappedVariants()) controllerOnly.perform(request(path).header("X-Damage-Internal-Token",token)
                .header("X-Forwarded-For","127.0.0.1").with(r->{r.setRemoteAddr("203.0.113.7");return r;}))
            .andExpect(status().isUnauthorized());
        verifyNoInteractions(maintenance);
    }
    @Test void authenticatedCanonicalizedRouteCallsTheSameBusinessOperationOnce() throws Exception {
        when(maintenance.enable(account,"fixture-reference")).thenReturn(Map.of("accountId",account,"canLogin",1,"enabledAt","2026-11-05T00:00:00Z","changed",true));
        withFilter.perform(request("/internal;probe/accounts/"+account+"/enable-login").header("X-Damage-Internal-Token",token))
            .andExpect(status().isOk()).andExpect(jsonPath("$.changed").value(true));
        verify(maintenance).enable(account,"fixture-reference");verifyNoMoreInteractions(maintenance);
    }
    @Test void ambiguousEncodedDelimitersAreRejectedWithoutAnyBusinessLookup() throws Exception {
        for (String path:List.of("/internal%3Bprobe/accounts/"+account+"/enable-login","/%2569nternal/accounts/"+account+"/enable-login","/internal%2Faccounts/"+account+"/enable-login")) {
            int status=controllerOnly.perform(request(path)).andReturn().getResponse().getStatus();
            assertTrue(status==400 || status==401 || status==404);
        }
        verifyNoInteractions(maintenance);
    }
}
