package xyz.game.datamanage.support.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class HmacJwtVerifierTest {

    private static final String SECRET = "unit-test-secret";

    private ObjectMapper objectMapper;
    private HmacJwtVerifier verifier;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        AdminJwtProperties properties = new AdminJwtProperties();
        properties.setHs256Secret(SECRET);
        properties.setExpLeeway(Duration.ZERO);
        verifier = new HmacJwtVerifier(objectMapper, properties);
    }

    @Test
    void verifyAcceptsValidToken() {
        long exp = Instant.now().plusSeconds(3600).getEpochSecond();
        String token = createToken(Map.of("email", "admin@example.com", "canEdit", true, "exp", exp), SECRET);

        AuthContext context = verifier.verify(token);

        assertEquals("admin@example.com", context.email());
        assertEquals(true, context.canEdit());
    }

    @Test
    void verifyRejectsInvalidSignature() {
        long exp = Instant.now().plusSeconds(3600).getEpochSecond();
        String token = createToken(Map.of("email", "admin@example.com", "canEdit", true, "exp", exp), "wrong-secret");

        assertThrows(IllegalArgumentException.class, () -> verifier.verify(token));
    }

    @Test
    void verifyRejectsExpiredToken() {
        long exp = Instant.now().minusSeconds(3600).getEpochSecond();
        String token = createToken(Map.of("email", "admin@example.com", "canEdit", true, "exp", exp), SECRET);

        assertThrows(IllegalArgumentException.class, () -> verifier.verify(token));
    }

    @Test
    void verifyRejectsMissingCanEditClaim() {
        long exp = Instant.now().plusSeconds(3600).getEpochSecond();
        String token = createToken(Map.of("email", "admin@example.com", "exp", exp), SECRET);

        assertThrows(IllegalArgumentException.class, () -> verifier.verify(token));
    }

    private String createToken(Map<String, Object> payloadClaims, String secret) {
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "HS256");
        header.put("typ", "JWT");
        String encodedHeader = base64Url(json(header));
        String encodedPayload = base64Url(json(payloadClaims));
        String signingInput = encodedHeader + "." + encodedPayload;
        String signature = base64Url(hmac(signingInput, secret));
        return signingInput + "." + signature;
    }

    private byte[] hmac(String content, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(content.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to sign JWT", ex);
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Unable to serialize JSON", ex);
        }
    }

    private String base64Url(String value) {
        return base64Url(value.getBytes(StandardCharsets.UTF_8));
    }

    private String base64Url(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }
}
