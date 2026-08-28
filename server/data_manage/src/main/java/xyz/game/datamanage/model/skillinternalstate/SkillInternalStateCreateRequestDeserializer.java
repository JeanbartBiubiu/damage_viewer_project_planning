package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.ObjectCodec;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;

public final class SkillInternalStateCreateRequestDeserializer
    extends JsonDeserializer<SkillInternalStateCreateRequest> {

    @Override
    public SkillInternalStateCreateRequest deserialize(JsonParser parser, DeserializationContext context)
        throws IOException {
        ObjectCodec codec = parser.getCodec();
        JsonNode node = codec.readTree(parser);
        SkillInternalStateType stateType =
            codec.treeToValue(node.get("stateType"), SkillInternalStateType.class);
        return new SkillInternalStateCreateRequest(
            SkillInternalStateDetailBinder.text(node, "stateKey"),
            SkillInternalStateDetailBinder.text(node, "name"),
            stateType,
            codec.treeToValue(node.get("scope"), SkillInternalStateScope.class),
            SkillInternalStateDetailBinder.text(node, "description"),
            codec.treeToValue(node.get("sortOrder"), Integer.class),
            SkillInternalStateDetailBinder.bind(codec, stateType, node.get("detail"))
        );
    }
}
