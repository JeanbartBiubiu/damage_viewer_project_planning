package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Captures known formula-contract fields that belong to other node types.
 * Presence (including JSON null) is enough; truly unknown properties stay ignored.
 */
final class SkillFormulaForeignFieldCapture {

    private SkillFormulaForeignFieldCapture() {
    }

    static Set<String> capture(String field, JsonNode value, Object... fieldAndValues) {
        LinkedHashSet<String> present = new LinkedHashSet<>();
        addIfPresent(present, field, value);
        if (fieldAndValues != null) {
            for (int i = 0; i + 1 < fieldAndValues.length; i += 2) {
                addIfPresent(present, (String) fieldAndValues[i], (JsonNode) fieldAndValues[i + 1]);
            }
        }
        return present.isEmpty() ? Set.of() : Collections.unmodifiableSet(present);
    }

    static Set<String> normalize(Set<String> foreignFields) {
        if (foreignFields == null || foreignFields.isEmpty()) {
            return Set.of();
        }
        if (foreignFields.size() == 1) {
            return Set.of(foreignFields.iterator().next());
        }
        return Collections.unmodifiableSet(new LinkedHashSet<>(foreignFields));
    }

    private static void addIfPresent(Set<String> target, String field, JsonNode value) {
        if (value != null) {
            target.add(field);
        }
    }
}
