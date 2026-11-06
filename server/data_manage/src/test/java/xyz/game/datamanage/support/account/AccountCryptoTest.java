package xyz.game.datamanage.support.account;

import com.bastiaanjansen.otp.HOTPGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.junit.jupiter.api.io.TempDir;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;

class AccountCryptoTest {
    @TempDir Path directory;
    private AccountCrypto crypto() throws Exception {
        AuthKeyTool.create(directory);
        AccountProperties p=new AccountProperties(); p.setAeadKeysetPath(directory.resolve("aead-keyset.json"));
        p.setGrantPrivateKeyPath(directory.resolve("grant-private.pk8"));
        return new AccountCrypto(p,new ObjectMapper());
    }
    @Test void authenticatedEncryptionBindsAccountPurposeAndVersionAndPersistsAcrossInstances() throws Exception {
        AccountCrypto first=crypto();
        String aad=UUID.randomUUID()+"|credential|totp|1";
        byte[] ciphertext=first.encrypt("test-only-material",aad);
        assertTrue("test-only-material".equals(first.decrypt(ciphertext,aad,"auth-aead-1")));
        assertAccountError(503,"AUTH.UNAVAILABLE",()->first.decrypt(ciphertext,aad+"different-account","auth-aead-1"));
        assertAccountError(503,"AUTH.UNAVAILABLE",()->first.decrypt(ciphertext,aad,"unknown-key"));
        AccountProperties p=new AccountProperties();p.setAeadKeysetPath(directory.resolve("aead-keyset.json"));
        assertTrue("test-only-material".equals(new AccountCrypto(p,new ObjectMapper()).decrypt(ciphertext,aad,"auth-aead-1")));
        assertThrows(IllegalStateException.class,()->AuthKeyTool.create(directory));
    }
    @Test void fullCompactJwsUsesFixedEd25519HeaderAndFiveMinuteIntegerClaims() throws Exception {
        AccountCrypto crypto=crypto(); UUID account=UUID.randomUUID(); Instant now=Instant.parse("2026-11-04T00:00:00.999Z");
        Map<String,Object> result=crypto.grant(account,now);
        String[] parts=((String)result.get("grant")).split("\\."); assertEquals(3,parts.length);
        ObjectMapper json=new ObjectMapper();
        var header=json.readTree(Base64.getUrlDecoder().decode(parts[0])); var body=json.readTree(Base64.getUrlDecoder().decode(parts[1]));
        assertEquals(3,header.size()); assertEquals("Ed25519",header.path("alg").asText()); assertEquals("dv-wasm-grant+jwt",header.path("typ").asText());
        assertEquals("wasm-1",header.path("kid").asText()); assertEquals(10,body.size());
        assertEquals("damage-viewer",body.path("iss").asText());assertEquals("damage-viewer-wasm",body.path("aud").asText());
        assertEquals(account.toString(),body.path("sub").asText()); assertTrue(body.path("canLogin").isIntegralNumber());assertEquals(1,body.path("canLogin").asInt());
        assertEquals("engine:compute",body.path("scope").get(0).asText());assertEquals(1,body.path("scope").size());
        assertTrue(body.path("iat").isIntegralNumber());assertTrue(body.path("nbf").isIntegralNumber());assertTrue(body.path("exp").isIntegralNumber());
        assertEquals(1_793_750_400L,body.path("iat").asLong());
        assertEquals(1_793_750_400L,body.path("nbf").asLong());
        assertEquals(1_793_750_700L,body.path("exp").asLong());
        assertEquals(1,body.path("authorizationVersion").asInt());assertDoesNotThrow(()->UUID.fromString(body.path("jti").asText()));
        var metadata=json.readTree(Files.readAllBytes(directory.resolve("grant-public.json")));
        byte[] raw=Base64.getUrlDecoder().decode(metadata.path("publicKeyBase64Url").asText());
        byte[] der=new byte[44];System.arraycopy(HexFormat.of().parseHex("302a300506032b6570032100"),0,der,0,12);System.arraycopy(raw,0,der,12,32);
        Signature verifier=Signature.getInstance("Ed25519");verifier.initVerify(KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(der)));
        verifier.update((parts[0]+"."+parts[1]).getBytes(java.nio.charset.StandardCharsets.US_ASCII)); assertTrue(verifier.verify(Base64.getUrlDecoder().decode(parts[2])));
        assertEquals(Instant.parse("2026-11-04T00:05:00Z"),result.get("expiresAt"));
    }
    @Test void matchingTotpReturnsRealFutureStepAndRejectsReplayAndOutOfWindow() {
        AccountCrypto crypto=new AccountCrypto(new AccountProperties(),new ObjectMapper());
        String secret="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; var hotp=new HOTPGenerator.Builder(secret).build();
        Instant now=Instant.ofEpochSecond(1_700_000_000);long step=now.getEpochSecond()/30;
        String code=hotp.generate(step+1);assertEquals(step+1,crypto.matchingStep(secret,code,now,step));
        assertAccountError(401,"AUTH.INVALID_CREDENTIALS",()->crypto.matchingStep(secret,code,now,step+1));
        assertAccountError(401,"AUTH.INVALID_CREDENTIALS",()->crypto.matchingStep(secret,hotp.generate(step+4),now,step));
        assertAccountError(401,"AUTH.INVALID_CREDENTIALS",()->crypto.matchingStep(secret,"12345",now,-1));
    }
    @Test void missingPrivateConfigurationFailsClosed() {
        AccountProperties p=new AccountProperties();p.setAeadKeysetPath(directory.resolve("missing"));p.setGrantPrivateKeyPath(directory.resolve("missing"));
        AccountCrypto crypto=new AccountCrypto(p,new ObjectMapper());
        assertAccountError(503,"AUTH.UNAVAILABLE",()->crypto.encrypt("fixture","aad"));
        assertAccountError(503,"AUTH.UNAVAILABLE",()->crypto.grant(UUID.fromString("00000000-0000-4000-8000-000000000001"),Instant.parse("2026-11-04T00:00:00Z")));
    }
    private static void assertAccountError(int status,String code,Executable action) {
        ApiException failure=assertThrows(ApiException.class,action);
        assertEquals(status,failure.getStatus().value());assertEquals(code,failure.getCode());
    }
}
