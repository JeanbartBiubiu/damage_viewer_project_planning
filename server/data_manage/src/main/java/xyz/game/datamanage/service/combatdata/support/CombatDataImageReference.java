package xyz.game.datamanage.service.combatdata.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import xyz.game.datamanage.mapper.ImagesMapper;

/**
 * Resolves optional Admin {@code imageUri} associations for revisioned combat-data rows.
 * Presence is distinct from the nullable concrete URI written to mappers.
 */
public final class CombatDataImageReference {

    private CombatDataImageReference() {
    }

    /**
     * Captures whether {@code imageUri} is present and its clear/text payload.
     * Rejects present non-null non-text with {@code 400.INVALID_BODY} {@code /imageUri}.
     */
    public static Input read(ObjectNode body, CombatDataSupport support) {
        if (!body.has("imageUri")) {
            return Input.omitted();
        }
        JsonNode value = body.get("imageUri");
        if (value == null || value.isNull()) {
            return Input.clear();
        }
        if (!value.isTextual()) {
            throw support.badRequest("imageUri must be a string", Map.of("path", "/imageUri"));
        }
        String text = value.asText();
        if (text.isBlank()) {
            return Input.clear();
        }
        return Input.text(text);
    }

    /**
     * Resolves a concrete URI (or null) for mapper upsert.
     * Omitted preserves {@code existingImageUri} (null for a new row).
     * Present null/blank clears. Non-blank text must exist in same-game {@code images}.
     */
    public static String resolve(
        Input input,
        String existingImageUri,
        String gameId,
        ImagesMapper imagesMapper,
        CombatDataSupport support
    ) {
        if (!input.present()) {
            return existingImageUri;
        }
        if (input.uri() == null) {
            return null;
        }
        Map<String, Object> image = imagesMapper.findImageByUri(gameId, input.uri());
        if (image == null || image.isEmpty()) {
            throw support.badRequest(
                "imageUri must reference an existing same-game image",
                Map.of("path", "/imageUri", "imageUri", input.uri())
            );
        }
        return input.uri();
    }

    public static String existingOf(Map<String, Object> row) {
        if (row == null || row.isEmpty()) {
            return null;
        }
        Object value = row.get("imageUri");
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value);
        return text.isBlank() ? null : text;
    }

    /**
     * @param present whether the request body contained {@code imageUri}
     * @param uri non-blank text when associating; null when clearing (only if present)
     */
    public record Input(boolean present, String uri) {
        public static Input omitted() {
            return new Input(false, null);
        }

        public static Input clear() {
            return new Input(true, null);
        }

        public static Input text(String uri) {
            return new Input(true, uri);
        }
    }
}
