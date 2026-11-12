package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class MaintenanceReceiptVerifierTest {
    @TempDir Path directory;
    private final ObjectMapper json=new ObjectMapper();
    private final Instant now=Instant.parse("2026-11-13T00:00:00Z");
    private KeyPair keys;private MaintenanceReceiptVerifier verifier;
    @BeforeEach void setup() throws Exception {
        keys=KeyPairGenerator.getInstance("Ed25519").generateKeyPair();var properties=new MaintenanceProperties();
        Path publicPath=directory.resolve("public.der");Files.write(publicPath,keys.getPublic().getEncoded());properties.setValidationPublicKeyPath(publicPath);
        verifier=new MaintenanceReceiptVerifier(json,properties);
    }
    private ObjectNode payload() {
        var node=json.createObjectNode();node.put("version","maintenance-validation-v1");node.put("batchId",UUID.randomUUID().toString());node.put("principalId",UUID.randomUUID().toString());
        node.put("gameId","lol");node.put("reference","issue:17");node.put("sourceRevision","revision:3");
        for(String field:java.util.List.of("baselineDigest","candidateDigest","operationsDigest","evidenceDigest","engineDigest")) node.put(field,"a".repeat(64));
        node.put("adapterVersion","fixture-v1");node.put("issuedAt",now.getEpochSecond());node.put("expiresAt",now.plusSeconds(600).getEpochSecond());node.put("outcome","PASSED");return node;
    }
    private ObjectNode envelope(byte[] payload) throws Exception {
        var signature=Signature.getInstance("Ed25519");signature.initSign(keys.getPrivate());signature.update(payload);
        return json.createObjectNode().put("payload",Base64.getUrlEncoder().withoutPadding().encodeToString(payload)).put("signature",Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign()));
    }
    @Test void acceptsIndependentSignatureAndRejectsTampering() throws Exception {
        var payload=payload();var envelope=envelope(json.writeValueAsBytes(payload));assertEquals(payload.toString(),verifier.verify(envelope,now).toString());
        payload.put("candidateDigest","b".repeat(64));envelope.put("payload",Base64.getUrlEncoder().withoutPadding().encodeToString(json.writeValueAsBytes(payload)));
        assertThrows(xyz.game.datamanage.support.error.ApiException.class,()->verifier.verify(envelope,now));
    }
    @Test void correctlySignedExpiredFutureExcessiveAndFailedReceiptsAreRejected() throws Exception {
        for(String kind:java.util.List.of("expired","future","long","failed","extra")) {
            var payload=payload();
            switch(kind){case "expired"->payload.put("expiresAt",now.getEpochSecond());case "future"->payload.put("issuedAt",now.plusSeconds(1).getEpochSecond());case "long"->payload.put("expiresAt",now.plusSeconds(3601).getEpochSecond());case "failed"->payload.put("outcome","FAILED");case "extra"->payload.put("passed",true);}
            var envelope=envelope(json.writeValueAsBytes(payload));assertThrows(xyz.game.datamanage.support.error.ApiException.class,()->verifier.verify(envelope,now),kind);
        }
    }
    @Test void duplicateJsonKeysAndNoncanonicalBase64AreRejectedEvenWhenSigned() throws Exception {
        String raw=json.writeValueAsString(payload()).replace("\"outcome\":\"PASSED\"","\"outcome\":\"FAILED\",\"outcome\":\"PASSED\"");
        var duplicate=envelope(raw.getBytes(java.nio.charset.StandardCharsets.UTF_8));assertThrows(xyz.game.datamanage.support.error.ApiException.class,()->verifier.verify(duplicate,now));
        var envelope=envelope(json.writeValueAsBytes(payload()));envelope.put("payload",envelope.path("payload").asText()+"=");var noncanonical=envelope;
        assertThrows(xyz.game.datamanage.support.error.ApiException.class,()->verifier.verify(noncanonical,now));
    }
    @Test void operationsDigestHasFrozenCrossLanguageVector() throws Exception {
        var operations=json.readTree("[{\"path\":\"/api/admin/games/lol/skills/q/configuration\",\"method\":\"PATCH\",\"bodySha256\":\""+"a".repeat(64)+"\"}]");
        String expected="[{\"bodySha256\":\""+"a".repeat(64)+"\",\"method\":\"PATCH\",\"path\":\"/api/admin/games/lol/skills/q/configuration\"}]";
        assertEquals(MaintenanceJson.sha(expected.getBytes(java.nio.charset.StandardCharsets.UTF_8)),MaintenanceJson.hash(json,operations));
    }
}
