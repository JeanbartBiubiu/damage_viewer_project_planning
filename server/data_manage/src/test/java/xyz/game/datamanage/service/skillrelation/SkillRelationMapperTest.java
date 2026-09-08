package xyz.game.datamanage.service.skillrelation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.mapper.skillrelation.SkillRelationMapper;

class SkillRelationMapperTest {

    private static final String NAMESPACE = SkillRelationMapper.class.getName() + ".";
    private Configuration configuration;

    @BeforeEach
    void parseMapperWithoutDatabase() throws Exception {
        configuration = new Configuration();
        String resource = "mapper/skillrelation/SkillRelationMapper.xml";
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
    }

    @Test
    void everyMapperMethodMatchesOneXmlStatement() {
        var expected = Arrays.stream(SkillRelationMapper.class.getDeclaredMethods())
            .map(method -> NAMESPACE + method.getName()).collect(Collectors.toSet());
        var actual = configuration.getMappedStatementNames().stream()
            .filter(name -> name.startsWith(NAMESPACE)).collect(Collectors.toSet());
        assertEquals(expected, actual);
    }

    @ParameterizedTest
    @ValueSource(strings = {"Character", "Equipment"})
    void listUsesSameGameBothFiltersAndSourceSortPriority(String type) {
        String source = type.toLowerCase();
        Map<String, Object> filters = new HashMap<>();
        filters.put("gameId", "lol");
        filters.put(source + "Key", "source");
        filters.put("skillKey", "fire");
        String sql = sql("list" + type + "Relations", filters);
        assertTrue(sql.contains("source.game_id = r.game_id"));
        assertTrue(sql.contains("s.game_id = r.game_id"));
        assertTrue(sql.contains("r.game_id = ?"));
        assertTrue(sql.contains("AND r." + source + "_key = ?"));
        assertTrue(sql.contains("AND r.skill_key = ?"));
        assertTrue(sql.contains("ORDER BY r.sort_order ASC, s.name ASC, r.skill_key ASC"));

        filters.put(source + "Key", null);
        String reverse = sql("list" + type + "Relations", filters);
        assertFalse(reverse.contains("AND r." + source + "_key = ?"));
        assertTrue(reverse.contains("ORDER BY source.name ASC, r." + source + "_key ASC"));
        assertFalse(reverse.contains("s.status ="));
    }

    @ParameterizedTest
    @ValueSource(strings = {"Character", "Equipment"})
    void writesOnlyRelationRowsAndHandlesDuplicateAtDatabase(String type) {
        String source = type.toLowerCase();
        Map<String, Object> parameters = Map.of("gameId", "lol", source + "Key", "source", "skillKey", "fire", "sortOrder", 0);
        assertTrue(sql("insert" + type + "Relation", parameters)
            .contains("ON CONFLICT (game_id, " + source + "_key, skill_key) DO NOTHING"));
        assertTrue(sql("update" + type + "Relation", parameters)
            .contains("UPDATE public." + source + "_skill_relations SET sort_order = ?"));
        assertTrue(sql("delete" + type + "Relation", parameters)
            .contains("DELETE FROM public." + source + "_skill_relations"));
    }

    @Test
    void skillDeleteGuardCountsAllSourceTablesInSameGame() {
        String sql = sql("countBySkill", Map.of("gameId", "lol", "skillKey", "fire"));
        assertTrue(sql.contains("FROM public.character_skill_relations WHERE game_id = ? AND skill_key = ?"));
        assertTrue(sql.contains("FROM public.equipment_skill_relations WHERE game_id = ? AND skill_key = ?"));
        assertTrue(sql.contains("FROM public.rune_skill_relations WHERE game_id = ? AND skill_key = ?"));
    }

    private String sql(String statement, Map<String, Object> parameters) {
        return configuration.getMappedStatement(NAMESPACE + statement).getBoundSql(parameters)
            .getSql().replaceAll("\\s+", " ").trim();
    }
}
