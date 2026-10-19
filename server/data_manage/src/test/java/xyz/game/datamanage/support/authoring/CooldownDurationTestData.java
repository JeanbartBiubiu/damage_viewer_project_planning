package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.node.ObjectNode;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;

/** 独立于真实英雄的作者配置，供协议、保存和最终态检查共用。 */
public final class CooldownDurationTestData {
    private CooldownDurationTestData() { }
    public static ObjectNode effect() {
        return (ObjectNode) AggregateJson.tree("""
            {"lifecycle":{"durationValue":{"kind":"FIXED","value":15000},
              "maxStacksValue":{"kind":"FIXED","value":1},"applicationStacksValue":{"kind":"FIXED","value":1},
              "instanceScope":"SOURCE","reapplicationStackMode":"KEEP","reapplicationDurationMode":"REFRESH_ALL",
              "expiryMode":"ALL_AT_ONCE","periodicIntervalValue":null,"firstPeriodicExecution":null,"endWhenShieldEndsResultKey":null},
             "results":[{"resultKey":"duration","name":"冷却时长倍率","resultType":"COOLDOWN_DURATION_MODIFIER","target":"SOURCE",
               "description":null,"sortOrder":10,"valueRule":{"value":{"kind":"FIXED","value":0.5},
                 "fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
               "detail":{"affectedSkillScope":{"mode":"SKILLS","skillKeys":["target_skill"],"skillCategoryKeys":[]}},
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED",
                 "reapplicationValueMode":"REPLACE","periodicExecutionMode":null},"spellShieldBlockScope":null}]}
            """);
    }
    public static ObjectNode result() { return (ObjectNode) effect().path("results").get(0); }
    public static Aggregate aggregate(ObjectNode data) { return new Aggregate(SourceType.EFFECT, "caster_skill", "buff", data); }
    public static ObjectNode fixed(String number) { return (ObjectNode) AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":" + number + "}"); }
}
