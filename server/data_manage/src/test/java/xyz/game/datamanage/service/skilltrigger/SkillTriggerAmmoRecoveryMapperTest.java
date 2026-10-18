package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;

import java.io.InputStream;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;

class SkillTriggerAmmoRecoveryMapperTest {
    @Test void stateDeclarationFilteringAndActionDeletionProtectionUseActualJsonbFields() throws Exception {
        Configuration configuration = new Configuration();
        for (String resource : List.of("mapper/authoring/AuthoringReadModel.xml", "mapper/skilltrigger/SkillTriggerRuleMapper.xml")) {
            try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
                new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
            }
        }
        var parameters = Map.of("gameId", "lol", "skillKey", "missile", "stateKey", "ammo");
        String values = configuration.getMappedStatement(SkillTriggerRuleMapper.class.getName() + ".listInternalStateValues").getBoundSql(parameters).getSql();
        assertEquals(2, values.split("detail->'initialValueBinding' IS NULL", -1).length - 1);
        assertTrue(values.contains("detail->'initialValueBinding' = 'null'::jsonb"));
        assertFalse(values.contains("initialRemainingValue"), "场景余时不能变成每发动态输入");
        String references = configuration.getMappedStatement(SkillTriggerRuleMapper.class.getName() + ".countInternalStateReferences").getBoundSql(parameters).getSql();
        assertTrue(references.contains("a->>'actionType' = 'MODIFY_INTERNAL_STATE'"));
        assertTrue(references.contains("a->'detail'->>'stateSkillKey' = ?"));
        assertTrue(references.contains("a->'detail'->>'stateKey' = ?"));
    }
}
