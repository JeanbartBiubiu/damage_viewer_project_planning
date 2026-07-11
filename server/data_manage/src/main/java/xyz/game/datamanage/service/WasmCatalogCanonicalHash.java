package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Deterministic canonical JSON + Wasm catalog hash helpers.
 * Object keys sorted by Unicode code point; array order retained; UTF-8 compact.
 */
public final class WasmCatalogCanonicalHash {

    public static final String SCHEMA_VERSION = "generic-p0";
    public static final String SCHEMA_FINGERPRINT = "damage-viewer/wasm/generic-p0/catalog-v1";

    private WasmCatalogCanonicalHash() {
    }

    public static String schemaHash() {
        return "sha256:" + sha256Hex(SCHEMA_FINGERPRINT.getBytes(StandardCharsets.UTF_8));
    }

    public static String rulesHash(ObjectNode hashPayload) {
        String canonical = canonicalJson(hashPayload);
        return "sha256:" + sha256Hex(canonical.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Build the exact hash payload: schemaVersion + body roots (no meta/timestamps).
     */
    public static ObjectNode buildHashPayload(String schemaVersion, ObjectNode catalogBody) {
        ObjectNode payload = JsonNodeFactory.instance.objectNode();
        payload.put("schemaVersion", schemaVersion);
        copyIfPresent(payload, catalogBody, "typeCatalog");
        copyIfPresent(payload, catalogBody, "combatantTemplates");
        copyIfPresent(payload, catalogBody, "sharedProviders");
        copyIfPresent(payload, catalogBody, "rules");
        copyIfPresent(payload, catalogBody, "formulas");
        copyIfPresent(payload, catalogBody, "settings");
        return payload;
    }

    public static String canonicalJson(JsonNode node) {
        StringBuilder sb = new StringBuilder();
        appendCanonical(sb, node);
        return sb.toString();
    }

    private static void copyIfPresent(ObjectNode target, ObjectNode source, String field) {
        if (source != null && source.has(field)) {
            target.set(field, source.get(field));
        }
    }

    private static void appendCanonical(StringBuilder sb, JsonNode node) {
        if (node == null || node.isNull()) {
            sb.append("null");
            return;
        }
        if (node.isBoolean()) {
            sb.append(node.booleanValue() ? "true" : "false");
            return;
        }
        if (node.isNumber()) {
            sb.append(canonicalizeNumber(node));
            return;
        }
        if (node.isTextual()) {
            appendJsonString(sb, node.textValue());
            return;
        }
        if (node.isArray()) {
            sb.append('[');
            ArrayNode array = (ArrayNode) node;
            for (int i = 0; i < array.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                appendCanonical(sb, array.get(i));
            }
            sb.append(']');
            return;
        }
        if (node.isObject()) {
            sb.append('{');
            List<Map.Entry<String, JsonNode>> fields = new ArrayList<>();
            Iterator<Map.Entry<String, JsonNode>> it = node.fields();
            while (it.hasNext()) {
                fields.add(it.next());
            }
            fields.sort(Comparator.comparing(Map.Entry::getKey, WasmCatalogCanonicalHash::compareUnicodeCodePoints));
            for (int i = 0; i < fields.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                Map.Entry<String, JsonNode> field = fields.get(i);
                appendJsonString(sb, field.getKey());
                sb.append(':');
                appendCanonical(sb, field.getValue());
            }
            sb.append('}');
            return;
        }
        // Fallback for binary/POJO nodes: treat as string representation
        appendJsonString(sb, node.toString());
    }

    static String canonicalizeNumber(JsonNode node) {
        BigDecimal value;
        if (node.isFloatingPointNumber() || node.isBigDecimal()) {
            value = node.decimalValue();
        } else if (node.isBigInteger()) {
            value = new BigDecimal(node.bigIntegerValue());
        } else {
            value = BigDecimal.valueOf(node.longValue());
        }
        if (value.compareTo(BigDecimal.ZERO) == 0) {
            return "0";
        }
        return value.stripTrailingZeros().toPlainString();
    }

    private static int compareUnicodeCodePoints(String a, String b) {
        int i = 0;
        int j = 0;
        while (i < a.length() && j < b.length()) {
            int cpA = a.codePointAt(i);
            int cpB = b.codePointAt(j);
            if (cpA != cpB) {
                return Integer.compare(cpA, cpB);
            }
            i += Character.charCount(cpA);
            j += Character.charCount(cpB);
        }
        return Integer.compare(a.length() - i, b.length() - j);
    }

    private static void appendJsonString(StringBuilder sb, String value) {
        sb.append('"');
        for (int i = 0; i < value.length(); ) {
            int cp = value.codePointAt(i);
            i += Character.charCount(cp);
            switch (cp) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (cp < 0x20) {
                        sb.append(String.format("\\u%04x", cp));
                    } else if (cp <= 0xFFFF) {
                        sb.append((char) cp);
                    } else {
                        sb.append(Character.toChars(cp));
                    }
                }
            }
        }
        sb.append('"');
    }

    private static String sha256Hex(byte[] input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input);
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 not available", ex);
        }
    }
}
