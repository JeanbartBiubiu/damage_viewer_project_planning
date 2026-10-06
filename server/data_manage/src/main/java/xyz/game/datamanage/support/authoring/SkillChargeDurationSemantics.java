package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

public final class SkillChargeDurationSemantics {
    private SkillChargeDurationSemantics() { }

    public static boolean hitAvailable(String skillKey, String sourceSkillKey, Collection<Aggregate> context) {
        if (!skillKey.equals(sourceSkillKey)) return false;
        List<Aggregate> processes = context.stream().filter(object -> object.type() == SourceType.PROCESS
            && object.skillKey().equals(skillKey) && object.data().path("activationType").asText().equals("ACTIVE")).toList();
        Set<String> keys = processes.stream().map(Aggregate::key).collect(Collectors.toSet());
        if (keys.size() != 1) return false;
        String processKey = keys.iterator().next();
        Set<String> chargeSteps = processes.stream().flatMap(process -> process.data().path("steps").valueStream())
            .filter(step -> step.path("stepType").asText().equals("CHARGE"))
            .map(step -> step.path("stepKey").asText()).filter(key -> !key.isEmpty()).collect(Collectors.toSet());
        if (chargeSteps.isEmpty()) return false;
        boolean automaticRelease = processes.stream().flatMap(process -> process.data().path("steps").valueStream())
            .anyMatch(step -> step.path("stepType").asText().equals("CHARGE")
                && step.path("detail").path("releaseAtMaximum").isBoolean()
                && step.path("detail").path("releaseAtMaximum").booleanValue());
        boolean initial = false;
        boolean release = false;
        for (Aggregate rule : context) {
            if (rule.type() != SourceType.TRIGGER || !rule.skillKey().equals(skillKey)) continue;
            JsonNode event = rule.data().path("eventSource");
            JsonNode detail = event.path("detail");
            if (!event.path("eventType").asText().equals("SKILL_USED")
                || detail.hasNonNull("sourceSkillKey") && !detail.path("sourceSkillKey").asText().equals(skillKey)) continue;
            for (JsonNode action : rule.data().path("actions")) {
                JsonNode control = action.path("detail");
                if (!control.path("processKey").asText().equals(processKey)) continue;
                if (detail.path("castPhase").asText().equals("INITIAL") && action.path("actionType").asText().equals("START_PROCESS")) initial = true;
                if (detail.path("castPhase").asText().equals("CHARGE_RELEASE") && detail.path("sourceSkillKey").asText().equals(skillKey)
                    && action.path("actionType").asText().equals("ADVANCE_PROCESS") && chargeSteps.contains(control.path("stepKey").asText())) release = true;
            }
        }
        return initial && (release || automaticRelease);
    }

    public static boolean valueAvailable(Aggregate rule, Collection<Aggregate> context) {
        JsonNode event = rule.data().path("eventSource");
        JsonNode detail = event.path("detail");
        if (event.path("eventType").asText().equals("SKILL_HIT")) {
            return hitAvailable(rule.skillKey(), detail.path("sourceSkillKey").asText(), context);
        }
        if (!event.path("eventType").asText().equals("PROCESS_MOMENT")) return false;
        JsonNode moment = detail.path("moment");
        try {
            SkillProcessMomentType momentType = SkillProcessMomentType.valueOf(moment.path("momentType").asText());
            return context.stream().filter(object -> object.type() == SourceType.PROCESS && object.skillKey().equals(rule.skillKey())
                && object.key().equals(detail.path("processKey").asText()))
                .flatMap(process -> process.data().path("steps").valueStream())
                .anyMatch(step -> step.path("stepKey").asText().equals(moment.path("stepKey").asText())
                    && step.path("stepType").asText().equals("CHARGE")
                    && SkillTriggerEventCapabilities.eventValueAllowed(SkillTriggerEventType.PROCESS_MOMENT,
                        SkillTriggerEventValueKey.CHARGE_DURATION_MS, momentType, SkillProcessStepType.CHARGE));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    public static void validate(List<Aggregate> sources, List<Aggregate> context) {
        for (Aggregate rule : sources) {
            if (rule.type() != SourceType.TRIGGER) continue;
            JsonNode groups = rule.data().path("conditionGroups");
            for (int groupIndex = 0; groupIndex < groups.size(); groupIndex++) {
                JsonNode conditions = groups.get(groupIndex).path("conditions");
                for (int index = 0; index < conditions.size(); index++) {
                    JsonNode condition = conditions.get(index);
                    if (condition.path("conditionType").asText().equals("EVENT_VALUE_COMPARE")) {
                        validateValue(rule, condition.path("detail"), "conditionGroups[" + groupIndex + "].conditions[" + index + "].detail", context);
                    }
                }
            }
            JsonNode actions = rule.data().path("actions");
            for (int actionIndex = 0; actionIndex < actions.size(); actionIndex++) {
                JsonNode bindings = actions.get(actionIndex).path("runtimeInputBindings");
                for (int index = 0; index < bindings.size(); index++) {
                    JsonNode binding = bindings.get(index);
                    if (binding.path("sourceType").asText().equals("EVENT_VALUE")) {
                        validateValue(rule, binding.path("detail"), "actions[" + actionIndex + "].runtimeInputBindings[" + index + "].detail", context);
                    }
                }
            }
        }
    }

    private static void validateValue(Aggregate rule, JsonNode detail, String path, List<Aggregate> context) {
        if (!detail.path("eventValueKey").asText().equals("CHARGE_DURATION_MS") || valueAvailable(rule, context)) return;
        throw new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID", "充能时长缺少同技能实际充能释放组成或合法过程时点",
            Map.of("fieldIssues", List.of(Map.of("field", path + ".eventValueKey", "code", "EVENT_VALUE_NOT_AVAILABLE",
                "sourceSkillKey", rule.skillKey(), "sourceType", rule.type().name(), "sourceKey", rule.key()))));
    }
}
