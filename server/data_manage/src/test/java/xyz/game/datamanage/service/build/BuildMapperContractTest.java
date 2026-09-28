package xyz.game.datamanage.service.build;

import static org.junit.jupiter.api.Assertions.*;

import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.mapper.build.BuildSystemMapper;
import xyz.game.datamanage.mapper.skillrelation.BuildOptionSkillRelationMapper;

class BuildMapperContractTest {
    @Test
    void systemMapperStatementsMatchTheInterface() throws Exception {
        Configuration configuration = parse("mapper/build/BuildSystemMapper.xml");
        Map<String, Object> parameters = Map.ofEntries(
            Map.entry("gameId", "lol"), Map.entry("keyword", "符文"), Map.entry("systemKey", "runes"),
            Map.entry("name", "符文"), Map.entry("excludeKey", "runes"), Map.entry("description", "说明"),
            Map.entry("configurationMode", "SLOT_SELECTION"), Map.entry("sortOrder", 0),
            Map.entry("selectionRulesJson", "{}"), Map.entry("groupKey", "precision"), Map.entry("slotsJson", "[]"),
            Map.entry("optionKey", "focus"), Map.entry("maxRank", 1), Map.entry("rankCostsJson", "[0]"));
        assertMethods(configuration, BuildSystemMapper.class, parameters);
        String options = sql(configuration, BuildSystemMapper.class, "listOptions", parameters);
        assertTrue(options.contains("ORDER BY name ASC, option_key ASC"));
        String systems = sql(configuration, BuildSystemMapper.class, "listSystems", parameters);
        assertTrue(systems.contains("ORDER BY sort_order ASC, system_key ASC"));
        String insert = sql(configuration, BuildSystemMapper.class, "insertSystem", parameters);
        assertTrue(insert.contains("CAST(? AS jsonb)"));
    }

    @Test
    void skillRelationStatementsMatchTheInterface() throws Exception {
        Configuration configuration = parse("mapper/skillrelation/BuildOptionSkillRelationMapper.xml");
        Map<String, Object> parameters = Map.of(
            "gameId", "lol", "systemKey", "runes", "optionKey", "focus", "skillKey", "fire",
            "activationRank", 1, "skillLevelMode", "FIXED", "fixedSkillLevel", 1, "sortOrder", 0);
        assertMethods(configuration, BuildOptionSkillRelationMapper.class, parameters);
        String list = sql(configuration, BuildOptionSkillRelationMapper.class, "listRelations", parameters);
        assertTrue(list.contains("ORDER BY source.name ASC, r.option_key ASC, r.sort_order ASC, r.skill_key ASC"));
        String insert = sql(configuration, BuildOptionSkillRelationMapper.class, "insertRelation", parameters);
        assertTrue(insert.contains("ON CONFLICT (game_id, system_key, option_key, skill_key) DO NOTHING"));
    }

    private static void assertMethods(Configuration configuration, Class<?> type, Map<String, Object> parameters) {
        String namespace = type.getName() + ".";
        for (Method method : type.getDeclaredMethods()) {
            assertTrue(configuration.hasStatement(namespace + method.getName()), method.getName());
            var bound = configuration.getMappedStatement(namespace + method.getName()).getBoundSql(parameters);
            assertFalse(bound.getSql().isBlank(), method.getName());
            bound.getParameterMappings().forEach(mapping ->
                assertTrue(parameters.containsKey(mapping.getProperty()), mapping.getProperty()));
        }
    }

    private static String sql(Configuration configuration, Class<?> type, String id, Map<String, Object> parameters) {
        return configuration.getMappedStatement(type.getName() + "." + id).getBoundSql(parameters).getSql()
            .replaceAll("\\s+", " ");
    }

    private static Configuration parse(String resource) throws Exception {
        Configuration configuration = new Configuration();
        try (InputStream stream = BuildMapperContractTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(stream, resource);
            new XMLMapperBuilder(stream, configuration, resource, configuration.getSqlFragments()).parse();
        }
        return configuration;
    }
}
