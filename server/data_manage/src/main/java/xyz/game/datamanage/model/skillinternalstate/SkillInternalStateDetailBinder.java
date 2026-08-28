package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.core.ObjectCodec;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;

final class SkillInternalStateDetailBinder {

    private SkillInternalStateDetailBinder() {
    }

    static SkillInternalStateDetail bind(ObjectCodec codec, SkillInternalStateType stateType, JsonNode detailNode)
        throws IOException {
        if (detailNode == null || detailNode.isNull() || stateType == null) {
            return null;
        }
        Class<? extends SkillInternalStateDetail> detailClass = switch (stateType) {
            case COUNTER -> SkillInternalStateCounterDetail.class;
            case AMMO -> SkillInternalStateAmmoDetail.class;
            case MODE -> SkillInternalStateModeDetail.class;
            case FLAG -> SkillInternalStateFlagDetail.class;
            case INTERNAL_COOLDOWN -> SkillInternalStateCooldownDetail.class;
        };
        return codec.treeToValue(detailNode, detailClass);
    }

    static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return value.asText();
    }
}
