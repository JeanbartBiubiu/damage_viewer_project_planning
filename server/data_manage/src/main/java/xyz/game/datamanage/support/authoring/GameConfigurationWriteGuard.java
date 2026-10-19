package xyz.game.datamanage.support.authoring;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
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
import xyz.game.datamanage.support.authoring.ConfigurationChangeScope.Snapshot;
import xyz.game.datamanage.support.authoring.ConfigurationChangeScope.Source;

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
        pending.before.put(gameId, snapshot(gameId));
        pending.beforeCalculations.put(gameId, GameCalculationRuleSemantics.read(jdbc, gameId));
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

    private void validateAndReplace(String gameId, Snapshot before, com.fasterxml.jackson.databind.JsonNode calculationBefore) {
        Snapshot after = snapshot(gameId);
        validateCalculationRules(gameId, before, after, calculationBefore);
        ConfigurationChangeScope.Changes changes = ConfigurationChangeScope.compare(before, after);
        List<Aggregate> sources = after.aggregates().stream()
            .filter(a -> changes.changed().contains(Source.of(a))).toList();
        List<Aggregate> affected = after.aggregates().stream()
            .filter(a -> changes.affected().contains(Source.of(a))).toList();
        validateDamageTypes(affected, after);
        List<Aggregate> skillAffected = affected.stream().filter(a -> a.type() != SourceType.DAMAGE_TYPE).toList();
        List<Aggregate> skillContext = after.aggregates().stream().filter(a -> a.type() != SourceType.DAMAGE_TYPE).toList();
        Set<Target> catalog = new LinkedHashSet<>();
        for (Map<String, Object> row : jdbc.queryForList(CATALOG_SQL, gameId)) {
            catalog.add(new Target(TargetType.valueOf((String) row.get("target_type")),
                (String) row.get("skill_key"), (String) row.get("object_key"), ""));
        }
        List<Reference> references = SkillObjectReferences.extractAndValidate(gameId, sources, after.aggregates(), catalog);
        SkillObjectReferences.validateExistingTargets(changes.existingToCheck(), after.aggregates(), catalog);
        validateSkillFormulas(affected, sources, after, catalog);
        validateDamageTypeConsumers(affected, changes.changed(), references, after);
        SkillLifecycleConditionSemantics.validate(skillAffected, skillContext);
        SkillQualifiedReferenceSemantics.validate(skillAffected, skillContext);
        ShieldEndLifecycleSemantics.validate(skillAffected);
        SkillTargetCategoryConditionSemantics.validate(skillAffected);
        SkillExplicitTargetIsSourceConditionSemantics.validate(skillAffected);
        SkillHitTargetIsEnemyConditionSemantics.validate(skillAffected);
        SkillCastingPhaseSemantics.validate(skillAffected, skillContext);
        SkillAttackDamageRoleSemantics.validate(skillAffected, skillContext);
        Set<String> changedSkills = changes.changed().stream().filter(s -> s.type() != SourceType.DAMAGE_TYPE)
            .map(Source::skill).collect(java.util.stream.Collectors.toSet());
        SkillChargeDurationSemantics.validate(skillContext.stream().filter(aggregate -> changedSkills.contains(aggregate.skillKey())).toList(),
            skillContext);
        SkillTriggerOncePerUseSemantics.validate(skillAffected);
        if (!skillAffected.isEmpty() || changes.vampRulesChanged())
            vampSemantics.validate(gameId, skillAffected, skillContext, changes.vampRulesChanged());
        if (!skillAffected.isEmpty()) {
            Map<String, SkillSceneAttributeSnapshotSemantics.Attribute> sceneAttributes = new LinkedHashMap<>();
            after.rows().forEach((id, row) -> {
                if (id.type().equals("ATTRIBUTE")) sceneAttributes.put(id.key(), new SkillSceneAttributeSnapshotSemantics.Attribute(
                    row.path("status").textValue(), row.path("value_type").textValue()));
            });
            SkillSceneAttributeSnapshotSemantics.validateAttributes(skillAffected, sceneAttributes);
            healingRatioMaxSemantics.validate(gameId, skillAffected);
            numericSemantics.validate(gameId, skillAffected, skillContext);
        }
        for (Source source : changes.changed()) {
            jdbc.update(DELETE_SOURCE_SQL, gameId, source.skill(), source.type().name(), source.key());
        }
        if (!references.isEmpty()) {
            List<Object[]> rows = references.stream().map(ref -> new Object[] {
                ref.gameId(), ref.sourceSkillKey(), ref.sourceType().name(), ref.sourceKey(), ref.fieldPath(),
                ref.target().type().name(), ref.target().skillKey(), ref.target().key(), ref.target().subKey()
            }).toList();
            jdbc.batchUpdate(INSERT_SQL, rows);
        }
    }

    /** 一次性受保护转换在提交前读回索引；仍复用正常提交守卫，不能绕过游戏锁或事务。 */
    public void validatePending() {
        Pending pending = (Pending) TransactionSynchronizationManager.getResource(this);
        if (!TransactionSynchronizationManager.isActualTransactionActive()
            || TransactionSynchronizationManager.isCurrentTransactionReadOnly() || pending == null) {
            throw new IllegalStateException("最终配置校验必须位于已锁游戏的可写事务中");
        }
        for (String game : pending.games) validateAndReplace(game, pending.before.get(game), pending.beforeCalculations.get(game));
    }

    private void validateCalculationRules(String gameId, Snapshot before, Snapshot after,
                                         com.fasterxml.jackson.databind.JsonNode calculationBefore) {
        var calculationAfter = GameCalculationRuleSemantics.read(jdbc, gameId);
        if (calculationAfter == null) return;
        boolean changed = !java.util.Objects.equals(calculationBefore, calculationAfter);
        for (String dependency : GameCalculationRuleSemantics.dependencies(calculationAfter).keySet()) {
            var id = new ConfigurationChangeScope.Row("ATTRIBUTE", "", dependency);
            changed |= !java.util.Objects.equals(before.rows().get(id), after.rows().get(id));
        }
        for (String dependency : GameCalculationRuleSemantics.categoryDependencies(calculationAfter).keySet()) {
            var id = new ConfigurationChangeScope.Row("CATEGORY", "", dependency);
            changed |= !java.util.Objects.equals(before.rows().get(id), after.rows().get(id));
        }
        if (!changed) return;
        Map<String, GameCalculationRuleSemantics.Attribute> attributes = new LinkedHashMap<>();
        Map<String, GameCalculationRuleSemantics.Category> categories = new LinkedHashMap<>();
        after.rows().forEach((id, row) -> {
            if (id.type().equals("ATTRIBUTE")) attributes.put(id.key(), new GameCalculationRuleSemantics.Attribute(
                row.path("value_type").textValue(), row.path("status").textValue()));
            if (id.type().equals("CATEGORY")) categories.put(id.key(), new GameCalculationRuleSemantics.Category(row.path("status").textValue()));
        });
        var issue = GameCalculationRuleSemantics.validate(calculationAfter, attributes, categories);
        if (issue != null) throw new ApiException(HttpStatus.CONFLICT, "409.GAME_CALCULATION_RULES_INVALID",
            "最终目录与游戏计算配置不一致", Map.of("fieldIssues", List.of(issue.details())));
    }

    private static void validateDamageTypes(List<Aggregate> affected, Snapshot after) {
        Set<String> enabled = after.rows().entrySet().stream()
            .filter(entry -> entry.getKey().type().equals("ATTRIBUTE")
                && "ENABLED".equals(entry.getValue().path("status").asText()))
            .map(entry -> entry.getKey().key()).collect(java.util.stream.Collectors.toSet());
        for (Aggregate source : affected) {
            if (source.type() != SourceType.DAMAGE_TYPE || !"ENABLED".equals(source.data().path("status").asText())) continue;
            var formula = source.data().get("formula");
            if (formula == null || formula.isNull()) continue;
            var issue = xyz.game.datamanage.support.formula.FormulaContractValidator.validate(formula,
                xyz.game.datamanage.support.formula.DamageTypeFormulaBindings.allowed(enabled));
            if (issue != null) throw new ApiException(HttpStatus.CONFLICT, "409.DAMAGE_TYPE_FORMULA_INVALID",
                "启用伤害类型的共同公式或属性依赖不合法", Map.of("fieldIssues", List.of(Map.of(
                    "field", issue.path(), "code", issue.code(), "sourceType", "DAMAGE_TYPE",
                    "sourceSkillKey", "", "sourceKey", source.key()))));
        }
    }

    private static void validateSkillFormulas(List<Aggregate> affected, List<Aggregate> changed, Snapshot after, Set<Target> catalog) {
        Set<String> enabled = new LinkedHashSet<>(), enabledSkills = new LinkedHashSet<>();
        Map<String, Set<String>> parameters = new LinkedHashMap<>();
        after.rows().forEach((id, row) -> {
            if (id.type().equals("ATTRIBUTE") && "ENABLED".equals(row.path("status").asText())) enabled.add(id.key());
            if (id.type().equals("SKILL") && "ENABLED".equals(row.path("status").asText())) enabledSkills.add(id.key());

        });
        for (Target target : catalog) if (target.type() == TargetType.PARAMETER) parameters.computeIfAbsent(target.skillKey(), ignored -> new LinkedHashSet<>()).add(target.key());
        Set<Source> changedSources = changed.stream().map(Source::of).collect(java.util.stream.Collectors.toSet());
        for (Aggregate source : affected) {
            if (source.type() != SourceType.FORMULA) continue;
            if (!enabledSkills.contains(source.skillKey()) && !changedSources.contains(Source.of(source))) continue;
            var issue = xyz.game.datamanage.support.formula.FormulaContractValidator.validate(source.data().path("expression"),
                xyz.game.datamanage.support.formula.SkillFormulaBindings.allowed(source.skillKey(), enabled,
                    parameters.getOrDefault(source.skillKey(), Set.of())));
            if (issue != null) throw new ApiException(HttpStatus.CONFLICT, "409.SKILL_FORMULA_INVALID",
                "技能共同公式或启用属性及最终参数依赖不合法", Map.of("fieldIssues", List.of(Map.of(
                    "field", "/expression" + issue.path(), "code", issue.code(), "sourceType", "FORMULA",
                    "sourceSkillKey", source.skillKey(), "sourceKey", source.key()))));
        }
    }
    private static void validateDamageTypeConsumers(List<Aggregate> affected, Set<Source> changedSources,
                                                    List<Reference> changedReferences, Snapshot after) {
        Map<String, String> typeStatus = new LinkedHashMap<>();
        Set<String> enabledSkills = new LinkedHashSet<>();
        after.rows().forEach((id, value) -> {
            if (id.type().equals("DAMAGE_TYPE")) typeStatus.put(id.key(), value.path("status").asText());
            if (id.type().equals("SKILL") && "ENABLED".equals(value.path("status").asText())) enabledSkills.add(id.key());
        });
        Set<Source> affectedSources = affected.stream().map(Source::of).collect(java.util.stream.Collectors.toSet());
        // 改写来源已严格提取；未改写来源沿现有索引核对真实伤害类型，避免重新施加无关结构约束。
        List<Reference> consumerReferences = new ArrayList<>(changedReferences);
        consumerReferences.addAll(after.references().stream()
            .filter(reference -> !changedSources.contains(Source.of(reference))).toList());
        for (Reference reference : consumerReferences) {
            if (!affectedSources.contains(Source.of(reference)) || !enabledSkills.contains(reference.sourceSkillKey())) continue;
            if (reference.target().type() == TargetType.DAMAGE_TYPE
                && !"ENABLED".equals(typeStatus.get(reference.target().key()))) {
                throw new ApiException(HttpStatus.CONFLICT, "409.DAMAGE_TYPE_IN_USE", "启用技能依赖的伤害类型不能停用或删除",
                    Map.of("fieldIssues", List.of(Map.of("field", reference.fieldPath(), "code", "REFERENCE_DISABLED",
                        "sourceType", reference.sourceType().name(), "sourceSkillKey", reference.sourceSkillKey(),
                        "sourceKey", reference.sourceKey(), "targetKey", reference.target().key()))));
            }
        }
    }

    private Snapshot snapshot(String gameId) {
        List<Aggregate> aggregates = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(AGGREGATES_SQL, gameId)) {
            aggregates.add(new Aggregate(SourceType.valueOf((String) row.get("source_type")),
                (String) row.get("skill_key"), (String) row.get("source_key"),
                AggregateJson.tree((String) row.get("data"))));
        }
        List<Reference> references = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(REFERENCES_SQL, gameId)) {
            references.add(new Reference(gameId, (String) row.get("source_skill_key"),
                SourceType.valueOf((String) row.get("source_type")), (String) row.get("source_key"),
                (String) row.get("field_path"), new Target(TargetType.valueOf((String) row.get("target_type")),
                    (String) row.get("target_skill_key"), (String) row.get("target_key"), (String) row.get("target_sub_key"))));
        }
        return new Snapshot(ConfigurationChangeScope.rows(jdbc.queryForList(SNAPSHOT_SQL, gameId)),
            List.copyOf(aggregates), List.copyOf(references));
    }

    private final class Pending implements TransactionSynchronization {
        private final Set<String> games = new LinkedHashSet<>();
        private final Map<String, Snapshot> before = new LinkedHashMap<>();
        private final Map<String, com.fasterxml.jackson.databind.JsonNode> beforeCalculations = new LinkedHashMap<>();

        @Override public int getOrder() { return Ordered.LOWEST_PRECEDENCE; }

        @Override public void beforeCommit(boolean readOnly) {
            if (readOnly) throw new IllegalStateException("游戏配置写入不能提交为只读事务");
            for (String gameId : games) validateAndReplace(gameId, before.get(gameId), beforeCalculations.get(gameId));
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
               jsonb_build_object('stateType', state_type, 'scope', scope, 'detail', detail)::text
          FROM public.skill_internal_states JOIN selected_game USING (game_id)
        UNION ALL SELECT 'PROCESS', skill_key, process_key,
               jsonb_build_object('activationType', activation_type, 'steps', steps, 'cooldown', cooldown,
                   'effectBindings', effect_bindings, 'stateOperations', state_operations)::text
          FROM public.skill_processes JOIN selected_game USING (game_id)
        UNION ALL SELECT 'TRIGGER', skill_key, rule_key,
               jsonb_build_object('eventSource', event_source, 'conditionGroups', condition_groups,
                   'actions', actions, 'limits', limits)::text
          FROM public.skill_trigger_rules JOIN selected_game USING (game_id)
        UNION ALL SELECT 'DAMAGE_TYPE', '', damage_type_key,
               jsonb_build_object('formula', calculation_formula, 'status', status)::text
          FROM public.damage_types JOIN selected_game USING (game_id)
        ORDER BY source_type, skill_key, source_key
        """;

    static final String INSERT_SQL = """
        INSERT INTO public.skill_object_references
            (game_id, source_skill_key, source_type, source_key, field_path,
             target_type, target_skill_key, target_key, target_sub_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """;

    static final String DELETE_SOURCE_SQL = """
        DELETE FROM public.skill_object_references
         WHERE game_id = ? AND source_skill_key = ? AND source_type = ? AND source_key = ?
        """;

    static final String REFERENCES_SQL = """
        SELECT source_skill_key, source_type, source_key, field_path,
               target_type, target_skill_key, target_key, target_sub_key
          FROM public.skill_object_references WHERE game_id = ?
        """;

    // 只读比较用快照；时间戳不参与业务变化判断，不向日志或客户端输出。
    static final String SNAPSHOT_SQL = """
        WITH selected_game AS (SELECT ?::varchar AS game_id)
        SELECT 'FORMULA'::text AS object_type, skill_key, formula_key AS object_key,
               (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text AS data
          FROM public.skill_formulas t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'EFFECT', skill_key, effect_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.skill_effects t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'STATE', skill_key, state_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.skill_internal_states t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'PROCESS', skill_key, process_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.skill_processes t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'TRIGGER', skill_key, rule_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.skill_trigger_rules t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'PARAMETER', skill_key, parameter_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.skill_parameters t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'SKILL', '', skill_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.skills t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'ATTRIBUTE', '', attribute_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.attributes t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'CATEGORY', '', skill_category_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.skill_categories t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'DAMAGE_TYPE', '', damage_type_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.damage_types t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'MODIFIER_ZONE', '', modifier_zone_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.modifier_zones t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'STATUS', '', status_key, (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.statuses t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'SKILL_CATEGORIES', skill_key, '', jsonb_agg(skill_category_key ORDER BY skill_category_key)::text
          FROM public.skill_category_relations t JOIN selected_game USING (game_id) GROUP BY skill_key
        UNION ALL SELECT 'VAMP_RULE', '', vamp_type, to_jsonb(t)::text
          FROM public.game_vamp_rules t JOIN selected_game USING (game_id)
        UNION ALL SELECT 'LEVEL_CONFIG', '', '', (to_jsonb(t) - ARRAY['created_at', 'updated_at'])::text
          FROM public.game_level_configs t JOIN selected_game USING (game_id)
        """;

    static final String REFERENCED_SQL = """
        SELECT source_skill_key, source_type, source_key, field_path,
               target_type, target_skill_key, target_key, target_sub_key
          FROM public.skill_object_references
         WHERE game_id = ? AND target_type = ? AND target_skill_key = ? AND target_key = ?
         ORDER BY source_skill_key, source_type, source_key, field_path, target_sub_key
        """;
}
