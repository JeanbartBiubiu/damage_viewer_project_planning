package xyz.game.datamanage.mapper.skilleffect;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

/** 独立效果保存与统一保存共用输出可达读取，未使用声明仍仅用于授权和删除保护。 */
class SkillEffectFormulaReadContractTest {
    @Test
    void runtimeInputClassificationUsesOutputReachabilityAndDeclaredSkillOwnership() throws Exception {
        Configuration configuration = new Configuration();
        for (String resource : List.of("mapper/authoring/AuthoringReadModel.xml", "mapper/skilleffect/SkillEffectMapper.xml")) {
            try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
                assertNotNull(input);
                new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
            }
        }
        String sql = configuration.getMappedStatement(SkillEffectMapper.class.getName() + ".listRuntimeInputFormulaKeys")
            .getBoundSql(Map.of("gameId", "lol", "skillKey", "probe", "keys", List.of("output"))).getSql();
        assertTrue(sql.contains("WITH RECURSIVE"));
        assertTrue(sql.contains("s->>'key'=f.expression->>'outputStageKey'"));
        assertTrue(sql.contains("n.node->>'op'='read'"));
        assertTrue(sql.contains("n.node->'args'"));
        assertTrue(sql.contains("p.skill_key = n.parameter_skill_key"));
        assertFalse(sql.contains("jsonb_path_query"));
    }
}
