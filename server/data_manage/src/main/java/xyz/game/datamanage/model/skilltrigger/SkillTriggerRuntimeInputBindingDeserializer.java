package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.ObjectCodec;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.util.Set;

public final class SkillTriggerRuntimeInputBindingDeserializer
    extends JsonDeserializer<SkillTriggerRuntimeInputBinding> {

    @Override
    public SkillTriggerRuntimeInputBinding deserialize(JsonParser parser, DeserializationContext context)
        throws IOException {
        ObjectCodec codec = parser.getCodec();
        JsonNode node = codec.readTree(parser);
        if (!node.isObject()) {
            throw context.weirdStringException(node.toString(), SkillTriggerRuntimeInputBinding.class,
                "动态输入绑定必须是对象");
        }
        Set<String> allowed = Set.of("bindingKey", "parameterKey", "sourceType", "detail");
        var fields = node.fieldNames();
        while (fields.hasNext()) {
            String field = fields.next();
            if (!allowed.contains(field)) {
                throw context.weirdStringException(field, SkillTriggerRuntimeInputBinding.class,
                    "动态输入绑定包含未知字段：" + field);
            }
        }
        SkillTriggerRuntimeInputSourceType sourceType =
            codec.treeToValue(node.get("sourceType"), SkillTriggerRuntimeInputSourceType.class);
        SkillTriggerRuntimeInputBindingDetail detail = null;
        JsonNode detailNode = node.get("detail");
        if (detailNode != null && !detailNode.isNull() && sourceType != null) {
            Class<? extends SkillTriggerRuntimeInputBindingDetail> detailClass = switch (sourceType) {
                case INTERNAL_STATE -> SkillTriggerInternalStateBindingDetail.class;
                case COMBAT_STATUS -> SkillTriggerCombatStatusBindingDetail.class;
                case COMBAT_ELAPSED_TIME -> SkillTriggerCombatElapsedTimeBindingDetail.class;
                case RECENT_DAMAGE_SUM -> SkillTriggerRecentDamageSumBindingDetail.class;
                case EVENT_VALUE -> SkillTriggerEventValueBindingDetail.class;
                case SOURCE_CAST_RESOURCE_COST -> SkillTriggerSourceCastResourceCostBindingDetail.class;
                case SCENE_ATTRIBUTE_SNAPSHOT -> SkillTriggerSceneAttributeSnapshotBindingDetail.class;
                case SCENE_INITIAL_PARAMETER -> SkillTriggerSceneInitialParameterBindingDetail.class;
                case PRIOR_ACTION_RESULT -> SkillTriggerPriorResultBindingDetail.class;
            };
            detail = codec.treeToValue(detailNode, detailClass);
        }
        return new SkillTriggerRuntimeInputBinding(
            text(node, "bindingKey"),
            text(node, "parameterKey"),
            sourceType,
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
