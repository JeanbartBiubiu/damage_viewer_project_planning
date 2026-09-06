package xyz.game.datamanage.service.imagerelation;

import static org.junit.jupiter.api.Assertions.*;

import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;

class ImageRelationMapperContractTest {
    private static final String NAMESPACE = ImageRelationMapper.class.getName() + ".";
    private static Configuration configuration;

    @BeforeAll
    static void parseMapper() throws Exception {
        configuration = new Configuration();
        String resource = "mapper/imagerelation/ImageRelationMapper.xml";
        try (InputStream stream = ImageRelationMapperContractTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(stream);
            new XMLMapperBuilder(stream, configuration, resource, configuration.getSqlFragments()).parse();
        }
    }

    @Test
    void allJavaMethodsHaveParsableSqlAndBoundParameters() {
        Map<String, Object> parameters = parameters("SKILL_EFFECT");
        for (Method method : ImageRelationMapper.class.getDeclaredMethods()) {
            assertTrue(configuration.hasStatement(NAMESPACE + method.getName()), method.getName());
            var sql = configuration.getMappedStatement(NAMESPACE + method.getName()).getBoundSql(parameters);
            assertFalse(sql.getSql().isBlank());
            sql.getParameterMappings().forEach(parameter -> assertTrue(parameters.containsKey(parameter.getProperty()), parameter.getProperty()));
        }
    }

    @ParameterizedTest
    @CsvSource({"GAME,games", "CHARACTER,characters", "ATTRIBUTE,attributes", "EQUIPMENT,equipment",
        "SKILL,skills", "SKILL_EFFECT,skill_effects", "STATUS,statuses"})
    void fixedSourceSelectorKeepsKeysAsBoundValues(String type, String table) {
        String sql = configuration.getMappedStatement(NAMESPACE + "countSource").getBoundSql(parameters(type)).getSql();
        assertTrue(sql.contains("public." + table));
        assertTrue(sql.contains("game_id = ?"));
        assertFalse(sql.contains("object-key"));
        assertFalse(sql.contains("parent-key"));
    }

    @Test
    void unknownSourceCannotBecomeSqlOrARealTableRead() {
        String sql = configuration.getMappedStatement(NAMESPACE + "countSource")
            .getBoundSql(parameters("games; DELETE FROM public.images")).getSql().trim();
        assertEquals("SELECT 0", sql);
    }

    @Test
    void lightweightReadsExcludeImageContentAndUsageJoinPreservesMissingSources() {
        for (String id : new String[]{"findImage", "listOptions", "listUsages"}) {
            String sql = configuration.getMappedStatement(NAMESPACE + id).getBoundSql(parameters("GAME")).getSql();
            assertFalse(sql.contains("image_base64"), id);
        }
        String usages = configuration.getMappedStatement(NAMESPACE + "listUsages").getBoundSql(parameters("GAME")).getSql();
        assertTrue(usages.contains("LEFT JOIN public.skill_effects"));
        assertTrue(usages.contains("e.skill_key = r.source_parent_key"));
        String options = configuration.getMappedStatement(NAMESPACE + "listOptions").getBoundSql(parameters("GAME")).getSql();
        assertTrue(options.contains("enabled = TRUE"));
        assertTrue(options.contains("LIMIT 50"));
    }

    private static Map<String, Object> parameters(String type) {
        return Map.of("gameId", "lol", "sourceType", type, "sourceParentKey", "parent-key",
            "sourceKey", "object-key", "imageKey", "icon", "skillKey", "q", "keyword", "icon");
    }
}
