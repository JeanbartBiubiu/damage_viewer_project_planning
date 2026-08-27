package xyz.game.datamanage.mapper.skillformula;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.mapping.ParameterMapping;
import org.apache.ibatis.mapping.ResultMap;
import org.apache.ibatis.mapping.ResultMapping;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.type.ObjectTypeHandler;
import org.apache.ibatis.type.TypeHandler;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skillformula.SkillFormulaNodeRow;
import xyz.game.datamanage.model.skillformula.SkillFormulaNodeType;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperation;

/**
 * Ensures SkillFormulaMapper.xml parses under a real MyBatis Configuration.
 * Does not connect to a database.
 */
class SkillFormulaMapperXmlParseContractTest {

    private static final String MAPPER_RESOURCE = "mapper/skillformula/SkillFormulaMapper.xml";
    private static final String NAMESPACE = "xyz.game.datamanage.mapper.skillformula.SkillFormulaMapper";

    @Test
    void skillFormulaMapperXmlParsesWithUuidConstructorArgs() throws Exception {
        Configuration configuration = parseMapper();

        assertNotNull(configuration.getMappedStatement(NAMESPACE + ".listNodes"));
        assertNotNull(configuration.getMappedStatement(NAMESPACE + ".batchInsertNodes"));

        ResultMap nodeRow = configuration.getResultMap(NAMESPACE + ".nodeRow");
        assertNotNull(nodeRow);

        boolean nodeIdUsesObjectTypeHandler = false;
        boolean parentNodeIdUsesObjectTypeHandler = false;
        for (ResultMapping mapping : nodeRow.getConstructorResultMappings()) {
            if ("node_id".equals(mapping.getColumn())) {
                assertTrue(UUID.class.isAssignableFrom(mapping.getJavaType()));
                assertTrue(mapping.getTypeHandler() instanceof ObjectTypeHandler);
                nodeIdUsesObjectTypeHandler = true;
            }
            if ("parent_node_id".equals(mapping.getColumn())) {
                assertTrue(UUID.class.isAssignableFrom(mapping.getJavaType()));
                assertTrue(mapping.getTypeHandler() instanceof ObjectTypeHandler);
                parentNodeIdUsesObjectTypeHandler = true;
            }
        }
        assertTrue(nodeIdUsesObjectTypeHandler, "node_id must use ObjectTypeHandler");
        assertTrue(parentNodeIdUsesObjectTypeHandler, "parent_node_id must use ObjectTypeHandler");
    }

    @Test
    void batchInsertNodesBoundSqlMapsUuidParametersWithObjectTypeHandler() throws Exception {
        Configuration configuration = parseMapper();
        MappedStatement statement = configuration.getMappedStatement(NAMESPACE + ".batchInsertNodes");

        UUID rootId = UUID.fromString("11111111-1111-1111-1111-111111111111");
        UUID childId = UUID.fromString("22222222-2222-2222-2222-222222222222");

        SkillFormulaNodeRow root = new SkillFormulaNodeRow(
            "lol",
            "ez_q",
            "formula_a",
            rootId,
            null,
            (short) 0,
            SkillFormulaNodeType.OPERATION,
            SkillFormulaOperation.ADD,
            null,
            null,
            null,
            null
        );
        SkillFormulaNodeRow child = new SkillFormulaNodeRow(
            "lol",
            "ez_q",
            "formula_a",
            childId,
            rootId,
            (short) 0,
            SkillFormulaNodeType.PARAMETER,
            null,
            "base_damage",
            null,
            null,
            null
        );

        Map<String, Object> parameter = Map.of("nodes", List.of(root, child));
        BoundSql boundSql = assertDoesNotThrow(() -> statement.getBoundSql(parameter));

        int uuidParameterMappings = 0;
        for (ParameterMapping mapping : boundSql.getParameterMappings()) {
            String property = mapping.getProperty();
            if (property == null || !(property.endsWith("nodeId") || property.endsWith("parentNodeId"))) {
                continue;
            }
            TypeHandler<?> typeHandler = mapping.getTypeHandler();
            assertNotNull(typeHandler, "TypeHandler required for " + property);
            assertTrue(
                typeHandler instanceof ObjectTypeHandler,
                "ObjectTypeHandler required for " + property + ", got " + typeHandler.getClass().getName()
            );
            uuidParameterMappings++;
        }
        assertEquals(4, uuidParameterMappings, "root+child must each map nodeId and parentNodeId");
    }

    private static Configuration parseMapper() throws Exception {
        Configuration configuration = new Configuration();
        try (InputStream in = SkillFormulaMapperXmlParseContractTest.class
            .getClassLoader()
            .getResourceAsStream(MAPPER_RESOURCE)) {
            assertNotNull(in, "classpath resource missing: " + MAPPER_RESOURCE);
            XMLMapperBuilder builder = new XMLMapperBuilder(
                in,
                configuration,
                MAPPER_RESOURCE,
                configuration.getSqlFragments()
            );
            assertDoesNotThrow(builder::parse);
        }
        return configuration;
    }
}
