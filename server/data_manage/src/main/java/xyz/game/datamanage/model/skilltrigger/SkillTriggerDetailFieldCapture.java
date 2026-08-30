package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

final class SkillTriggerDetailFieldCapture {

    private SkillTriggerDetailFieldCapture() {
    }

    static Set<String> captureForeign(Object... fieldAndValues) {
        LinkedHashSet<String> present = new LinkedHashSet<>();
        if (fieldAndValues != null) {
            for (int i = 0; i + 1 < fieldAndValues.length; i += 2) {
                if (fieldAndValues[i + 1] != null) {
                    present.add((String) fieldAndValues[i]);
                }
            }
        }
        return present.isEmpty() ? Set.of() : Collections.unmodifiableSet(present);
    }

    static Set<String> captureUnknown(Map<String, JsonNode> unknown) {
        if (unknown == null || unknown.isEmpty()) {
            return Set.of();
        }
        return Collections.unmodifiableSet(new LinkedHashSet<>(unknown.keySet()));
    }

    static Set<String> normalize(Set<String> values) {
        if (values == null || values.isEmpty()) {
            return Set.of();
        }
        if (values.size() == 1) {
            return Set.of(values.iterator().next());
        }
        return Collections.unmodifiableSet(new LinkedHashSet<>(values));
    }
}
