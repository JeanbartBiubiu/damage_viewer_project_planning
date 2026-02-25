package xyz.game.datamanage.support.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import xyz.game.datamanage.support.error.ErrorResponse;

@Component
public class AdminAuthFilter extends OncePerRequestFilter {

    public static final String AUTH_CONTEXT_ATTR = "authContext";

    private static final String BEARER_PREFIX = "Bearer ";

    private final ObjectMapper objectMapper;

    public AdminAuthFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/admin/");
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        String authorization = request.getHeader("Authorization");
        if (authorization == null || !authorization.startsWith(BEARER_PREFIX)) {
            writeError(response, HttpStatus.UNAUTHORIZED, "401.UNAUTHORIZED", "Missing or invalid Authorization header",
                Map.of("reason", "Expected: Authorization: Bearer <jwt>"));
            return;
        }

        String token = authorization.substring(BEARER_PREFIX.length()).trim();
        AuthContext authContext;
        try {
            authContext = parseToken(token);
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

    private AuthContext parseToken(String token) {
        String[] parts = token.split("\\.");
        if (parts.length < 2) {
            throw new IllegalArgumentException("JWT must contain at least header.payload");
        }

        byte[] payload;
        try {
            payload = Base64.getUrlDecoder().decode(parts[1]);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("JWT payload is not valid base64url");
        }

        JsonNode payloadNode;
        try {
            payloadNode = objectMapper.readTree(new String(payload, StandardCharsets.UTF_8));
        } catch (IOException ex) {
            throw new IllegalArgumentException("JWT payload is not valid JSON");
        }

        JsonNode emailNode = payloadNode.get("email");
        JsonNode canEditNode = payloadNode.get("canEdit");
        if (emailNode == null || !emailNode.isTextual() || emailNode.asText().isBlank()) {
            throw new IllegalArgumentException("JWT claim `email` is required");
        }
        if (canEditNode == null || !canEditNode.isBoolean()) {
            throw new IllegalArgumentException("JWT claim `canEdit` is required and must be boolean");
        }
        return new AuthContext(emailNode.asText(), canEditNode.asBoolean());
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

