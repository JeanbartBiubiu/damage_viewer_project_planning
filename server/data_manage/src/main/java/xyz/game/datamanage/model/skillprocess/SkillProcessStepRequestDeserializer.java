package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.ObjectCodec;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;

public final class SkillProcessStepRequestDeserializer extends JsonDeserializer<SkillProcessStepRequest> {

    @Override
    public SkillProcessStepRequest deserialize(JsonParser parser, DeserializationContext context)
        throws IOException {
        ObjectCodec codec = parser.getCodec();
        JsonNode node = codec.readTree(parser);
        SkillProcessStepType stepType = codec.treeToValue(node.get("stepType"), SkillProcessStepType.class);
        SkillProcessStepDetail detail = null;
        JsonNode detailNode = node.get("detail");
        if (detailNode != null && !detailNode.isNull() && stepType != null) {
            Class<? extends SkillProcessStepDetail> detailClass = switch (stepType) {
                case IMMEDIATE -> SkillProcessImmediateStepDetail.class;
                case DELAY -> SkillProcessDelayStepDetail.class;
                case MULTI_HIT -> SkillProcessMultiHitStepDetail.class;
                case PERIODIC -> SkillProcessPeriodicStepDetail.class;
                case CHANNEL -> SkillProcessChannelStepDetail.class;
                case CHARGE -> SkillProcessChargeStepDetail.class;
                case RECAST -> SkillProcessRecastStepDetail.class;
                case EMPOWERED_BASIC_ATTACK -> SkillProcessEmpoweredAttackStepDetail.class;
            };
            detail = codec.treeToValue(detailNode, detailClass);
        }
        return new SkillProcessStepRequest(
            text(node, "stepKey"),
            text(node, "name"),
            stepType,
            text(node, "description"),
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
