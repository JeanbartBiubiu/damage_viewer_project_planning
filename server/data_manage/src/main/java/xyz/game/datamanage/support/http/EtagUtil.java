package xyz.game.datamanage.support.http;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

public final class EtagUtil {

    private EtagUtil() {
    }

    public static String quote(String etagValue) {
        return "\"" + etagValue + "\"";
    }

    public static String sha256Hex(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(content.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder(bytes.length * 2);
            for (byte value : bytes) {
                builder.append(String.format(Locale.ROOT, "%02x", value));
            }
            return builder.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 not supported", ex);
        }
    }

    public static String hashJson(Object payload, ObjectMapper objectMapper) {
        try {
            return sha256Hex(objectMapper.writeValueAsString(payload));
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Unable to serialize JSON payload", ex);
        }
    }

    public static boolean isNotModified(String ifNoneMatch, String expectedEtagValue) {
        if (ifNoneMatch == null || ifNoneMatch.isBlank()) {
            return false;
        }
        String expected = normalizeTag(expectedEtagValue);
        for (String candidate : ifNoneMatch.split(",")) {
            if (normalizeTag(candidate).equals(expected)) {
                return true;
            }
        }
        return false;
    }

    private static String normalizeTag(String raw) {
        if (raw == null) {
            return "";
        }
        String normalized = raw.trim();
        if (normalized.startsWith("W/")) {
            normalized = normalized.substring(2);
        }
        if (normalized.startsWith("\"") && normalized.endsWith("\"") && normalized.length() >= 2) {
            normalized = normalized.substring(1, normalized.length() - 1);
        }
        return normalized.trim();
    }
}

