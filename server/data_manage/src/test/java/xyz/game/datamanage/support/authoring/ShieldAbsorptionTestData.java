package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;

public final class ShieldAbsorptionTestData {
    private ShieldAbsorptionTestData() { }

    public static JsonNode selector(String skill) {
        return AggregateJson.tree("{\"skillKey\":\"" + skill + "\",\"effectKey\":\"barrier\",\"resultKey\":\"shield\"}");
    }

    public static Aggregate shield(String skill) {
        return new Aggregate(SourceType.EFFECT, skill, "barrier", AggregateJson.tree("""
            {"lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},
             "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE",
             "reapplicationStackMode":"KEEP","reapplicationDurationMode":null,"expiryMode":"EXPLICIT_ONLY",
             "periodicIntervalValue":null,"firstPeriodicExecution":null,"endWhenShieldEndsResultKey":"shield"},
             "results":[{"resultKey":"shield","name":"普通盾","resultType":"NORMAL_SHIELD","target":"SOURCE",
              "description":null,"sortOrder":0,"detail":{"absorbedDamageTypeKey":null,"decayMode":"NONE"},
              "valueRule":{"value":{"kind":"FIXED","value":10},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
              "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED",
               "reapplicationValueMode":"REPLACE","periodicExecutionMode":null},"spellShieldBlockScope":null}]}
            """));
    }

    public static Aggregate rule(String skill) {
        var data = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree("""
            {"eventSource":{"eventType":"DAMAGE_TAKEN","detail":{}},
             "conditionGroups":[{"groupKey":"first","sortOrder":0,"conditions":[{"conditionKey":"absorbed",
              "sortOrder":0,"conditionType":"EVENT_VALUE_COMPARE","detail":{"eventValueKey":"SHIELD_ABSORBED",
              "comparator":"GT","comparisonValue":{"kind":"FIXED","value":0}}}]}],"actions":[],"limits":{}}
            """);
        ((com.fasterxml.jackson.databind.node.ObjectNode) data.path("conditionGroups").get(0).path("conditions").get(0).path("detail"))
            .set("shieldResult", selector(skill));
        return new Aggregate(SourceType.TRIGGER, skill, "first_damage", data);
    }
}
