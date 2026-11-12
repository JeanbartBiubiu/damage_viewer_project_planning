package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class MaintenanceReceiptVerifier {
    private final ObjectMapper json;
    private final MaintenanceProperties properties;
    public MaintenanceReceiptVerifier(ObjectMapper json,MaintenanceProperties properties) { this.json=json;this.properties=properties; }
    public JsonNode verify(JsonNode envelope,Instant now) {
        MaintenanceJson.fields(envelope,"payload","signature");
        byte[] payload=decode(MaintenanceJson.text(envelope,"payload",16384)),signature=decode(MaintenanceJson.text(envelope,"signature",128));
        if(signature.length!=64) throw MaintenanceJson.invalid();
        try {
            var key=KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(Files.readAllBytes(properties.getValidationPublicKeyPath())));
            var verifier=Signature.getInstance("Ed25519");verifier.initVerify(key);verifier.update(payload);
            if(!verifier.verify(signature)) throw MaintenanceJson.denied();
        } catch(java.security.GeneralSecurityException|java.io.IOException|NullPointerException e) { throw MaintenanceJson.denied(); }
        JsonNode value=MaintenanceJson.parse(json,payload);
        MaintenanceJson.fields(value,"version","batchId","principalId","gameId","reference","sourceRevision","baselineDigest","candidateDigest","operationsDigest","evidenceDigest","engineDigest","adapterVersion","issuedAt","expiresAt","outcome");
        if(!"maintenance-validation-v1".equals(value.path("version").asText()) || !"PASSED".equals(value.path("outcome").asText())) throw MaintenanceJson.invalid();
        for(String field:java.util.List.of("baselineDigest","candidateDigest","operationsDigest","evidenceDigest","engineDigest")) MaintenanceJson.digest(value,field);
        uuid(value,"batchId");uuid(value,"principalId");MaintenanceBaseline.game(MaintenanceJson.text(value,"gameId",64));
        MaintenanceJson.text(value,"reference",256);MaintenanceJson.text(value,"sourceRevision",256);MaintenanceJson.text(value,"adapterVersion",128);
        if(!value.path("issuedAt").isIntegralNumber() || !value.path("expiresAt").isIntegralNumber() || !value.path("issuedAt").canConvertToLong() || !value.path("expiresAt").canConvertToLong()) throw MaintenanceJson.invalid();
        long issued=value.path("issuedAt").longValue(),expiry=value.path("expiresAt").longValue(),second=now.getEpochSecond();
        if(issued<0 || issued>second || expiry<=second || expiry<=issued || expiry-issued>3600) throw MaintenanceJson.denied();
        return value;
    }
    public static UUID uuid(JsonNode node,String field) {
        String value=MaintenanceJson.text(node,field,36);
        try { UUID uuid=UUID.fromString(value);if(!uuid.toString().equals(value)) throw MaintenanceJson.invalid();return uuid; }
        catch(IllegalArgumentException e) {throw MaintenanceJson.invalid();}
    }
    private static byte[] decode(String value) {
        if(!value.matches("[A-Za-z0-9_-]+")) throw MaintenanceJson.invalid();
        try {byte[] bytes=Base64.getUrlDecoder().decode(value);if(!Base64.getUrlEncoder().withoutPadding().encodeToString(bytes).equals(value)) throw MaintenanceJson.invalid();return bytes;}
        catch(IllegalArgumentException e) {throw MaintenanceJson.invalid();}
    }
}
