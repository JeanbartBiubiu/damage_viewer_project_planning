package xyz.game.datamanage.service.simulation.availability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;

final class AvailabilityDigest {
    private AvailabilityDigest() { }

    static String digest(ObjectMapper json, JsonNode value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(canonical(json, value))));
        } catch (Exception exception) {
            throw new IllegalStateException("计算目录内容摘要失败", exception);
        }
    }

    static JsonNode canonical(ObjectMapper json, JsonNode value) {
        if (value.isObject()) {
            ObjectNode result = json.createObjectNode();
            value.properties().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> result.set(entry.getKey(), canonical(json, entry.getValue())));
            return result;
        }
        if (value.isArray()) {
            ArrayNode result = json.createArrayNode();
            value.forEach(item -> result.add(canonical(json, item)));
            return result;
        }
        if (value.isNumber()) return json.getNodeFactory().numberNode(value.decimalValue().stripTrailingZeros());
        return value;
    }
}
