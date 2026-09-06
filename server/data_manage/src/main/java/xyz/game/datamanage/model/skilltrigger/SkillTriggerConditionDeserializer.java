package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.ObjectCodec;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;

public final class SkillTriggerConditionDeserializer extends JsonDeserializer<SkillTriggerCondition> {

    @Override
    public SkillTriggerCondition deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        ObjectCodec codec = parser.getCodec();
        JsonNode node = codec.readTree(parser);
        SkillTriggerConditionType conditionType =
            codec.treeToValue(node.get("conditionType"), SkillTriggerConditionType.class);
        SkillTriggerConditionDetail detail = null;
        JsonNode detailNode = node.get("detail");
        if (detailNode != null && !detailNode.isNull() && conditionType != null) {
            Class<? extends SkillTriggerConditionDetail> detailClass = switch (conditionType) {
                case ATTRIBUTE_COMPARE -> SkillTriggerAttributeConditionDetail.class;
                case STATUS_CHECK -> SkillTriggerStatusConditionDetail.class;
                case INTERNAL_STATE_CHECK -> SkillTriggerInternalStateConditionDetail.class;
                case LIFECYCLE_CHECK -> SkillTriggerLifecycleConditionDetail.class;
                case EVENT_VALUE_COMPARE -> SkillTriggerEventValueConditionDetail.class;
            };
            detail = codec.treeToValue(detailNode, detailClass);
        }
        return new SkillTriggerCondition(
            text(node, "conditionKey"),
            conditionType,
            codec.treeToValue(node.get("sortOrder"), Integer.class),
            detail
        );
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return value.asText();
    }
}
