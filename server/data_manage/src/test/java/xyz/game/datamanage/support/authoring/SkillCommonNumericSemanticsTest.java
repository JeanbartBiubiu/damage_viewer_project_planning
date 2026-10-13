package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import static xyz.game.datamanage.support.formula.SkillFormulaFixtures.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.error.ApiException;

class SkillCommonNumericSemanticsTest {
    static final ObjectMapper JSON=new ObjectMapper();
    static Aggregate formula(JsonNode definition) { return new Aggregate(SourceType.FORMULA,"skill","f",JSON.createObjectNode().set("expression",definition)); }
    static Aggregate threshold() { return new Aggregate(SourceType.EFFECT,"skill","modifier",AggregateJson.tree("""
        {"lifecycle":{},"results":[{"resultKey":"damage","resultType":"DAMAGE_MODIFIER","target":"SOURCE",
         "lifecycleBehavior":{"moment":"PERSISTENT"},"detail":{"modifierZoneKey":"zone","direction":"DEALT",
         "condition":{"receiver":"ENEMY_CHAMPION","attributeKey":"hp","attributeValueKind":"CURRENT_RATIO",
         "comparator":"LT","comparisonValue":{"kind":"FORMULA","formulaKey":"f"}}}}]}
        """)); }
    static void validate(JsonNode definition,List<Parameter> parameters) {
        SkillNumericSemantics.validate(List.of(formula(definition),threshold()),parameters,Map.of("zone","RATIO_ADD"),
            Map.of("zone","DAMAGE"),Map.of("zone","DAMAGE_PRE_DEFENSE"));
    }
    static ObjectNode expression(String json) { return definition(AggregateJson.tree(json)); }
    static void reject(JsonNode definition,List<Parameter> parameters,String code) {
        var error=assertThrows(ApiException.class,()->validate(definition,parameters));
        assertTrue(error.getDetails().toString().contains(code),error.getDetails().toString());
    }
    static Stream<Arguments> arithmetic() {
        return Stream.of(
            Arguments.of("add","0.2","0.3"),Arguments.of("sub","0.9","0.3"),Arguments.of("mul","0.5","0.5"),
            Arguments.of("div","1","3"),Arguments.of("min","2","0.5"),Arguments.of("max","0.25","0.5"),
            Arguments.of("eq","3","3"),Arguments.of("ne","3","4"),Arguments.of("lt","3","4"),
            Arguments.of("lte","3","3"),Arguments.of("gt","4","3"),Arguments.of("gte","3","3"));
    }
    @ParameterizedTest @MethodSource("arithmetic")
    void arithmeticAndComparisonUseExactStaticProof(String op,String a,String b) {
        assertDoesNotThrow(()->validate(expression("{\"op\":\""+op+"\",\"args\":[{\"op\":\"const\",\"value\":\""+a+"\"},{\"op\":\"const\",\"value\":\""+b+"\"}]}"),List.of()));
    }
    @Test void roundsAreExactAndMidpointsAwayFromZero() {
        for(String op:List.of("floor","ceil","trunc"))assertDoesNotThrow(()->validate(expression("{\"op\":\""+op+"\",\"args\":[{\"op\":\"const\",\"value\":\"0.5\"}]}"),List.of()));
        assertDoesNotThrow(()->validate(expression("{\"op\":\"round\",\"args\":[{\"op\":\"const\",\"value\":\"0.5\"}],\"decimals\":0}"),List.of()));
        reject(expression("{\"op\":\"round\",\"args\":[{\"op\":\"const\",\"value\":\"-0.5\"}],\"decimals\":0}"),List.of(),"VALUE_RANGE_INVALID");
    }
    @Test void localStagesAndLazyIfKeepUnselectedDivisionUnevaluated() {
        ObjectNode definition=expression("{\"op\":\"ref\",\"stageKey\":\"lazy\"}");
        definition.withArray("stages").addObject().put("key","lazy").put("name","选择").set("expression",AggregateJson.tree("""
            {"op":"if","args":[{"op":"const","value":"1"},{"op":"const","value":"0.25"},{"op":"div","args":[{"op":"const","value":"1"},{"op":"const","value":"0"}]}]}
            """));
        definition.withArray("stages").addObject().put("key","unused").put("name","未使用").set("expression",AggregateJson.tree("""
            {"op":"div","args":[{"op":"const","value":"1"},{"op":"const","value":"0"}]}
            """));
        assertDoesNotThrow(()->validate(definition,List.of()));
        ((ObjectNode)definition.path("stages").get(1).path("expression").path("args").get(0)).put("value","0");
        reject(definition,List.of(),"FORMULA_NOT_STATIC");
    }
    @Test void clampRejectsInvertedBoundsAndAcceptsValidLimit() {
        assertDoesNotThrow(()->validate(expression("{\"op\":\"clamp\",\"args\":[{\"op\":\"const\",\"value\":\"2\"},{\"op\":\"const\",\"value\":\"0\"},{\"op\":\"const\",\"value\":\"1\"}]}"),List.of()));
        reject(expression("{\"op\":\"clamp\",\"args\":[{\"op\":\"const\",\"value\":\"0.5\"},{\"op\":\"const\",\"value\":\"1\"},{\"op\":\"const\",\"value\":\"0\"}]}"),List.of(),"FORMULA_NOT_STATIC");
    }
    @Test void exactFractionCatchesAboveOneEvenWhenDoubleRoundsToOne() {
        reject(expression("{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":\"1\"},{\"op\":\"const\",\"value\":\"0.00000000000000000000000001\"}]}"),List.of(),"VALUE_RANGE_INVALID");
    }
    @Test void unusedRuntimeInputIsNotAStaticDependencyButBothIfBranchesAre() {
        ObjectNode definition=constant("0.5");definition.withArray("inputs").addObject().put("key","r").putObject("binding").put("kind","parameter").put("skillKey","skill").put("parameterKey","p");
        List<Parameter> params=List.of(new Parameter("skill","p","DECIMAL","RUNTIME_INPUT",null,null));
        assertDoesNotThrow(()->validate(definition,params));
        ((ObjectNode)definition.path("stages").get(0)).set("expression",AggregateJson.tree("{\"op\":\"if\",\"args\":[{\"op\":\"const\",\"value\":\"1\"},{\"op\":\"const\",\"value\":\"0.5\"},{\"op\":\"read\",\"inputKey\":\"r\"}]}"));
        reject(definition,params,"RUNTIME_INPUT_FORBIDDEN");
    }
    @Test void ammunitionInitialAndCapacityUseExactCompatibleGradeCombinations() {
        ObjectNode initial=parameter("skill","initial");
        var state=new Aggregate(SourceType.STATE,"skill","ammo",AggregateJson.tree("""
            {"stateType":"AMMO","detail":{"initialValue":{"kind":"FORMULA","formulaKey":"f"},"maxValue":{"kind":"PARAMETER","parameterKey":"limit"}}}
            """));
        List<Parameter> params=List.of(new Parameter("skill","initial","INTEGER","SKILL_LEVEL",null,AggregateJson.tree("{\"1\":1,\"2\":3}")),
            new Parameter("skill","limit","INTEGER","SKILL_LEVEL",null,AggregateJson.tree("{\"1\":1,\"2\":3}")));
        assertDoesNotThrow(()->SkillNumericSemantics.validate(List.of(formula(initial),state),params));
        var changed=new Parameter("skill","limit","INTEGER","SKILL_LEVEL",null,AggregateJson.tree("{\"1\":1,\"2\":2}"));
        var error=assertThrows(ApiException.class,()->SkillNumericSemantics.validate(List.of(formula(initial),state),List.of(params.getFirst(),changed)));
        assertTrue(error.getDetails().toString().contains("STATE_CAPACITY_EXCEEDED"));
    }
}
