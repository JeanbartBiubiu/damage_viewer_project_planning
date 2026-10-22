package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;

/** 显式目标时序；不存在的声明与显式空值严格区分。 */
@JsonDeserialize(using = SkillInternalStateTargetTiming.Decoder.class)
public sealed interface SkillInternalStateTargetTiming {
    @JsonProperty("kind") String kind();
    String processKey();

    enum PhasePolicy { PRESERVE_ON_EXTEND }

    record PhasedTick(String processKey, SkillNumericValue intervalValue, PhasePolicy phasePolicy)
        implements SkillInternalStateTargetTiming {
        @Override public String kind() { return "PHASED_TICK"; }
    }

    record ExpiryPayload(String processKey) implements SkillInternalStateTargetTiming {
        @Override public String kind() { return "EXPIRY_PAYLOAD"; }
    }

    final class Decoder extends JsonDeserializer<SkillInternalStateTargetTiming> {
        @Override public SkillInternalStateTargetTiming getNullValue(DeserializationContext context) throws JsonMappingException {
            return context.reportInputMismatch(SkillInternalStateTargetTiming.class, "targetTiming不能显式为空");
        }

        @Override public SkillInternalStateTargetTiming getAbsentValue(DeserializationContext context) { return null; }

        @Override public SkillInternalStateTargetTiming deserialize(JsonParser parser, DeserializationContext context)
            throws IOException {
            JsonNode node = parser.getCodec().readTree(parser);
            String kind = node.path("kind").asText("");
            Set<String> allowed = switch (kind) {
                case "PHASED_TICK" -> Set.of("kind", "processKey", "intervalValue", "phasePolicy");
                case "EXPIRY_PAYLOAD" -> Set.of("kind", "processKey");
                default -> Set.of();
            };
            Set<String> keys = new HashSet<>();
            node.fieldNames().forEachRemaining(keys::add);
            if (!node.isObject() || allowed.isEmpty() || !keys.equals(allowed)
                || !node.path("kind").isTextual() || !node.path("processKey").isTextual()
                || !node.path("processKey").asText().matches("[a-z][a-z0-9_]{0,63}")) {
                return context.reportInputMismatch(SkillInternalStateTargetTiming.class, "目标时序字段、种类或过程标识不合法");
            }
            if (kind.equals("EXPIRY_PAYLOAD")) return new ExpiryPayload(node.get("processKey").asText());
            if (!node.path("phasePolicy").isTextual() || !"PRESERVE_ON_EXTEND".equals(node.path("phasePolicy").asText())
                || !node.path("intervalValue").isObject()) {
                return context.reportInputMismatch(SkillInternalStateTargetTiming.class, "周期目标时序需要明确保相位策略与数值间隔");
            }
            SkillNumericValue interval = parser.getCodec().treeToValue(node.get("intervalValue"), SkillNumericValue.class);
            return new PhasedTick(node.get("processKey").asText(), interval, PhasePolicy.PRESERVE_ON_EXTEND);
        }
    }
}
