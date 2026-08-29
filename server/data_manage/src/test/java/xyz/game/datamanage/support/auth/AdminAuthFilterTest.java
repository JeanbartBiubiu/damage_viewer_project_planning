package xyz.game.datamanage.support.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletException;
import java.io.IOException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

@ExtendWith(MockitoExtension.class)
class AdminAuthFilterTest {

    @Mock
    private JwtVerifier jwtVerifier;

    @Mock
    private jakarta.servlet.FilterChain filterChain;

    private AdminAuthFilter filter;

    @BeforeEach
    void setUp() {
        filter = new AdminAuthFilter(new ObjectMapper(), jwtVerifier);
    }

    @Test
    void doFilterReturns401WhenAuthorizationHeaderMissing() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/games/lol/attributes");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, filterChain);

        assertEquals(401, response.getStatus());
        verify(filterChain, never()).doFilter(any(), any());
    }

    @Test
    void doFilterReturns401WhenTokenInvalid() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/games/lol/attributes");
        request.addHeader("Authorization", "Bearer bad.token.value");
        MockHttpServletResponse response = new MockHttpServletResponse();
        when(jwtVerifier.verify("bad.token.value")).thenThrow(new IllegalArgumentException("JWT signature invalid"));

        filter.doFilter(request, response, filterChain);

        assertEquals(401, response.getStatus());
        verify(filterChain, never()).doFilter(any(), any());
    }

    @Test
    void doFilterReturns403WhenCanEditIsFalse() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/games/lol/attributes");
        request.addHeader("Authorization", "Bearer ok.token.value");
        MockHttpServletResponse response = new MockHttpServletResponse();
        when(jwtVerifier.verify("ok.token.value")).thenReturn(new AuthContext("admin@example.com", false, true));

        filter.doFilter(request, response, filterChain);

        assertEquals(403, response.getStatus());
        verify(filterChain, never()).doFilter(any(), any());
    }

    @Test
    void doFilterPassesThroughWhenTokenValidCanEditTrueAndPaidFalse() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/games/lol/attributes");
        request.addHeader("Authorization", "Bearer ok.token.value");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AuthContext authContext = new AuthContext("admin@example.com", true, false);
        when(jwtVerifier.verify("ok.token.value")).thenReturn(authContext);

        filter.doFilter(request, response, filterChain);

        assertEquals(200, response.getStatus());
        assertEquals(authContext, request.getAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR));
        verify(filterChain).doFilter(any(), any());
    }

    @Test
    void doFilterSkipsNonAdminRoutes() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/games/lol/current");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, filterChain);

        assertEquals(200, response.getStatus());
        assertNull(request.getAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR));
        verify(filterChain).doFilter(any(), any());
    }

    @Test
    void doFilterSkipsPreflightRequestsOnAdminRoutes() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("OPTIONS", "/api/admin/games/lol/images/icon.png");
        request.addHeader(HttpHeaders.ORIGIN, "http://localhost:5173");
        request.addHeader(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "PUT");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, filterChain);

        assertEquals(200, response.getStatus());
        assertNull(request.getAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR));
        verify(filterChain).doFilter(any(), any());
    }

    @Test
    void doFilterBypassesAuthWhenVerifierIsDisabled() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("PUT", "/api/admin/games/lol/images/icon.png");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AuthContext authContext = new AuthContext("dev-local@example.com", true, true);
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext()).thenReturn(authContext);

        filter.doFilter(request, response, filterChain);

        assertEquals(200, response.getStatus());
        assertEquals(authContext, request.getAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR));
        verify(jwtVerifier, never()).verify(any());
        verify(filterChain).doFilter(any(), any());
    }
}
