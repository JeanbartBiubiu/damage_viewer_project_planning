package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;

/** 游戏锁内比较实际变更；只读上下文不等于需要重新校验或重写的对象。 */
final class ConfigurationChangeScope {
    record Row(String type, String skill, String key) {}
    record Source(SourceType type, String skill, String key) {
        static Source of(Aggregate value) { return new Source(value.type(), value.skillKey(), value.key()); }
        static Source of(Reference value) { return new Source(value.sourceType(), value.sourceSkillKey(), value.sourceKey()); }
    }
    record Snapshot(Map<Row, JsonNode> rows, List<Aggregate> aggregates, List<Reference> references) {}
    record Changes(Set<Source> changed, Set<Source> affected, List<Reference> existingToCheck, boolean vampRulesChanged) {}

    private ConfigurationChangeScope() {}

    static Changes compare(Snapshot before, Snapshot after) {
        Set<Source> changed = new LinkedHashSet<>();
        Set<Target> changedTargets = new LinkedHashSet<>();
        Set<String> changedSkillCategories = new LinkedHashSet<>();
        Set<String> changedSkillStatus = new LinkedHashSet<>();
        boolean globalVampChanged = false;
        Set<Row> rows = new LinkedHashSet<>(before.rows().keySet());
        rows.addAll(after.rows().keySet());
        for (Row row : rows) {
            if (Objects.equals(before.rows().get(row), after.rows().get(row))) continue;
            Source source = source(row);
            if (source != null) changed.add(source);
            else if (row.type().equals("SKILL_CATEGORIES")) changedSkillCategories.add(row.skill());
            else if (row.type().equals("VAMP_RULE")) globalVampChanged = true;
            else {
                if (row.type().equals("SKILL") && !Objects.equals(
                    before.rows().get(row) == null ? null : before.rows().get(row).get("status"),
                    after.rows().get(row) == null ? null : after.rows().get(row).get("status"))) changedSkillStatus.add(row.key());
                try { changedTargets.add(new Target(TargetType.valueOf(row.type()), row.skill(), row.key(), "")); }
                catch (IllegalArgumentException ignored) { /* 等级配置的实际参数改动另外比较。 */ }
                if (vampDependency(row, before.rows()) || vampDependency(row, after.rows())) globalVampChanged = true;
            }
        }
        Set<Source> affected = new LinkedHashSet<>(changed);
        for (Aggregate aggregate : after.aggregates()) {
            if (changedSkillStatus.contains(aggregate.skillKey())) affected.add(Source.of(aggregate));
            if (aggregate.type() == SourceType.EFFECT
                && (globalVampChanged || changedSkillCategories.contains(aggregate.skillKey()))
                && hasDamage(aggregate)) affected.add(Source.of(aggregate));
        }
        // 同次使用组不是外键引用；组内规则要一起检查范围一致性。
        Set<String> changedGroups = new LinkedHashSet<>();
        for (Aggregate aggregate : concat(before.aggregates(), after.aggregates())) {
            if (changed.contains(Source.of(aggregate))) {
                String group = group(aggregate);
                if (group != null) changedGroups.add(group);
            }
        }
        for (Aggregate aggregate : after.aggregates()) {
            if (changedGroups.contains(group(aggregate))) affected.add(Source.of(aggregate));
        }
        // 参数 -> 公式 -> 效果 -> 规则等反向依赖必须传递闭包。
        boolean expanded;
        do {
            expanded = false;
            for (Reference ref : before.references()) {
                if (changedTargets.contains(rootTarget(ref.target())) || affected.stream().anyMatch(s -> owns(s, ref.target()))) {
                    expanded |= affected.add(Source.of(ref));
                }
            }
        } while (expanded);
        List<Reference> existing = before.references().stream()
            .filter(ref -> !changed.contains(Source.of(ref)))
            .filter(ref -> changedTargets.contains(rootTarget(ref.target())) || changed.stream().anyMatch(s -> owns(s, ref.target())))
            .toList();
        return new Changes(Set.copyOf(changed), Set.copyOf(affected), existing, globalVampChanged);
    }

    private static boolean vampDependency(Row changed, Map<Row, JsonNode> rows) {
        if (!Set.of("ATTRIBUTE", "CATEGORY").contains(changed.type())) return false;
        for (Map.Entry<Row, JsonNode> entry : rows.entrySet()) {
            if (!entry.getKey().type().equals("VAMP_RULE")) continue;
            if (changed.type().equals("ATTRIBUTE")
                && changed.key().equals(entry.getValue().path("source_attribute_key").asText())) return true;
            if (changed.type().equals("CATEGORY")) for (JsonNode category : entry.getValue().path("skill_category_keys")) {
                if (changed.key().equals(category.asText())) return true;
            }
        }
        return false;
    }

    static Map<Row, JsonNode> rows(List<Map<String, Object>> raw) {
        Map<Row, JsonNode> result = new LinkedHashMap<>();
        for (Map<String, Object> row : raw) result.put(
            new Row((String) row.get("object_type"), (String) row.get("skill_key"), (String) row.get("object_key")),
            AggregateJson.tree((String) row.get("data")));
        return result;
    }

    private static Source source(Row row) {
        try { return new Source(SourceType.valueOf(row.type()), row.skill(), row.key()); }
        catch (IllegalArgumentException ignored) { return null; }
    }

    private static Target rootTarget(Target target) {
        return new Target(target.type(), target.skillKey(), target.key(), "");
    }

    private static boolean owns(Source source, Target target) {
        return SkillObjectReferences.belongsTo(target, new Aggregate(source.type(), source.skill(), source.key(), null));
    }

    private static boolean hasDamage(Aggregate aggregate) {
        for (JsonNode result : aggregate.data().path("results")) {
            if ("DAMAGE".equals(result.path("resultType").asText())) return true;
        }
        return false;
    }

    private static String group(Aggregate aggregate) {
        if (aggregate.type() != SourceType.TRIGGER) return null;
        String group = aggregate.data().path("limits").path("oncePerUse").path("groupKey").textValue();
        return group == null ? null : aggregate.skillKey() + "/" + group;
    }

    private static List<Aggregate> concat(List<Aggregate> first, List<Aggregate> second) {
        List<Aggregate> result = new ArrayList<>(first);
        result.addAll(second);
        return result;
    }
}
