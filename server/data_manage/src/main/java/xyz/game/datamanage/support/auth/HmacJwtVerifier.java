package xyz.game.datamanage.support.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class HmacJwtVerifier {

    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final String JWT_ALGORITHM = "HS256";

    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final byte[] secretBytes;
    private final long expLeewaySeconds;

    @Autowired
    public HmacJwtVerifier(ObjectMapper objectMapper, AdminJwtProperties jwtProperties) {
        this(objectMapper, Clock.systemUTC(), jwtProperties);
    }

    HmacJwtVerifier(ObjectMapper objectMapper, Clock clock, AdminJwtProperties jwtProperties) {
        this.objectMapper = objectMapper;
        this.clock = clock;
        String secret = jwtProperties.getHs256Secret();
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("app.auth.jwt.hs256-secret must be configured");
        }
        this.secretBytes = secret.getBytes(StandardCharsets.UTF_8);
        this.expLeewaySeconds = jwtProperties.getExpLeeway().toSeconds();
    }

    public AuthContext verify(String token) {
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            throw new IllegalArgumentException("JWT must contain exactly header.payload.signature");
        }

        JsonNode headerNode = parseJson(decodeBase64Url(parts[0]), "JWT header");
        JsonNode algNode = headerNode.get("alg");
        if (algNode == null || !algNode.isTextual() || !JWT_ALGORITHM.equals(algNode.asText())) {
            throw new IllegalArgumentException("JWT alg must be HS256");
        }

        verifySignature(parts[0], parts[1], parts[2]);

        JsonNode payloadNode = parseJson(decodeBase64Url(parts[1]), "JWT payload");
        verifyExpiration(payloadNode);
        return buildAuthContext(payloadNode);
    }

    private void verifySignature(String encodedHeader, String encodedPayload, String signature) {
        String signingInput = encodedHeader + "." + encodedPayload;
        byte[] expectedSignatureBytes = hmac(signingInput.getBytes(StandardCharsets.UTF_8));
        byte[] expectedEncoded = Base64.getUrlEncoder().withoutPadding().encode(expectedSignatureBytes);
        byte[] providedEncoded = signature.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expectedEncoded, providedEncoded)) {
            throw new IllegalArgumentException("JWT signature invalid");
        }
    }

    private void verifyExpiration(JsonNode payloadNode) {
        JsonNode expNode = payloadNode.get("exp");
        if (expNode == null || !expNode.canConvertToLong()) {
            throw new IllegalArgumentException("JWT claim `exp` is required and must be integer");
        }
        long expEpochSeconds = expNode.asLong();
        long nowEpochSeconds = Instant.now(clock).getEpochSecond();
        if (nowEpochSeconds > expEpochSeconds + expLeewaySeconds) {
            throw new IllegalArgumentException("JWT token expired");
        }
    }

    private AuthContext buildAuthContext(JsonNode payloadNode) {
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

    private byte[] decodeBase64Url(String value) {
        try {
            return Base64.getUrlDecoder().decode(value);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("JWT part is not valid base64url");
        }
    }

    private JsonNode parseJson(byte[] jsonBytes, String sectionName) {
        try {
            return objectMapper.readTree(jsonBytes);
        } catch (IOException ex) {
            throw new IllegalArgumentException(sectionName + " is not valid JSON");
        }
    }

    private byte[] hmac(byte[] input) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(secretBytes, HMAC_ALGORITHM));
            return mac.doFinal(input);
        } catch (NoSuchAlgorithmException | InvalidKeyException ex) {
            throw new IllegalStateException("Unable to verify JWT signature", ex);
        }
    }
}
