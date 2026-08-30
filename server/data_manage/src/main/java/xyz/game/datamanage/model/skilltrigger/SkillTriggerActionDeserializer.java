package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.ObjectCodec;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.type.CollectionType;
import java.io.IOException;
import java.util.List;

public final class SkillTriggerActionDeserializer extends JsonDeserializer<SkillTriggerAction> {

    @Override
    public SkillTriggerAction deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        ObjectCodec codec = parser.getCodec();
        JsonNode node = codec.readTree(parser);
        SkillTriggerActionType actionType = codec.treeToValue(node.get("actionType"), SkillTriggerActionType.class);
        SkillTriggerActionDetail detail = null;
        JsonNode detailNode = node.get("detail");
        if (detailNode != null && !detailNode.isNull() && actionType != null) {
            Class<? extends SkillTriggerActionDetail> detailClass = switch (actionType) {
                case EXECUTE_EFFECT -> SkillTriggerExecuteEffectActionDetail.class;
                case START_PROCESS -> SkillTriggerStartProcessActionDetail.class;
                case FAIL_PROCESS -> SkillTriggerFailProcessActionDetail.class;
            };
            detail = codec.treeToValue(detailNode, detailClass);
        }
        ObjectMapper mapper = (ObjectMapper) codec;
        CollectionType bindingType = mapper.getTypeFactory()
            .constructCollectionType(List.class, SkillTriggerRuntimeInputBinding.class);
        CollectionType modifierType = mapper.getTypeFactory()
            .constructCollectionType(List.class, SkillTriggerResultModifier.class);
        List<SkillTriggerRuntimeInputBinding> bindings = node.has("runtimeInputBindings")
            ? mapper.convertValue(node.get("runtimeInputBindings"), bindingType)
            : null;
        List<SkillTriggerResultModifier> modifiers = node.has("resultModifiers")
            ? mapper.convertValue(node.get("resultModifiers"), modifierType)
            : null;
        return new SkillTriggerAction(
            text(node, "actionKey"),
            text(node, "name"),
            actionType,
            codec.treeToValue(node.get("sortOrder"), Integer.class),
            codec.treeToValue(node.get("targetContext"), SkillTriggerTargetContext.class),
            detail,
            bindings,
            modifiers
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
