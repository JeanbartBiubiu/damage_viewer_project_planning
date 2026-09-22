package xyz.game.datamanage.model.value;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicy;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampOverride;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessCooldown;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldown;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimit;

class SkillNumericValueTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @ParameterizedTest
    @MethodSource("validValues")
    void threeSourcesRoundTripWithOnlyTheirOwnFields(String json, SkillNumericValue expected) throws Exception {
        SkillNumericValue actual = mapper.readValue(json, SkillNumericValue.class);
        assertEquals(expected, actual);
        JsonNode serialized = mapper.readTree(mapper.writeValueAsString(actual));
        assertEquals(mapper.readTree(json), serialized);
        assertEquals(2, serialized.size());
    }

    static Stream<Arguments> validValues() {
        return Stream.of(
            Arguments.of("{\"kind\":\"FIXED\",\"value\":0}", SkillNumericValue.fixed(BigDecimal.ZERO)),
            Arguments.of("{\"kind\":\"FIXED\",\"value\":-1.25}", SkillNumericValue.fixed(new BigDecimal("-1.25"))),
            Arguments.of("{\"kind\":\"PARAMETER\",\"parameterKey\":\"base_damage\"}", SkillNumericValue.parameter("base_damage")),
            Arguments.of("{\"kind\":\"FORMULA\",\"formulaKey\":\"damage_total\"}", SkillNumericValue.formula("damage_total"))
        );
    }

    @Test
    void decimalPrecisionSurvivesReadingAndWritingWithoutPassingThroughDouble() throws Exception {
        String decimal = "0.12345678901234567890123456789";
        SkillNumericValue actual = mapper.readValue("{\"kind\":\"FIXED\",\"value\":" + decimal + "}", SkillNumericValue.class);
        assertEquals(new BigDecimal(decimal), actual.value());
        assertEquals(actual, mapper.readValue(mapper.writeValueAsString(actual), SkillNumericValue.class));
        assertTrue(mapper.writeValueAsString(actual).contains(decimal));
    }

    @Test
    void zeroIsConfiguredWhileNullAndOmittedOptionalValuesAreAbsent() throws Exception {
        SkillEffectLifecycleRequest configured = mapper.readValue(
            "{\"durationValue\":{\"kind\":\"FIXED\",\"value\":0}}", SkillEffectLifecycleRequest.class);
        SkillEffectLifecycleRequest absent = mapper.readValue("{\"durationValue\":null}", SkillEffectLifecycleRequest.class);
        SkillEffectLifecycleRequest omitted = mapper.readValue("{}", SkillEffectLifecycleRequest.class);
        assertEquals(SkillNumericValue.fixed(BigDecimal.ZERO), configured.durationValue());
        assertNull(absent.durationValue());
        assertEquals(absent, omitted);
        assertNull(mapper.readValue("null", SkillNumericValue.class));
        assertFalse(mapper.valueToTree(configured).path("durationValue").isNull());
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "{}", "[]", "1", "\"1\"", "true",
        "{\"kind\":null,\"value\":1}",
        "{\"kind\":1,\"value\":1}",
        "{\"kind\":\"UNKNOWN\",\"value\":1}",
        "{\"kind\":\"fixed\",\"value\":1}",
        "{\"kind\":\"FIXED\"}",
        "{\"kind\":\"FIXED\",\"value\":null}",
        "{\"kind\":\"FIXED\",\"value\":\"1.25\"}",
        "{\"kind\":\"FIXED\",\"value\":true}",
        "{\"kind\":\"FIXED\",\"value\":{}}",
        "{\"kind\":\"FIXED\",\"value\":1,\"parameterKey\":\"p\"}",
        "{\"kind\":\"FIXED\",\"value\":1,\"formulaKey\":null}",
        "{\"kind\":\"FIXED\",\"value\":1,\"unknown\":null}",
        "{\"kind\":\"PARAMETER\",\"parameterKey\":\"p\",\"value\":0}",
        "{\"kind\":\"PARAMETER\",\"parameterKey\":\"p\",\"formulaKey\":\"f\"}",
        "{\"kind\":\"PARAMETER\",\"parameterKey\":null}",
        "{\"kind\":\"PARAMETER\",\"parameterKey\":1}",
        "{\"kind\":\"PARAMETER\",\"parameterKey\":\"\"}",
        "{\"kind\":\"PARAMETER\",\"parameterKey\":\" p \"}",
        "{\"kind\":\"FORMULA\",\"formulaKey\":\"f\",\"parameterKey\":null}",
        "{\"kind\":\"FORMULA\",\"formulaKey\":\"f\",\"unexpected\":1}",
        "{\"kind\":\"FORMULA\",\"formulaKey\":\"UpperCase\"}",
        "{\"kind\":\"FORMULA\",\"formulaKey\":\"f\",\"valueFormulaKey\":\"old\"}"
    })
    void rejectsWrongShapesMixedSourcesUnknownFieldsAndNumberStrings(String json) {
        assertThrows(JsonProcessingException.class, () -> mapper.readValue(json, SkillNumericValue.class));
    }

    @Test
    void directConstructionPreservesTheSameBranchRules() {
        assertThrows(IllegalArgumentException.class, () -> SkillNumericValue.fixed(null));
        assertThrows(IllegalArgumentException.class, () -> SkillNumericValue.parameter(" p "));
        assertThrows(IllegalArgumentException.class, () -> SkillNumericValue.formula(""));
        assertThrows(IllegalArgumentException.class, () -> new SkillNumericValue(null, BigDecimal.ONE, null, null));
        assertThrows(IllegalArgumentException.class,
            () -> new SkillNumericValue(SkillNumericValue.Kind.FIXED, BigDecimal.ONE, "p", null));
        assertThrows(IllegalArgumentException.class,
            () -> new SkillNumericValue(SkillNumericValue.Kind.FORMULA, null, "p", "f"));
    }

    @ParameterizedTest
    @MethodSource("strictOuterRecords")
    void outerRecordsRejectLegacyAndUnknownFieldsEvenWhenMapperIgnoresUnknownFields(
        Class<?> type, String validJson, String oldField
    ) throws Exception {
        ObjectMapper relaxedMapper = new ObjectMapper().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        relaxedMapper.readValue(validJson, type);
        for (String field : List.of(oldField, "unexpected")) {
            String invalid = validJson.substring(0, validJson.length() - 1) + ",\"" + field + "\":null}";
            assertThrows(JsonProcessingException.class, () -> relaxedMapper.readValue(invalid, type), field);
        }
    }

    static Stream<Arguments> strictOuterRecords() {
        String value = "{\"kind\":\"FORMULA\",\"formulaKey\":\"f\"}";
        return Stream.of(
            Arguments.of(SkillEffectValueRuleRequest.class, "{\"value\":" + value + ",\"fixedMultiplier\":1}", "formulaKey"),
            Arguments.of(SkillEffectLifecycleRequest.class, "{\"durationValue\":" + value + "}", "durationFormulaKey"),
            Arguments.of(SkillEffectCriticalPolicy.class, "{\"mode\":\"DISALLOWED\",\"multiplierValue\":null}", "multiplierFormulaKey"),
            Arguments.of(SkillEffectVampOverride.class, "{\"efficiencyValue\":" + value + "}", "efficiencyFormulaKey"),
            Arguments.of(SkillProcessCooldown.class, "{\"durationValue\":" + value + "}", "durationFormulaKey"),
            Arguments.of(SkillProcessStateOperationRequest.class, "{\"value\":" + value + "}", "valueFormulaKey"),
            Arguments.of(SkillTriggerPerTargetCooldown.class, "{\"durationValue\":" + value + "}", "durationFormulaKey"),
            Arguments.of(SkillTriggerProcessLimit.class, "{\"limitValue\":" + value + "}", "limitFormulaKey")
        );
    }

    @Test
    void polymorphicDetailsPreserveLegacyFieldsForServiceRejection() throws Exception {
        SkillInternalStateCounterDetail detail = mapper.readValue(
            "{\"initialValue\":{\"kind\":\"FIXED\",\"value\":0},\"initialValueFormulaKey\":\"old\"}",
            SkillInternalStateCounterDetail.class);
        assertEquals(SkillNumericValue.fixed(BigDecimal.ZERO), detail.initialValue());
        assertEquals(Set.of("initialValueFormulaKey"), detail.unknownFields());
        assertEquals(Set.of(), detail.foreignFields());
    }
}
