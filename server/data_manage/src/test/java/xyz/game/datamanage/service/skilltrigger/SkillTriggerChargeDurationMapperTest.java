package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;

import java.io.InputStream;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;

class SkillTriggerChargeDurationMapperTest {
    @Test
    void realChargeDeclarationReadIsNullableBooleanAndScopedToAllFourOwnerKeys() throws Exception {
        Configuration configuration = new Configuration();
        for (String resource : List.of("mapper/authoring/AuthoringReadModel.xml", "mapper/skilltrigger/SkillTriggerRuleMapper.xml")) {
            try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
                new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
            }
        }
        var statement = configuration.getMappedStatement(SkillTriggerRuleMapper.class.getName() + ".findChargeReleaseAtMaximum");
        var bound = statement.getBoundSql(Map.of("gameId", "lol", "skillKey", "charge_skill", "processKey", "cast", "stepKey", "charge"));
        assertEquals(Boolean.class, statement.getResultMaps().getFirst().getType());
        assertEquals(List.of("gameId", "skillKey", "processKey", "stepKey"), bound.getParameterMappings().stream().map(mapping -> mapping.getProperty()).toList());
        assertTrue(bound.getSql().contains("jsonb_typeof(step->'detail'->'releaseAtMaximum') = 'boolean'"));
        assertTrue(bound.getSql().contains("step->>'stepType' = 'CHARGE'"));
        assertFalse(bound.getSql().contains("COALESCE"));
    }
}
