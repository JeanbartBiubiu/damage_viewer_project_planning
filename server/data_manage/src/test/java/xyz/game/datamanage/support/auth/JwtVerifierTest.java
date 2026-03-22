package xyz.game.datamanage.support.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class JwtVerifierTest {

    private static final Instant NOW = Instant.parse("2026-02-28T12:00:00Z");
    private static final String HS256_TEST_SECRET = "01234567890123456789012345678901";

    private ECPrivateKey privateKey;
    private JwtVerifier verifier;

    @BeforeEach
    void setUp() {
        KeyPair keyPair = generateEcKeyPair();
        privateKey = (ECPrivateKey) keyPair.getPrivate();

        AdminJwtProperties properties = new AdminJwtProperties();
        properties.setEs256PublicKeyPem(toPublicKeyPem((ECPublicKey) keyPair.getPublic()));
        properties.setExpLeeway(Duration.ZERO);

        verifier = new JwtVerifier(Clock.fixed(NOW, ZoneOffset.UTC), properties);
    }

    @Test
    void verifyAcceptsValidEs256Token() {
        long exp = NOW.plusSeconds(3600).getEpochSecond();
        String token = createEs256Token(Map.of("email", "admin@example.com", "canEdit", true, "paid", true, "exp", exp));

        AuthContext context = verifier.verify(token);

        assertEquals("admin@example.com", context.email());
        assertEquals(true, context.canEdit());
        assertEquals(true, context.paid());
    }

    @Test
    void verifyRejectsInvalidSignature() {
        KeyPair wrongKeyPair = generateEcKeyPair();
        long exp = NOW.plusSeconds(3600).getEpochSecond();
        String token = createEs256Token(Map.of("email", "admin@example.com", "canEdit", true, "paid", true, "exp", exp),
            (ECPrivateKey) wrongKeyPair.getPrivate());

        assertThrows(IllegalArgumentException.class, () -> verifier.verify(token));
    }

    @Test
    void verifyRejectsExpiredToken() {
        long exp = NOW.minusSeconds(3600).getEpochSecond();
        String token = createEs256Token(Map.of("email", "admin@example.com", "canEdit", true, "paid", true, "exp", exp));

        assertThrows(IllegalArgumentException.class, () -> verifier.verify(token));
    }

    @Test
    void verifyRejectsMissingPaidClaim() {
        long exp = NOW.plusSeconds(3600).getEpochSecond();
        String token = createEs256Token(Map.of("email", "admin@example.com", "canEdit", true, "exp", exp));

        assertThrows(IllegalArgumentException.class, () -> verifier.verify(token));
    }

    @Test
    void verifyRejectsNonEs256Algorithm() {
        long exp = NOW.plusSeconds(3600).getEpochSecond();
        String token = createHs256Token(Map.of("email", "admin@example.com", "canEdit", true, "paid", true, "exp", exp));

        assertThrows(IllegalArgumentException.class, () -> verifier.verify(token));
    }

    @Test
    void constructorRejectsMissingPublicKeyConfig() {
        AdminJwtProperties properties = new AdminJwtProperties();
        properties.setExpLeeway(Duration.ZERO);

        assertThrows(IllegalStateException.class, () -> new JwtVerifier(Clock.fixed(NOW, ZoneOffset.UTC), properties));
    }

    @Test
    void constructorAllowsMissingPublicKeyConfigWhenDisabled() {
        AdminJwtProperties properties = new AdminJwtProperties();
        properties.setDisabled(true);
        properties.setExpLeeway(Duration.ZERO);

        JwtVerifier disabledVerifier = new JwtVerifier(Clock.fixed(NOW, ZoneOffset.UTC), properties);

        assertEquals("dev-local@example.com", disabledVerifier.verify("ignored").email());
        assertEquals(true, disabledVerifier.verify("ignored").canEdit());
        assertEquals(true, disabledVerifier.verify("ignored").paid());
    }

    private String createEs256Token(Map<String, Object> payloadClaims) {
        return createEs256Token(payloadClaims, privateKey);
    }

    private String createEs256Token(Map<String, Object> payloadClaims, ECPrivateKey tokenPrivateKey) {
        try {
            SignedJWT signedJWT = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.ES256).type(JOSEObjectType.JWT).build(),
                createClaims(payloadClaims)
            );
            JWSSigner signer = new ECDSASigner(tokenPrivateKey);
            signedJWT.sign(signer);
            return signedJWT.serialize();
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to sign ES256 JWT", ex);
        }
    }

    private String createHs256Token(Map<String, Object> payloadClaims) {
        try {
            SignedJWT signedJWT = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType.JWT).build(),
                createClaims(payloadClaims)
            );
            JWSSigner signer = new MACSigner(HS256_TEST_SECRET);
            signedJWT.sign(signer);
            return signedJWT.serialize();
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to sign HS256 JWT", ex);
        }
    }

    private JWTClaimsSet createClaims(Map<String, Object> payloadClaims) {
        JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder();
        payloadClaims.forEach(builder::claim);
        return builder.build();
    }

    private KeyPair generateEcKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"));
            return generator.generateKeyPair();
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to generate EC key pair", ex);
        }
    }

    private String toPublicKeyPem(ECPublicKey key) {
        String base64 = Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(key.getEncoded());
        return "-----BEGIN PUBLIC KEY-----\n" + base64 + "\n-----END PUBLIC KEY-----";
    }
}
