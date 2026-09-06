package xyz.game.datamanage.service.character;

import static org.junit.jupiter.api.Assertions.*;

import java.io.InputStream;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.SqlCommandType;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.mapper.character.CharacterAuthoringCheckMapper;

class CharacterAuthoringCheckMapperTest {
    private static final String NAMESPACE = CharacterAuthoringCheckMapper.class.getName() + ".";
    private Configuration configuration;

    @BeforeEach
    void parseMapperWithoutDatabase() throws Exception {
        configuration = new Configuration();
        String resource = "mapper/character/CharacterAuthoringCheckMapper.xml";
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(input);
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
    }

    @Test
    void everyMethodHasOneReadStatementAndResultConstructorMatchesNullableRows() throws Exception {
        var expected = Arrays.stream(CharacterAuthoringCheckMapper.class.getDeclaredMethods())
            .map(method -> NAMESPACE + method.getName()).collect(Collectors.toSet());
        var actual = configuration.getMappedStatementNames().stream().filter(name -> name.startsWith(NAMESPACE)).collect(Collectors.toSet());
        assertEquals(expected, actual);
        for (String name : actual) {
            var statement = configuration.getMappedStatement(name);
            assertEquals(SqlCommandType.SELECT, statement.getSqlCommandType());
            String sql = sql(name.substring(NAMESPACE.length()));
            assertFalse(sql.matches("(?is).*\\b(INSERT|UPDATE|DELETE|FOR UPDATE|FOR SHARE)\\b.*"));
            var result = statement.getResultMaps().getFirst();
            var types = result.getConstructorResultMappings().stream().map(mapping -> mapping.getJavaType()).toArray(Class<?>[]::new);
            assertNotNull(result.getType().getConstructor(types));
        }
        var attached = configuration.getResultMap(NAMESPACE + "attachedSkill").getConstructorResultMappings();
        assertEquals(Integer.class, attached.get(3).getJavaType());
        assertEquals(String.class, attached.get(2).getJavaType());
    }

    @Test
    void attachedSkillsKeepMissingAndDisabledRowsInTheRequestedCharacterAndGame() {
        String sql = sql("listAttachedSkills");
        assertTrue(sql.contains("LEFT JOIN public.skills s ON s.game_id = r.game_id AND s.skill_key = r.skill_key"));
        assertTrue(sql.contains("WHERE r.game_id = ? AND r.character_key = ?"));
        assertFalse(sql.contains("s.status ="));
        assertTrue(sql.contains("s.skill_key IS NOT NULL"));
        assertTrue(sql.contains("ORDER BY r.sort_order, s.name NULLS LAST, r.skill_key"));
        for (String alias : Set.of("e", "p", "t")) {
            assertTrue(sql.contains(alias + ".game_id = r.game_id AND " + alias + ".skill_key = r.skill_key"));
        }
    }

    @Test
    void objectsReadActualJsonOnlyForDirectlyAttachedSkills() {
        String sql = sql("listObjects");
        assertTrue(sql.contains("WHERE game_id = ? AND character_key = ?"));
        assertEquals(5, sql.split("JOIN attached a USING \\(game_id, skill_key\\)", -1).length - 1);
        assertTrue(sql.contains("'effectBindings', o.effect_bindings"));
        assertTrue(sql.contains("'eventSource', o.event_source"));
        assertFalse(sql.contains("jsonb_build_object('results', COALESCE"));
        assertFalse(sql.contains("RECURSIVE"));
    }

    @Test
    void referencesAreSourceScopedAndCheckFullRootAndChildKeysWithoutFlatteningBadArrays() {
        String sql = sql("listReferences");
        assertTrue(sql.contains("WHERE game_id = ? AND character_key = ?"));
        assertTrue(sql.contains("a.game_id = r.game_id AND a.skill_key = r.source_skill_key"));
        for (String column : Set.of("parameter_key", "formula_key", "effect_key", "state_key", "process_key", "rule_key")) {
            assertTrue(sql.contains("t.game_id = r.game_id AND t.skill_key = r.target_skill_key AND t." + column + " = r.target_key"), column);
        }
        for (String child : Set.of("resultKey", "stepKey", "optionKey", "actionKey")) {
            assertTrue(sql.contains("child->>'" + child + "' = r.target_sub_key"), child);
        }
        assertTrue(sql.contains("t.state_type = 'MODE'"));
        assertTrue(sql.contains("jsonb_typeof(t.lifecycle) = 'object'"));
        assertEquals(4, sql.split("ELSE '\\[\\]'::jsonb END", -1).length - 1);
        assertTrue(sql.contains("r.target_skill_key = '' AND r.target_sub_key = ''"));
        assertTrue(sql.contains("THEN r.target_sub_key = '' AND CASE r.target_type"));
        assertFalse(sql.contains("RECURSIVE"));
    }

    private String sql(String statement) {
        return configuration.getMappedStatement(NAMESPACE + statement).getBoundSql(Map.of("gameId", "lol", "characterKey", "hero"))
            .getSql().replaceAll("\\s+", " ").trim();
    }
}
