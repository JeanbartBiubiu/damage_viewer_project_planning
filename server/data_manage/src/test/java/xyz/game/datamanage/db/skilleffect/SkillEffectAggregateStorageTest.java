package xyz.game.datamanage.db.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;

/** 检查实际 MyBatis 映射与迁移边界；JSON 保存回读及业务拒绝行为见 SkillEffectServiceTest。 */
class SkillEffectAggregateStorageTest {
    private static final String RESOURCE = "mapper/skilleffect/SkillEffectMapper.xml";
    private static final String NAMESPACE = SkillEffectMapper.class.getName() + ".";

    @Test
    void buildsRootJsonWriteMappingsWithAllParametersAndNoUnmappedInterfaceMethods() throws Exception {
        Configuration configuration = new Configuration();
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(RESOURCE)) {
            new XMLMapperBuilder(input, configuration, RESOURCE, configuration.getSqlFragments()).parse();
        }
        Set<String> mapped = configuration.getMappedStatementNames().stream()
            .filter(name -> name.startsWith(NAMESPACE)).map(name -> name.substring(NAMESPACE.length()))
            .collect(Collectors.toSet());
        assertEquals(Arrays.stream(SkillEffectMapper.class.getDeclaredMethods()).map(method -> method.getName())
            .collect(Collectors.toSet()), mapped);

        Map<String, Object> parameters = new HashMap<>();
        parameters.put("gameId", "game");
        parameters.put("skillKey", "skill");
        parameters.put("effectKey", "effect");
        parameters.put("name", "效果");
        parameters.put("description", null);
        parameters.put("sortOrder", 0);
        parameters.put("results", "[]");
        parameters.put("lifecycle", null);
        for (String id : Set.of("insertEffect", "updateEffect")) {
            var bound = configuration.getMappedStatement(NAMESPACE + id).getBoundSql(parameters);
            assertEquals(parameters.keySet(), bound.getParameterMappings().stream()
                .map(parameter -> parameter.getProperty()).collect(Collectors.toSet()));
            assertTrue(bound.getSql().contains("public.skill_effects"));
            assertEquals(2, bound.getSql().split("AS jsonb", -1).length - 1);
        }
    }

    @Test
    void historicalMigrationCoversItsOriginalResultTypesWithoutRequiringNewAggregateOnlyTypes() throws Exception {
        Path root = Path.of("").toAbsolutePath();
        while (!Files.exists(root.resolve("db/game_manage/schema.sql"))) {
            root = root.getParent();
            if (root == null) throw new IllegalStateException("无法定位后端工作树");
        }
        String migration = Files.readString(root.resolve("db/game_manage/migrations/breaking/aggregate_parts/effects.sql"));
        for (SkillEffectResultType type : SkillEffectResultType.values()) {
            // 新增类型直接写聚合JSON，历史拆表迁移没有该种明细，也不补兼容分支。
            if (type == SkillEffectResultType.SHIELD_RECEIVED_MODIFIER
                || type == SkillEffectResultType.ATTACK_TIMER_RESET) continue;
            assertTrue(migration.contains("WHEN '" + type.name() + "' THEN"), type.name());
        }
        Set<String> sources = java.util.regex.Pattern.compile("FROM public\\.(skill_effect\\w+)")
            .matcher(migration).results().map(match -> match.group(1)).collect(Collectors.toSet());
        assertEquals(23, sources.size());
        assertTrue(sources.containsAll(Set.of("skill_effect_results", "skill_effect_result_values",
            "skill_effect_lifecycles", "skill_effect_result_lifecycle_behaviors", "skill_effect_result_vamp_rules",
            "skill_effect_result_skill_targets", "skill_effect_result_skill_category_targets")));
        String statements = migration.replaceAll("(?m)--.*$", "").toLowerCase();
        assertFalse(statements.contains("drop table"));
        assertFalse(statements.contains("begin;"));
        assertFalse(statements.contains("commit;"));
        assertFalse(statements.contains("float"));
        assertFalse(statements.contains("double"));
        assertTrue(statements.contains("order by r.sort_order, r.result_key"));
        assertTrue(statements.contains("'fixedmultiplier', d.fixed_multiplier"));
        assertTrue(statements.contains("'lifecyclebehavior'"));
        assertTrue(statements.contains("'spellshieldblockscope'"));
    }
}
