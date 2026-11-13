package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;

final class ProcessBehaviorTestData {
    static final String SKILL = "caster_skill";

    private ProcessBehaviorTestData() {}

    static Aggregate waitProcess(String key) {
        return new Aggregate(SourceType.PROCESS, SKILL, key, AggregateJson.tree("""
            {"activationType":"PASSIVE","cooldown":null,
             "steps":[{"stepKey":"wait","stepType":"DELAY","occupiesAction":false,
               "detail":{"delayValue":{"kind":"FIXED","value":300}}}],
             "effectBindings":[],"stateOperations":[]}
            """));
    }

    static Aggregate leafProcess(String key) {
        ObjectNode data = (ObjectNode) waitProcess(key).data();
        data.set("cooldown", AggregateJson.tree("""
            {"durationValue":{"kind":"FIXED","value":1000},
             "startMoment":{"momentType":"PROCESS_START","stepKey":null}}
            """));
        return new Aggregate(SourceType.PROCESS, SKILL, key, data);
    }

    static Aggregate rule(String key, String process, String target) {
        return new Aggregate(SourceType.TRIGGER, SKILL, key, AggregateJson.tree("""
            {"eventSource":{"eventType":"PROCESS_MOMENT","detail":{"processKey":"%s",
               "moment":{"momentType":"STEP_EXECUTION","stepKey":"wait"}}},
             "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS",
               "target":"EVENT_TARGET","sortOrder":0,"detail":{"processKey":"%s"},"runtimeInputBindings":[]}]}
            """.formatted(process, target)));
    }

    static Map<String, Object> row(Aggregate aggregate) {
        return Map.of("source_type", aggregate.type().name(), "skill_key", aggregate.skillKey(),
            "source_key", aggregate.key(), "data", aggregate.data().toString());
    }
}
