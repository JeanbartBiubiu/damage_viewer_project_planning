package xyz.game.datamanage.service.rune;

import static org.junit.jupiter.api.Assertions.*;
import java.io.InputStream;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.mapper.rune.RuneMapper;
import xyz.game.datamanage.mapper.skillrelation.RuneRelationMapper;

class RuneMapperTest {
    @Test
    void allStatementsMatchJavaMethodsAndBindKnownParameters() throws Exception {
        for (Class<?> mapper : new Class<?>[]{RuneMapper.class, RuneRelationMapper.class}) {
            Configuration config = parse(mapper);
            String prefix = mapper.getName() + ".";
            assertEquals(Arrays.stream(mapper.getDeclaredMethods()).map(m -> prefix + m.getName()).collect(Collectors.toSet()),
                config.getMappedStatementNames().stream().filter(id -> id.startsWith(prefix)).collect(Collectors.toSet()));
            for (var method : mapper.getDeclaredMethods()) {
                var bound = config.getMappedStatement(prefix + method.getName()).getBoundSql(parameters());
                assertFalse(bound.getSql().isBlank());
                bound.getParameterMappings().forEach(p -> assertTrue(parameters().containsKey(p.getProperty()), p.getProperty()));
            }
        }
    }

    @Test
    void catalogQueriesKeepGameBoundaryStableOrderingAndWholeJsonArray() throws Exception {
        Configuration config = parse(RuneMapper.class);
        var args = parameters();
        String list = sql(config, RuneMapper.class, "listRunes", args);
        assertTrue(list.contains("WHERE game_id = ?"));
        assertTrue(list.contains("AND category = ?"));
        assertTrue(list.contains("ORDER BY name ASC, rune_key ASC"));
        String paths = sql(config, RuneMapper.class, "listPaths", args);
        assertTrue(paths.contains("slots::text AS slots_json"));
        assertTrue(paths.contains("ORDER BY sort_order ASC, path_key ASC"));
        assertFalse(paths.contains("jsonb_array_elements"));
        String update = sql(config, RuneMapper.class, "updatePath", args);
        assertTrue(update.contains("slots = CAST(? AS jsonb)"));
        assertTrue(update.contains("WHERE game_id = ? AND path_key = ?"));
        assertFalse(update.contains("jsonb_set"));
        String delete = sql(config, RuneMapper.class, "deletePath", args);
        assertEquals("DELETE FROM public.rune_paths WHERE game_id = ? AND path_key = ?", delete);
    }

    @Test
    void relationQueriesJoinBothSubjectsWithinGameAndKeepDisabledSkillsVisible() throws Exception {
        Configuration config = parse(RuneRelationMapper.class);
        var args = parameters();
        String forward = sql(config, RuneRelationMapper.class, "listRuneRelations", args);
        assertTrue(forward.contains("FROM public.rune_skill_relations r JOIN public.runes source"));
        assertTrue(forward.contains("source.game_id = r.game_id AND source.rune_key = r.rune_key"));
        assertTrue(forward.contains("s.game_id = r.game_id AND s.skill_key = r.skill_key"));
        assertTrue(forward.contains("r.game_id = ? AND r.rune_key = ? AND r.skill_key = ?"));
        assertTrue(forward.contains("ORDER BY r.sort_order ASC, s.name ASC, r.skill_key ASC"));
        args.put("runeKey", null);
        String reverse = sql(config, RuneRelationMapper.class, "listRuneRelations", args);
        assertTrue(reverse.contains("ORDER BY source.name ASC, r.rune_key ASC"));
        assertFalse(reverse.contains("s.status ="));
        assertTrue(sql(config, RuneRelationMapper.class, "insertRuneRelation", parameters())
            .contains("ON CONFLICT (game_id, rune_key, skill_key) DO NOTHING"));
    }

    private Configuration parse(Class<?> mapper) throws Exception {
        Configuration config = new Configuration();
        String resource = "mapper/" + (mapper == RuneMapper.class ? "rune/" : "skillrelation/") + mapper.getSimpleName() + ".xml";
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(input);
            new XMLMapperBuilder(input, config, resource, config.getSqlFragments()).parse();
        }
        return config;
    }

    private static Map<String, Object> parameters() {
        Map<String, Object> args = new HashMap<>();
        for (String key : new String[]{"gameId", "keyword", "category", "runeKey", "pathKey", "name", "description",
            "kind", "slotsJson", "excludeKey", "skillKey"}) {
            args.put(key, "safe_value");
        }
        args.put("sortOrder", 0);
        return args;
    }

    private static String sql(Configuration config, Class<?> mapper, String id, Map<String, Object> args) {
        return config.getMappedStatement(mapper.getName() + "." + id).getBoundSql(args).getSql().replaceAll("\\s+", " ").trim();
    }
}
