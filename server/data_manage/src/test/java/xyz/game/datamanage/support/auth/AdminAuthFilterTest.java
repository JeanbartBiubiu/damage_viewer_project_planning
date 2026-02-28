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
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/games/lol/heroes/hero_ahri");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, filterChain);

        assertEquals(401, response.getStatus());
        verify(filterChain, never()).doFilter(any(), any());
    }

    @Test
    void doFilterReturns401WhenTokenInvalid() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/games/lol/heroes/hero_ahri");
        request.addHeader("Authorization", "Bearer bad.token.value");
        MockHttpServletResponse response = new MockHttpServletResponse();
        when(jwtVerifier.verify("bad.token.value")).thenThrow(new IllegalArgumentException("JWT signature invalid"));

        filter.doFilter(request, response, filterChain);

        assertEquals(401, response.getStatus());
        verify(filterChain, never()).doFilter(any(), any());
    }

    @Test
    void doFilterReturns403WhenCanEditIsFalse() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/games/lol/heroes/hero_ahri");
        request.addHeader("Authorization", "Bearer ok.token.value");
        MockHttpServletResponse response = new MockHttpServletResponse();
        when(jwtVerifier.verify("ok.token.value")).thenReturn(new AuthContext("admin@example.com", false, true));

        filter.doFilter(request, response, filterChain);

        assertEquals(403, response.getStatus());
        verify(filterChain, never()).doFilter(any(), any());
    }

    @Test
    void doFilterPassesThroughWhenTokenValidCanEditTrueAndPaidFalse() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/games/lol/heroes/hero_ahri");
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
}
