package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

public record SkillTriggerSceneAttributeSnapshotBindingDetail(
    SkillTriggerSceneAttributeSubject subject,
    String attributeKey,
    List<SkillTriggerSceneAttributeSource> sources,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {
    public SkillTriggerSceneAttributeSnapshotBindingDetail {
        attributeKey = attributeKey == null || attributeKey.isBlank() ? null : attributeKey.trim();
        sources = sources == null ? null : Collections.unmodifiableList(new ArrayList<>(sources));
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerSceneAttributeSnapshotBindingDetail(SkillTriggerSceneAttributeSubject subject,
            String attributeKey, List<SkillTriggerSceneAttributeSource> sources) {
        this(subject, attributeKey, sources, Set.of());
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }

    @JsonCreator
    static SkillTriggerSceneAttributeSnapshotBindingDetail fromJson(
        @JsonProperty("subject") JsonNode subject,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("sources") JsonNode sources,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        String subjectText = strictText(subject, "subject");
        String attributeText = strictText(attributeKey, "attributeKey");
        List<SkillTriggerSceneAttributeSource> selected = null;
        if (sources != null && !sources.isNull()) {
            if (!sources.isArray()) throw new IllegalArgumentException("场景属性来源必须是数组");
            selected = new ArrayList<>();
            for (JsonNode source : sources) {
                String value = strictText(source, "sources");
                if (value == null) throw new IllegalArgumentException("场景属性来源项不能为空");
                selected.add(SkillTriggerSceneAttributeSource.valueOf(value));
            }
        }
        return new SkillTriggerSceneAttributeSnapshotBindingDetail(
            subjectText == null ? null : SkillTriggerSceneAttributeSubject.valueOf(subjectText),
            attributeText, selected, SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }

    private static String strictText(JsonNode value, String field) {
        if (value == null || value.isNull()) return null;
        if (!value.isTextual()) throw new IllegalArgumentException("场景属性明细 " + field + " 必须是字符串");
        return value.textValue();
    }
}
