package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.error.ApiException;

public final class MaintenanceJson {
    private MaintenanceJson() {}
    public static ApiException denied() { return new ApiException(HttpStatus.FORBIDDEN,"MAINTENANCE.DENIED","需要有效维护身份与授权"); }
    public static ApiException invalid() { return new ApiException(HttpStatus.BAD_REQUEST,"MAINTENANCE.INVALID","维护请求或验证材料不合法"); }
    public static ApiException conflict() { return new ApiException(HttpStatus.CONFLICT,"MAINTENANCE.CONFLICT","维护批次、顺序或配置基线已变化"); }
    public static JsonNode parse(ObjectMapper mapper, byte[] bytes) {
        try (JsonParser parser = mapper.getFactory().createParser(bytes)) {
            parser.enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
            JsonNode result = mapper.readTree(parser);
            if (result == null || parser.nextToken() != null) throw invalid();
            return result;
        } catch (java.io.IOException e) { throw invalid(); }
    }
    public static void fields(JsonNode node, String... names) {
        if (node == null || !node.isObject()) throw invalid();
        Set<String> keys = new java.util.HashSet<>(); node.fieldNames().forEachRemaining(keys::add);
        if (!keys.equals(Set.of(names))) throw invalid();
    }
    public static String text(JsonNode node, String field, int max) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank() || value.textValue().length() > max) throw invalid();
        return value.textValue();
    }
    public static String digest(JsonNode node, String field) {
        String value = text(node, field, 64);
        if (!value.matches("[0-9a-f]{64}")) throw invalid();
        return value;
    }
    public static String sha(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public static JsonNode canonical(ObjectMapper mapper, JsonNode node) {
        if (node.isObject()) {
            ObjectNode result = mapper.createObjectNode();
            java.util.List<String> keys = new java.util.ArrayList<>(); node.fieldNames().forEachRemaining(keys::add);
            keys.stream().sorted().forEach(key -> result.set(key, canonical(mapper,node.get(key))));
            return result;
        }
        if (node.isArray()) {
            ArrayNode result = mapper.createArrayNode(); node.forEach(value -> result.add(canonical(mapper,value))); return result;
        }
        return node.deepCopy();
    }
    public static String hash(ObjectMapper mapper, JsonNode node) {
        return sha(canonical(mapper,node).toString().getBytes(StandardCharsets.UTF_8));
    }
}
