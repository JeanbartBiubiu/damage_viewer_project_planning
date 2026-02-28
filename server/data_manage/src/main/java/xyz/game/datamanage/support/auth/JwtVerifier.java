package xyz.game.datamanage.support.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.ECDSAVerifier;
import com.nimbusds.jwt.SignedJWT;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.X509EncodedKeySpec;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class JwtVerifier {

    private static final String JWT_ALGORITHM = "ES256";
    private static final String EC_ALGORITHM = "EC";

    private final Clock clock;
    private final ECPublicKey publicKey;
    private final long expLeewaySeconds;

    @Autowired
    public JwtVerifier(AdminJwtProperties jwtProperties) {
        this(Clock.systemUTC(), jwtProperties);
    }

    JwtVerifier(Clock clock, AdminJwtProperties jwtProperties) {
        this.clock = clock;
        this.publicKey = parsePublicKey(jwtProperties.getEs256PublicKeyPem());
        this.expLeewaySeconds = jwtProperties.getExpLeeway().toSeconds();
    }

    public AuthContext verify(String token) {
        SignedJWT signedJwt = parseToken(token);
        verifyAlgorithm(signedJwt);
        verifySignature(signedJwt);
        Map<String, Object> payloadClaims = signedJwt.getPayload().toJSONObject();
        verifyExpiration(payloadClaims);
        return buildAuthContext(payloadClaims);
    }

    private SignedJWT parseToken(String token) {
        try {
            return SignedJWT.parse(token);
        } catch (java.text.ParseException ex) {
            throw new IllegalArgumentException("JWT must contain exactly header.payload.signature");
        }
    }

    private void verifyAlgorithm(SignedJWT signedJwt) {
        String alg = signedJwt.getHeader().getAlgorithm() == null
            ? null
            : signedJwt.getHeader().getAlgorithm().getName();
        if (!JWT_ALGORITHM.equals(alg) || !JWSAlgorithm.ES256.equals(signedJwt.getHeader().getAlgorithm())) {
            throw new IllegalArgumentException("JWT alg must be ES256");
        }
    }

    private void verifySignature(SignedJWT signedJwt) {
        try {
            ECDSAVerifier verifier = new ECDSAVerifier(publicKey);
            if (!signedJwt.verify(verifier)) {
                throw new IllegalArgumentException("JWT signature invalid");
            }
        } catch (JOSEException ex) {
            throw new IllegalStateException("Unable to verify JWT signature", ex);
        }
    }

    private void verifyExpiration(Map<String, Object> payloadClaims) {
        Object expClaim = payloadClaims.get("exp");
        if (!(expClaim instanceof Number expNumber) || !isIntegerNumber(expNumber)) {
            throw new IllegalArgumentException("JWT claim `exp` is required and must be integer");
        }
        long expEpochSeconds = expNumber.longValue();
        long nowEpochSeconds = Instant.now(clock).getEpochSecond();
        if (nowEpochSeconds > expEpochSeconds + expLeewaySeconds) {
            throw new IllegalArgumentException("JWT token expired");
        }
    }

    private AuthContext buildAuthContext(Map<String, Object> payloadClaims) {
        Object emailClaim = payloadClaims.get("email");
        Object canEditClaim = payloadClaims.get("canEdit");
        Object paidClaim = payloadClaims.get("paid");

        if (!(emailClaim instanceof String email) || email.isBlank()) {
            throw new IllegalArgumentException("JWT claim `email` is required");
        }
        if (!(canEditClaim instanceof Boolean canEdit)) {
            throw new IllegalArgumentException("JWT claim `canEdit` is required and must be boolean");
        }
        if (!(paidClaim instanceof Boolean paid)) {
            throw new IllegalArgumentException("JWT claim `paid` is required and must be boolean");
        }
        return new AuthContext(email, canEdit, paid);
    }

    private ECPublicKey parsePublicKey(String pem) {
        if (pem == null || pem.isBlank()) {
            throw new IllegalStateException("app.auth.jwt.es256-public-key-pem must be configured");
        }
        String normalized = pem
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replaceAll("\\s+", "");
        try {
            byte[] der = Base64.getDecoder().decode(normalized);
            KeyFactory keyFactory = KeyFactory.getInstance(EC_ALGORITHM);
            PublicKey key = keyFactory.generatePublic(new X509EncodedKeySpec(der));
            if (!(key instanceof ECPublicKey ecPublicKey)) {
                throw new IllegalStateException("app.auth.jwt.es256-public-key-pem must be an EC public key");
            }
            return ecPublicKey;
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException("app.auth.jwt.es256-public-key-pem is not valid base64", ex);
        } catch (NoSuchAlgorithmException | InvalidKeySpecException ex) {
            throw new IllegalStateException("Unable to load ES256 public key", ex);
        }
    }

    private boolean isIntegerNumber(Number number) {
        if (number instanceof Byte || number instanceof Short || number instanceof Integer || number instanceof Long) {
            return true;
        }
        if (number instanceof Float floatValue) {
            return floatValue % 1 == 0;
        }
        if (number instanceof Double doubleValue) {
            return doubleValue % 1 == 0;
        }
        return false;
    }
}
