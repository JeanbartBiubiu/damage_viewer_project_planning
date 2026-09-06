package xyz.game.datamanage.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessCreateRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessDelayStepDetail;
import xyz.game.datamanage.support.authoring.AggregateJson;

class JsonNumericPrecisionTest {
    private static final String DECIMAL = "0.12345678901234567890123456789";
    private static final BigDecimal EXPECTED = new BigDecimal(DECIMAL);
    private final ObjectMapper httpMapper = httpMapper();

    @Test
    void effectParentRequestPreservesDecimalThroughPolymorphicTreeAndStorage() throws Exception {
        String json = """
            {"effectKey":"precision","name":"精度","sortOrder":0,"lifecycle":null,
             "results":[{"resultKey":"hit","name":"伤害","resultType":"DAMAGE",
              "target":"TARGET","sortOrder":0,"spellShieldBlockScope":null,
              "valueRule":{"value":{"kind":"FIXED","value":%s},"fixedMultiplier":1},
              "detail":{"damageTypeKey":"physical","deliveryKind":"SKILL","originKind":"DIRECT",
               "critical":{"mode":"DISALLOWED"},"vampRules":[]}}]}
            """.formatted(DECIMAL);
        SkillEffectCreateRequest request = httpMapper.readValue(json, SkillEffectCreateRequest.class);
        assertEquals(EXPECTED, request.results().getFirst().valueRule().value().value());
        String stored = AggregateJson.write(request.results());
        assertTrue(stored.contains(DECIMAL));
        assertEquals(EXPECTED, AggregateJson.tree(stored).get(0).path("valueRule").path("value").path("value").decimalValue());
        SkillEffectCreateRequest roundTrip = httpMapper.readValue(AggregateJson.write(request), SkillEffectCreateRequest.class);
        assertEquals(EXPECTED, roundTrip.results().getFirst().valueRule().value().value());
        assertTrue(httpMapper.writeValueAsString(roundTrip).contains(DECIMAL));
    }

    @Test
    void processParentRequestPreservesDecimalThroughPolymorphicTreeAndStorage() throws Exception {
        String json = """
            {"processKey":"precision","name":"精度","activationType":"ACTIVE","sortOrder":0,
             "steps":[{"stepKey":"wait","name":"延迟","stepType":"DELAY","sortOrder":0,
              "detail":{"delayValue":{"kind":"FIXED","value":%s}}}],
             "effectBindings":[],"stateOperations":[]}
            """.formatted(DECIMAL);
        SkillProcessCreateRequest request = httpMapper.readValue(json, SkillProcessCreateRequest.class);
        assertEquals(EXPECTED, assertInstanceOf(SkillProcessDelayStepDetail.class, request.steps().getFirst().detail()).delayValue().value());
        String stored = AggregateJson.write(request.steps());
        assertTrue(stored.contains(DECIMAL));
        assertEquals(EXPECTED, AggregateJson.tree(stored).get(0).path("detail").path("delayValue").path("value").decimalValue());
        SkillProcessCreateRequest roundTrip = httpMapper.readValue(AggregateJson.write(request), SkillProcessCreateRequest.class);
        assertEquals(EXPECTED, assertInstanceOf(SkillProcessDelayStepDetail.class, roundTrip.steps().getFirst().detail()).delayValue().value());
        assertTrue(httpMapper.writeValueAsString(roundTrip).contains(DECIMAL));
    }

    private static ObjectMapper httpMapper() {
        Jackson2ObjectMapperBuilder builder = Jackson2ObjectMapperBuilder.json();
        new JacksonConfig().jsonCustomizer().customize(builder);
        return builder.build();
    }
}
