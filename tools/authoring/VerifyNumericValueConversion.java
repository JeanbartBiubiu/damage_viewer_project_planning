import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** 独立运行的数值迁移转换校验，不读取配置、不连接数据库。 */
class VerifyNumericValueConversion {
    private static final ObjectMapper JSON = new ObjectMapper().enable(com.fasterxml.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

    public static void main(String[] args) throws Exception {
        check("effects", """
            {"effectKey":"one","lifecycle":{"durationFormulaKey":null,"maxStacksFormulaKey":"max","applicationStacksFormulaKey":"apply","periodicIntervalFormulaKey":"tick"},
             "results":[{"resultKey":"first","valueRule":{"formulaKey":"damage","fixedMultiplier":0,"fixedMinValue":null,"fixedMaxValue":2.5},"detail":{"critical":{"multiplierFormulaKey":"crit"},"vampRules":[{"efficiencyFormulaKey":"vamp"}]}},{"resultKey":"second","valueRule":null,"detail":{}}]}
            """, """
            {"effectKey":"one","lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FORMULA","formulaKey":"max"},"applicationStacksValue":{"kind":"FORMULA","formulaKey":"apply"},"periodicIntervalValue":{"kind":"FORMULA","formulaKey":"tick"}},
             "results":[{"resultKey":"first","valueRule":{"value":{"kind":"FORMULA","formulaKey":"damage"},"fixedMultiplier":0,"fixedMinValue":null,"fixedMaxValue":2.5},"detail":{"critical":{"multiplierValue":{"kind":"FORMULA","formulaKey":"crit"}},"vampRules":[{"efficiencyValue":{"kind":"FORMULA","formulaKey":"vamp"}}]}},{"resultKey":"second","valueRule":null,"detail":{}}]}
            """);
        check("internal-states", """
            {"stateType":"AMMO","detail":{"initialValueFormulaKey":"initial","maxValueFormulaKey":"max","recoveryIntervalFormulaKey":"recovery"}}
            """, """
            {"stateType":"AMMO","detail":{"initialValue":{"kind":"FORMULA","formulaKey":"initial"},"maxValue":{"kind":"FORMULA","formulaKey":"max"},"recoveryIntervalValue":{"kind":"FORMULA","formulaKey":"recovery"}}}
            """);
        check("internal-states", """
            {"stateType":"INTERNAL_COOLDOWN","detail":{"durationFormulaKey":"cooldown"}}
            """, """
            {"stateType":"INTERNAL_COOLDOWN","detail":{"durationValue":{"kind":"FORMULA","formulaKey":"cooldown"}}}
            """);
        check("processes", """
            {"steps":[{"stepType":"DELAY","detail":{"delayFormulaKey":"delay"}},{"stepType":"MULTI_HIT","detail":{"repeatCountFormulaKey":"repeat","intervalFormulaKey":null}},{"stepType":"PERIODIC","detail":{"repeatCountFormulaKey":"count","intervalFormulaKey":"interval","firstExecution":"AFTER_INTERVAL"}},{"stepType":"CHANNEL","detail":{"durationFormulaKey":"duration","executionCountFormulaKey":"executions"}},{"stepType":"CHARGE","detail":{"minimumChargeFormulaKey":"minimum","maximumChargeFormulaKey":"maximum"}},{"stepType":"RECAST","detail":{"windowFormulaKey":"window","maximumRecastCountFormulaKey":"recast"}},{"stepType":"EMPOWERED_BASIC_ATTACK","detail":{"windowFormulaKey":"empowered"}}],"cooldown":{"durationFormulaKey":"cooldown"},"stateOperations":[{"operation":"INCREASE","valueFormulaKey":"delta"},{"operation":"RESET","valueFormulaKey":null}],"effectBindings":[{"effectKey":"hit","sortOrder":0}]}
            """, """
            {"steps":[{"stepType":"DELAY","detail":{"delayValue":{"kind":"FORMULA","formulaKey":"delay"}}},{"stepType":"MULTI_HIT","detail":{"repeatCountValue":{"kind":"FORMULA","formulaKey":"repeat"},"intervalValue":null}},{"stepType":"PERIODIC","detail":{"repeatCountValue":{"kind":"FORMULA","formulaKey":"count"},"intervalValue":{"kind":"FORMULA","formulaKey":"interval"},"firstExecution":"AFTER_INTERVAL"}},{"stepType":"CHANNEL","detail":{"durationValue":{"kind":"FORMULA","formulaKey":"duration"},"executionCountValue":{"kind":"FORMULA","formulaKey":"executions"}}},{"stepType":"CHARGE","detail":{"minimumChargeValue":{"kind":"FORMULA","formulaKey":"minimum"},"maximumChargeValue":{"kind":"FORMULA","formulaKey":"maximum"}}},{"stepType":"RECAST","detail":{"windowValue":{"kind":"FORMULA","formulaKey":"window"},"maximumRecastCountValue":{"kind":"FORMULA","formulaKey":"recast"}}},{"stepType":"EMPOWERED_BASIC_ATTACK","detail":{"windowValue":{"kind":"FORMULA","formulaKey":"empowered"}}}],"cooldown":{"durationValue":{"kind":"FORMULA","formulaKey":"cooldown"}},"stateOperations":[{"operation":"INCREASE","value":{"kind":"FORMULA","formulaKey":"delta"}},{"operation":"RESET","value":null}],"effectBindings":[{"effectKey":"hit","sortOrder":0}]}
            """);
        check("trigger-rules", """
            {"eventSource":{"eventType":"HEALTH_THRESHOLD_CROSSED","detail":{"thresholdFormulaKey":"threshold"}},"conditionGroups":[{"conditions":[{"conditionKey":"one","detail":{"comparisonFormulaKey":"comparison"}},{"conditionKey":"two","detail":{"comparisonFormulaKey":null}}]}],"perTargetCooldown":{"durationFormulaKey":"duration"},"maxTriggersPerProcess":{"limitFormulaKey":"limit"},"actions":[{"actionKey":"a","runtimeInputBindings":[{"parameterKey":"input"}]}]}
            """, """
            {"eventSource":{"eventType":"HEALTH_THRESHOLD_CROSSED","detail":{"thresholdValue":{"kind":"FORMULA","formulaKey":"threshold"}}},"conditionGroups":[{"conditions":[{"conditionKey":"one","detail":{"comparisonValue":{"kind":"FORMULA","formulaKey":"comparison"}}},{"conditionKey":"two","detail":{"comparisonValue":null}}]}],"perTargetCooldown":{"durationValue":{"kind":"FORMULA","formulaKey":"duration"}},"maxTriggersPerProcess":{"limitValue":{"kind":"FORMULA","formulaKey":"limit"}},"actions":[{"actionKey":"a","runtimeInputBindings":[{"parameterKey":"input"}]}]}
            """);
        check("effects", """
            {"formulaKey":"metadata","description":"formulaKey is text","results":[],"lifecycle":null}
            """, """
            {"formulaKey":"metadata","description":"formulaKey is text","results":[],"lifecycle":null}
            """);
        reject("{\"detail\":{\"durationFormulaKey\":\"old\",\"durationValue\":null}}");
        reject("{\"detail\":{\"durationFormulaKey\":0}}");
        reject("{\"detail\":{\"durationFormulaKey\":\"\"}}");
        System.out.println("numericConversionCases=9 passed; databaseAccess=none");
    }

    private static void check(String resource, String before, String expected) throws Exception {
        ObjectNode actual = (ObjectNode) JSON.readTree(before);
        MigrateNumericValues.convert(resource, actual);
        if (!JSON.readTree(expected).equals(actual)) throw new AssertionError("转换契约不一致 " + resource);
    }

    private static void reject(String before) throws Exception {
        ObjectNode node = (ObjectNode) JSON.readTree(before);
        try { MigrateNumericValues.convert("internal-states", node); }
        catch (IllegalStateException expected) { return; }
        throw new AssertionError("混合或不合法旧取值未被拒绝");
    }
}
