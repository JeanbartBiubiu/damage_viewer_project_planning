package xyz.game.datamanage.mapper.skillformula;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

/** MyBatis 映射解析与整体表达式读写契约，不连接数据库。 */
class SkillFormulaMapperXmlParseContractTest {
    private static final String MAPPER_RESOURCE = "mapper/skillformula/SkillFormulaMapper.xml";
    private static final String NAMESPACE = SkillFormulaMapper.class.getName();

    @Test
    void everyInterfaceMethodHasOneStatementAndExpressionMapsAsText() throws Exception {
        Configuration configuration = parseMapper();
        for (Method method : SkillFormulaMapper.class.getDeclaredMethods()) {
            assertNotNull(configuration.getMappedStatement(NAMESPACE + "." + method.getName()));
        }
        assertFalse(configuration.hasStatement(NAMESPACE + ".listNodes"));
        assertFalse(configuration.hasStatement(NAMESPACE + ".batchInsertNodes"));
        assertEquals(String.class, configuration.getResultMap(NAMESPACE + ".formulaRow")
            .getConstructorResultMappings().stream()
            .filter(mapping -> "expression".equals(mapping.getColumn())).findFirst().orElseThrow().getJavaType());
    }

    @Test
    void writesOneJsonbExpressionAndReadsAllDeclaredAttributes() throws Exception {
        Configuration configuration = parseMapper();
        Map<String, Object> parameters = Map.of("gameId", "lol", "skillKey", "ez_q", "formulaKey", "damage",
            "name", "伤害", "sortOrder", 1, "expression", "{\"inputs\":[{\"key\":\"input_0\",\"binding\":{\"kind\":\"parameter\",\"skillKey\":\"skill\",\"parameterKey\":\"base_damage\"}}],\"stages\":[{\"key\":\"output\",\"name\":\"原技能公式输出\",\"expression\":{\"op\":\"read\",\"inputKey\":\"input_0\"}}],\"outputStageKey\":\"output\"}");
        for (String operation : new String[] {"insert", "update"}) {
            BoundSql sql = configuration.getMappedStatement(NAMESPACE + "." + operation).getBoundSql(parameters);
            assertTrue(sql.getSql().contains("CAST(? AS jsonb)"));
            assertEquals(1, sql.getParameterMappings().stream()
                .filter(mapping -> "expression".equals(mapping.getProperty())).count());
            assertFalse(sql.getSql().contains("skill_formula_nodes"));
        }
        String refsSql = configuration.getMappedStatement(NAMESPACE + ".listAttributeRefs")
            .getBoundSql(parameters).getSql();
        assertFalse(refsSql.contains("WITH RECURSIVE"));
        assertTrue(refsSql.contains("f.expression->'inputs'"));
        assertTrue(refsSql.contains("i->'binding'->>'kind'='attribute'"));
    }

    private static Configuration parseMapper() throws Exception {
        Configuration configuration = new Configuration();
        try (InputStream in = SkillFormulaMapperXmlParseContractTest.class.getClassLoader()
            .getResourceAsStream(MAPPER_RESOURCE)) {
            assertNotNull(in);
            XMLMapperBuilder builder = new XMLMapperBuilder(in, configuration, MAPPER_RESOURCE,
                configuration.getSqlFragments());
            assertDoesNotThrow(builder::parse);
        }
        return configuration;
    }
}