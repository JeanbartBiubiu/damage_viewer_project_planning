package xyz.game.datamanage.support.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsUtils;
import org.springframework.web.filter.OncePerRequestFilter;
import xyz.game.datamanage.support.error.ErrorResponse;

@Component
public class AdminAuthFilter extends OncePerRequestFilter {

    public static final String AUTH_CONTEXT_ATTR = "authContext";

    private static final String BEARER_PREFIX = "Bearer ";

    private final ObjectMapper objectMapper;
    private final JwtVerifier jwtVerifier;

    public AdminAuthFilter(ObjectMapper objectMapper, JwtVerifier jwtVerifier) {
        this.objectMapper = objectMapper;
        this.jwtVerifier = jwtVerifier;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/admin/") || CorsUtils.isPreFlightRequest(request);
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        if (jwtVerifier.isDisabled()) {
            request.setAttribute(AUTH_CONTEXT_ATTR, jwtVerifier.developmentAuthContext());
            filterChain.doFilter(request, response);
            return;
        }

        String authorization = request.getHeader("Authorization");
        if (authorization == null || !authorization.startsWith(BEARER_PREFIX)) {
            writeError(response, HttpStatus.UNAUTHORIZED, "401.UNAUTHORIZED", "Missing or invalid Authorization header",
                Map.of("reason", "Expected: Authorization: Bearer <jwt>"));
            return;
        }

        String token = authorization.substring(BEARER_PREFIX.length()).trim();
        AuthContext authContext;
        try {
            authContext = jwtVerifier.verify(token);
        } catch (IllegalArgumentException ex) {
            writeError(response, HttpStatus.UNAUTHORIZED, "401.UNAUTHORIZED", "Invalid token",
                Map.of("reason", ex.getMessage()));
            return;
        }

        if (!authContext.canEdit()) {
            writeError(response, HttpStatus.FORBIDDEN, "403.FORBIDDEN", "Edit permission required",
                Map.of("reason", "canEdit=false"));
            return;
        }

        request.setAttribute(AUTH_CONTEXT_ATTR, authContext);
        filterChain.doFilter(request, response);
    }

    private void writeError(
        HttpServletResponse response,
        HttpStatus status,
        String code,
        String message,
        Map<String, Object> details
    ) throws IOException {
        response.setStatus(status.value());
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getWriter(), ErrorResponse.of(code, message, details));
    }
}
