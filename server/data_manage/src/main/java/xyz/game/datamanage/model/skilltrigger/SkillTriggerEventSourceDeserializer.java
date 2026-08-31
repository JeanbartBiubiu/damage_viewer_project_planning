package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.ObjectCodec;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;

public final class SkillTriggerEventSourceDeserializer extends JsonDeserializer<SkillTriggerEventSource> {

    @Override
    public SkillTriggerEventSource deserialize(JsonParser parser, DeserializationContext context)
        throws IOException {
        ObjectCodec codec = parser.getCodec();
        JsonNode node = codec.readTree(parser);
        SkillTriggerEventType eventType = codec.treeToValue(node.get("eventType"), SkillTriggerEventType.class);
        SkillTriggerEventDetail detail = null;
        JsonNode detailNode = node.get("detail");
        if (detailNode != null && !detailNode.isNull() && eventType != null) {
            Class<? extends SkillTriggerEventDetail> detailClass = switch (eventType) {
                case PROCESS_MOMENT -> SkillTriggerProcessEventDetail.class;
                case PROCESS_CANCEL_REQUESTED -> SkillTriggerCancelProcessEventDetail.class;
                case SKILL_USED, SKILL_HIT -> SkillTriggerSkillEventDetail.class;
                case RESULT_AVAILABLE -> SkillTriggerResultEventDetail.class;
                case LIFECYCLE_MOMENT -> SkillTriggerLifecycleEventDetail.class;
                case STATUS_CHANGED -> SkillTriggerStatusEventDetail.class;
                case HEALTH_THRESHOLD_CROSSED -> SkillTriggerHealthThresholdEventDetail.class;
                case INTERNAL_STATE_CHANGED -> SkillTriggerInternalStateEventDetail.class;
                case ENTITY_DIED, ENTITY_UNTARGETABLE -> SkillTriggerSubjectEventDetail.class;
                case DAMAGE_PENDING, DAMAGE_DEALT, DAMAGE_TAKEN -> SkillTriggerDamageEventDetail.class;
                case BASIC_ATTACK_START, BASIC_ATTACK_HIT, CONTROL_RECEIVED, KILL ->
                    SkillTriggerEmptyEventDetail.class;
            };
            detail = codec.treeToValue(detailNode, detailClass);
        }
        return new SkillTriggerEventSource(eventType, detail);
    }
}
