package xyz.game.datamanage.support.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import xyz.game.datamanage.support.account.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class AdminAuthFilterTest {
    private final AccountSessions sessions=mock(AccountSessions.class);
    private final AccountBrowser browser=new AccountBrowser(new AccountProperties());
    private final xyz.game.datamanage.support.maintenance.MaintenanceSessions maintenance=mock(xyz.game.datamanage.support.maintenance.MaintenanceSessions.class);
    private final AdminAuthFilter filter=new AdminAuthFilter(new ObjectMapper(),sessions,browser,maintenance);
    private final FilterChain chain=mock(FilterChain.class);
    private MockHttpServletRequest write(String path) {
        var r=new MockHttpServletRequest("POST",path); r.setContentType("application/json");
        r.addHeader("Origin","https://localhost:5173"); r.addHeader("X-Damage-Client","web"); r.setContent("{}".getBytes()); return r;
    }
    @Test void allGameReadsAndOnlySnapshotPostIgnoreInvalidCookiesAndCsrf() throws Exception {
        for (String path:java.util.List.of("/api/games","/api/admin/games/lol/skills/x/configuration","/api/games/lol/images")) {
            var r=new MockHttpServletRequest("GET",path); r.setCookies(new Cookie(AccountBrowser.SESSION,"invalid"));
            var response=new MockHttpServletResponse(); filter.doFilter(r,response,chain);
            assertEquals(200,response.getStatus()); assertNull(r.getAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR));
        }
        var r=new MockHttpServletRequest("POST","/api/admin/games/lol/simulation-snapshot");
        r.setCookies(new Cookie(AccountBrowser.SESSION,"invalid"));
        var response=new MockHttpServletResponse(); filter.doFilter(r,response,chain);
        assertEquals(200,response.getStatus()); verifyNoInteractions(sessions);
    }
    @Test void bootstrapIgnoresResidualCookiesAndOldCsrfButRequiresBrowserProof() throws Exception {
        for (String path:java.util.List.of("register","login","recovery/password","recovery/totp")) {
            var r=write("/api/auth/"+path); r.setCookies(new Cookie(AccountBrowser.SESSION,"invalid"),new Cookie(AccountBrowser.FLOW,"invalid"));
            var response=new MockHttpServletResponse(); filter.doFilter(r,response,chain);
            assertEquals(200,response.getStatus()); assertEquals("no-store",response.getHeader("Cache-Control"));
        }
        var missing=new MockHttpServletResponse(); filter.doFilter(new MockHttpServletRequest("POST","/api/auth/login"),missing,chain);
        assertEquals(403,missing.getStatus()); verifyNoInteractions(sessions);
    }
    @Test void playerSessionCannotWriteAndMaintenanceContextCarriesExactBody() throws Exception {
        var r=write("/api/admin/games/lol/skills");
        when(maintenance.require(any(),eq(true))).thenThrow(AccountErrors.invalid());
        var response=new MockHttpServletResponse(); filter.doFilter(r,response,chain); assertEquals(401,response.getStatus());
        verifyNoInteractions(sessions);
        var identity=AccountControllerTestConfig.editor();
        when(maintenance.require(any(),eq(true))).thenReturn(new xyz.game.datamanage.support.maintenance.MaintenanceSessions.Resolved(identity,new byte[32]));
        response=new MockHttpServletResponse();filter.doFilter(r,response,chain);assertEquals(200,response.getStatus());
        assertEquals(identity,r.getAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR));
        assertArrayEquals("{}".getBytes(),(byte[])r.getAttribute(xyz.game.datamanage.support.maintenance.MaintenanceBatches.BODY));
    }
    @Test void otherGetPathsRemainPrivateAndOversizedBootstrapIsRejected() throws Exception {
        when(sessions.resolve(null)).thenThrow(AccountErrors.invalid());
        var response=new MockHttpServletResponse(); filter.doFilter(new MockHttpServletRequest("GET","/api/auth/me"),response,chain);
        assertEquals(401,response.getStatus());
        response=new MockHttpServletResponse(); filter.doFilter(new MockHttpServletRequest("GET","/api/admin/personnel"),response,chain);
        assertEquals(403,response.getStatus());
        var request=write("/api/auth/register");request.setContent(new byte[8193]);
        response=new MockHttpServletResponse();filter.doFilter(request,response,chain);assertEquals(413,response.getStatus());
    }
    @Test void encodedAndMatrixSegmentsCannotBypassWriteOrPrivateAccountAuthentication() throws Exception {
        when(sessions.resolve(null)).thenThrow(AccountErrors.invalid());
        when(maintenance.require(any(),eq(true))).thenThrow(AccountErrors.invalid());
        for (String path:java.util.List.of("/api/admin;probe/games/lol/skills","/api;probe/admin/games/lol/skills","/%61pi/admin/games/lol/skills","/api/%61dmin/games/lol/skills")) {
            var response=new MockHttpServletResponse();filter.doFilter(write(path),response,chain);assertEquals(401,response.getStatus());
        }
        for(String path:java.util.List.of("/api/auth;probe/me","/%61pi/auth/me","/api/%61uth/me")) {
            var response=new MockHttpServletResponse();filter.doFilter(new MockHttpServletRequest("GET",path),response,chain);assertEquals(401,response.getStatus());
        }
        verifyNoInteractions(chain);
    }
}
