package xyz.game.datamanage.support.authoring;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

/** 同游戏配置在业务读取前串行写入，并在事务提交前校验最终引用。 */
@Component
public class GameConfigurationWriteGuard {
    private final JdbcTemplate jdbc;
    private final SkillNumericSemantics numericSemantics;
    private final GameVampRuleSemantics vampSemantics;
    private final HealingRatioMaxSemantics healingRatioMaxSemantics;

    public GameConfigurationWriteGuard(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.numericSemantics = new SkillNumericSemantics(jdbc);
        this.vampSemantics = new GameVampRuleSemantics(jdbc);
        this.healingRatioMaxSemantics = new HealingRatioMaxSemantics(jdbc);
    }

    public void begin(String gameId) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()
            || !TransactionSynchronizationManager.isSynchronizationActive()
            || TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            throw new IllegalStateException("游戏配置写入必须位于真实可写事务中");
        }
        Pending pending = (Pending) TransactionSynchronizationManager.getResource(this);
        if (pending != null && pending.games.contains(gameId)) return;
        // 等待游戏锁之后的查询必须能看到前一写事务已经提交的配置。
        String isolation = jdbc.queryForObject("SHOW transaction_isolation", String.class);
        if (!"read committed".equals(isolation)) {
            throw new IllegalStateException("游戏配置写入要求 READ COMMITTED 事务隔离级别");
        }
        List<String> locked = jdbc.queryForList(
            "SELECT game_id FROM public.games WHERE game_id = ? FOR UPDATE", String.class, gameId);
        if (locked.isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在",
                Map.of("gameId", gameId == null ? "" : gameId));
        }
        if (pending == null) {
            pending = new Pending();
            TransactionSynchronizationManager.bindResource(this, pending);
            TransactionSynchronizationManager.registerSynchronization(pending);
        }
        pending.games.add(gameId);
    }

    /** 保留各管理接口已有的删除错误码；提交前仍会根据最终配置再次检查。 */
    public void assertNotReferenced(String gameId, String targetType, String targetSkillKey, String targetKey,
                                    String errorCode, String message) {
        Pending pending = (Pending) TransactionSynchronizationManager.getResource(this);
        if (!TransactionSynchronizationManager.isActualTransactionActive()
            || TransactionSynchronizationManager.isCurrentTransactionReadOnly()
            || pending == null || !pending.games.contains(gameId)) {
            throw new IllegalStateException("引用删除检查前必须先锁定所属游戏");
        }
        TargetType.valueOf(targetType);
        List<Map<String, Object>> hits = jdbc.queryForList(REFERENCED_SQL,
            gameId, targetType, targetSkillKey, targetKey);
        if (!hits.isEmpty()) {
            List<Map<String, Object>> issues = hits.stream().map(hit -> Map.<String, Object>of(
                "field", hit.get("field_path"), "code", "OBJECT_IN_USE",
                "sourceSkillKey", hit.get("source_skill_key"), "sourceType", hit.get("source_type"),
                "sourceKey", hit.get("source_key"), "targetType", hit.get("target_type"),
                "targetSkillKey", hit.get("target_skill_key"), "targetKey", hit.get("target_key"),
                "targetSubKey", hit.get("target_sub_key")
            )).toList();
            throw new ApiException(HttpStatus.CONFLICT, errorCode, message, Map.of("fieldIssues", issues));
        }
    }

    private void validateAndReplace(String gameId) {
        Set<Target> catalog = new LinkedHashSet<>();
        for (Map<String, Object> row : jdbc.queryForList(CATALOG_SQL, gameId)) {
            catalog.add(new Target(TargetType.valueOf((String) row.get("target_type")),
                (String) row.get("skill_key"), (String) row.get("object_key"), ""));
        }
        List<Aggregate> aggregates = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(AGGREGATES_SQL, gameId)) {
            aggregates.add(new Aggregate(SourceType.valueOf((String) row.get("source_type")),
                (String) row.get("skill_key"), (String) row.get("source_key"),
                AggregateJson.tree((String) row.get("data"))));
        }
        List<Reference> references = SkillObjectReferences.extractAndValidate(gameId, aggregates, catalog);
        SkillLifecycleConditionSemantics.validate(aggregates);
        SkillTargetCategoryConditionSemantics.validate(aggregates);
        SkillExplicitTargetIsSourceConditionSemantics.validate(aggregates);
        SkillHitTargetIsEnemyConditionSemantics.validate(aggregates);
        SkillCastingPhaseSemantics.validate(aggregates);
        vampSemantics.validate(gameId, aggregates);
        healingRatioMaxSemantics.validate(gameId, aggregates);
        numericSemantics.validate(gameId, aggregates);
        jdbc.update("DELETE FROM public.skill_object_references WHERE game_id = ?", gameId);
        if (!references.isEmpty()) {
            List<Object[]> rows = references.stream().map(ref -> new Object[] {
                ref.gameId(), ref.sourceSkillKey(), ref.sourceType().name(), ref.sourceKey(), ref.fieldPath(),
                ref.target().type().name(), ref.target().skillKey(), ref.target().key(), ref.target().subKey()
            }).toList();
            jdbc.batchUpdate(INSERT_SQL, rows);
        }
    }

    private final class Pending implements TransactionSynchronization {
        private final Set<String> games = new LinkedHashSet<>();

        @Override public int getOrder() { return Ordered.LOWEST_PRECEDENCE; }

        @Override public void beforeCommit(boolean readOnly) {
            if (readOnly) throw new IllegalStateException("游戏配置写入不能提交为只读事务");
            for (String gameId : games) validateAndReplace(gameId);
        }

        @Override public void suspend() {
            TransactionSynchronizationManager.unbindResource(GameConfigurationWriteGuard.this);
        }

        @Override public void resume() {
            TransactionSynchronizationManager.bindResource(GameConfigurationWriteGuard.this, this);
        }

        @Override public void afterCompletion(int status) {
            if (TransactionSynchronizationManager.getResource(GameConfigurationWriteGuard.this) == this) {
                TransactionSynchronizationManager.unbindResource(GameConfigurationWriteGuard.this);
            }
        }
    }

    static final String CATALOG_SQL = """
        WITH selected_game AS (SELECT ?::varchar AS game_id)
        SELECT 'ATTRIBUTE'::text AS target_type, ''::text AS skill_key, attribute_key AS object_key
          FROM public.attributes JOIN selected_game USING (game_id)
        UNION ALL SELECT 'PARAMETER', skill_key, parameter_key
          FROM public.skill_parameters JOIN selected_game USING (game_id)
        UNION ALL SELECT 'SKILL', '', skill_key
          FROM public.skills JOIN selected_game USING (game_id)
        UNION ALL SELECT 'CATEGORY', '', skill_category_key
          FROM public.skill_categories JOIN selected_game USING (game_id)
        UNION ALL SELECT 'DAMAGE_TYPE', '', damage_type_key
          FROM public.damage_types JOIN selected_game USING (game_id)
        UNION ALL SELECT 'MODIFIER_ZONE', '', modifier_zone_key
          FROM public.modifier_zones JOIN selected_game USING (game_id)
        UNION ALL SELECT 'STATUS', '', status_key
          FROM public.statuses JOIN selected_game USING (game_id)
        """;

    static final String AGGREGATES_SQL = """
        WITH selected_game AS (SELECT ?::varchar AS game_id)
        SELECT 'FORMULA'::text AS source_type, skill_key, formula_key AS source_key,
               jsonb_build_object('expression', expression)::text AS data
          FROM public.skill_formulas JOIN selected_game USING (game_id)
        UNION ALL SELECT 'EFFECT', skill_key, effect_key,
               jsonb_build_object('results', results, 'lifecycle', lifecycle)::text
          FROM public.skill_effects JOIN selected_game USING (game_id)
        UNION ALL SELECT 'STATE', skill_key, state_key,
               jsonb_build_object('stateType', state_type, 'detail', detail)::text
          FROM public.skill_internal_states JOIN selected_game USING (game_id)
        UNION ALL SELECT 'PROCESS', skill_key, process_key,
               jsonb_build_object('activationType', activation_type, 'steps', steps, 'cooldown', cooldown,
                   'effectBindings', effect_bindings, 'stateOperations', state_operations)::text
          FROM public.skill_processes JOIN selected_game USING (game_id)
        UNION ALL SELECT 'TRIGGER', skill_key, rule_key,
               jsonb_build_object('eventSource', event_source, 'conditionGroups', condition_groups,
                   'actions', actions, 'limits', limits)::text
          FROM public.skill_trigger_rules JOIN selected_game USING (game_id)
        ORDER BY source_type, skill_key, source_key
        """;

    static final String INSERT_SQL = """
        INSERT INTO public.skill_object_references
            (game_id, source_skill_key, source_type, source_key, field_path,
             target_type, target_skill_key, target_key, target_sub_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """;

    static final String REFERENCED_SQL = """
        SELECT source_skill_key, source_type, source_key, field_path,
               target_type, target_skill_key, target_key, target_sub_key
          FROM public.skill_object_references
         WHERE game_id = ? AND target_type = ? AND target_skill_key = ? AND target_key = ?
         ORDER BY source_skill_key, source_type, source_key, field_path, target_sub_key
        """;
}
