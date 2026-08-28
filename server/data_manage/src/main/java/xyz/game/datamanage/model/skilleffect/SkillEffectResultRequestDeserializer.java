package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.ObjectCodec;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;

/**
 * Uses the parent {@code resultType} as the discriminator for {@code detail},
 * without copying {@code resultType} into the detail object.
 */
public final class SkillEffectResultRequestDeserializer extends JsonDeserializer<SkillEffectResultRequest> {

    @Override
    public SkillEffectResultRequest deserialize(JsonParser parser, DeserializationContext context)
        throws IOException {
        ObjectCodec codec = parser.getCodec();
        JsonNode node = codec.readTree(parser);
        SkillEffectResultType resultType = codec.treeToValue(node.get("resultType"), SkillEffectResultType.class);
        SkillEffectResultDetail detail = null;
        JsonNode detailNode = node.get("detail");
        if (detailNode != null && !detailNode.isNull() && resultType != null) {
            Class<? extends SkillEffectResultDetail> detailClass = switch (resultType) {
                case DAMAGE -> SkillEffectDamageDetail.class;
                case DIRECT_HEAL -> SkillEffectDirectHealDetail.class;
                case NORMAL_SHIELD -> SkillEffectNormalShieldDetail.class;
                case ATTRIBUTE_CHANGE -> SkillEffectAttributeChangeDetail.class;
                case RESOURCE_CHANGE -> SkillEffectResourceChangeDetail.class;
                case COOLDOWN_CHANGE -> SkillEffectCooldownChangeDetail.class;
                case STATUS_OPERATION -> SkillEffectStatusOperationDetail.class;
            };
            detail = codec.treeToValue(detailNode, detailClass);
        }
        return new SkillEffectResultRequest(
            text(node, "resultKey"),
            text(node, "name"),
            resultType,
            codec.treeToValue(node.get("target"), SkillEffectTarget.class),
            text(node, "description"),
            codec.treeToValue(node.get("sortOrder"), Integer.class),
            codec.treeToValue(node.get("valueRule"), SkillEffectValueRuleRequest.class),
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
