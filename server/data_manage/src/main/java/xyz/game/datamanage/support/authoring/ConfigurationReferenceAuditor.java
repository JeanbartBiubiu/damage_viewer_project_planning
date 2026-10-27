package xyz.game.datamanage.support.authoring;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import xyz.game.datamanage.model.authoring.ConfigurationReferenceAuditResponse;
import xyz.game.datamanage.model.authoring.ConfigurationReferenceAuditResponse.Counts;
import xyz.game.datamanage.model.authoring.ConfigurationReferenceAuditResponse.Issue;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

/** 只比较输入快照；不读取数据库、不保存索引，也不执行数值或战斗语义。 */
public final class ConfigurationReferenceAuditor {
    static final int MAX_SOURCES = 5000;
    static final int MAX_EXISTING_REFERENCES = 50000;
    static final int MAX_CATALOG_TARGETS = 20000;
    static final int MAX_EXTRACTED_REFERENCES = 50000;
    static final long MAX_TOTAL_BYTES = 32L * 1024 * 1024;
    static final long MAX_SOURCE_BYTES = 2L * 1024 * 1024;
    private static final int MAX_RETURNED_ISSUES = 200;
    private static final Pattern FIELD_PATH = Pattern.compile("[A-Za-z0-9_./\\[\\]-]{1,512}");

    public record Source(SourceType type, String skillKey, String key, String json) {}
    public record ReadCounts(long sourceCount, long existingReferenceCount, long catalogTargetCount,
                             long sourceJsonBytes, long referencePathBytes, long maxSourceJsonBytes) {}
    public record Input(String gameId, ReadCounts counts, List<Source> sources,
                        List<Reference> existingReferences, Set<Target> catalog, boolean readComplete) {}

    private record SourceKey(SourceType type, String skillKey, String key) {
        static SourceKey of(Source source) { return new SourceKey(source.type(), source.skillKey(), source.key()); }
        static SourceKey of(Reference reference) {
            return new SourceKey(reference.sourceType(), reference.sourceSkillKey(), reference.sourceKey());
        }
    }

    private ConfigurationReferenceAuditor() {}

    static List<String> readBudgetProblems(ReadCounts counts) {
        List<String> problems = new ArrayList<>();
        if (counts.sourceCount() > MAX_SOURCES) problems.add("源对象数量超过审计上限");
        if (counts.existingReferenceCount() > MAX_EXISTING_REFERENCES) problems.add("现存引用数量超过审计上限");
        if (counts.catalogTargetCount() > MAX_CATALOG_TARGETS) problems.add("目录目标数量超过审计上限");
        if (counts.sourceJsonBytes() > MAX_TOTAL_BYTES
            || counts.referencePathBytes() > MAX_TOTAL_BYTES - counts.sourceJsonBytes())
            problems.add("源内容与引用路径总字节数超过审计上限");
        if (counts.maxSourceJsonBytes() > MAX_SOURCE_BYTES) problems.add("单个源内容字节数超过审计上限");
        return List.copyOf(problems);
    }

    public static ConfigurationReferenceAuditResponse audit(Input input) {
        List<Issue> issues = new ArrayList<>();
        List<String> budgetProblems = readBudgetProblems(input.counts());
        for (String message : budgetProblems) issues.add(limit(input.gameId(), message));
        if (!input.readComplete() && budgetProblems.isEmpty())
            issues.add(limit(input.gameId(), "读取数量与预检不一致，审计未完成"));
        if (!budgetProblems.isEmpty() || !input.readComplete()) return response(input, issues, false, null);

        Set<Reference> extracted = new LinkedHashSet<>();
        Map<SourceKey, Aggregate> context = new HashMap<>();
        Set<SourceKey> invalidSources = new HashSet<>();
        boolean extractionLimited = false;
        for (Source source : input.sources()) {
            SourceKey key = SourceKey.of(source);
            try {
                Aggregate aggregate = new Aggregate(source.type(), source.skillKey(), source.key(), AggregateJson.tree(source.json()));
                if (aggregate.data() == null || !aggregate.data().isObject())
                    throw new IllegalArgumentException("源内容须为对象");
                List<Reference> references = SkillObjectReferences.extract(input.gameId(), List.of(aggregate));
                context.put(key, aggregate);
                for (Reference reference : references) {
                    extracted.add(reference);
                    if (extracted.size() > MAX_EXTRACTED_REFERENCES) {
                        extractionLimited = true;
                        break;
                    }
                }
                if (extractionLimited) break;
            } catch (ApiException | IllegalStateException | IllegalArgumentException ex) {
                if (ex instanceof ApiException api && !isSourceStructureError(api)) throw api;
                invalidSource(input.gameId(), key, knownFieldPath(ex), invalidSources, issues);
            }
        }
        if (extractionLimited) {
            issues.add(limit(input.gameId(), "唯一提取引用数量超过审计上限，审计未完成"));
            return response(input, issues, false, null);
        }

        Set<Reference> existing = new LinkedHashSet<>(input.existingReferences());
        Set<Reference> allReferences = new LinkedHashSet<>(extracted);
        allReferences.addAll(existing);
        Map<SourceKey, List<Reference>> grouped = new LinkedHashMap<>();
        for (Reference reference : allReferences) {
            SourceKey owner = targetOwner(reference.target());
            // 无法解析目标源时，不能把其尚未确认的子目标判成不存在。
            if (owner != null && invalidSources.contains(owner) && !input.catalog().contains(reference.target())) continue;
            SourceKey group = owner == null
                ? new SourceKey(null, reference.target().type().name(), reference.target().key()) : owner;
            grouped.computeIfAbsent(group, ignored -> new ArrayList<>()).add(reference);
        }
        for (var group : grouped.entrySet()) {
            Aggregate aggregate = context.get(group.getKey());
            Set<Target> catalog = new HashSet<>();
            for (Reference reference : group.getValue()) {
                if (input.catalog().contains(reference.target())) catalog.add(reference.target());
            }
            try {
                SkillObjectReferences.validateExistingTargets(group.getValue(),
                    aggregate == null ? List.of() : List.of(aggregate), catalog);
            } catch (ApiException ex) {
                // 子标识形状错误属于目标源；它不能转换为缺失目标，也不能依赖缺省的异常字段重建身份。
                if (aggregate != null && isSourceStructureError(ex)) {
                    invalidSource(input.gameId(), group.getKey(), knownFieldPath(ex), invalidSources, issues);
                } else {
                    addMissingTargets(ex, group.getValue(), issues);
                }
            }
        }
        // 目标检查也可能发现无效源，须确定最终集合后再比较索引。
        for (Reference reference : extracted) {
            if (!invalidSources.contains(SourceKey.of(reference)) && !existing.contains(reference))
                issues.add(issue("INDEX_MISSING", "缺少配置引用索引", reference));
        }
        for (Reference reference : existing) {
            if (!invalidSources.contains(SourceKey.of(reference)) && !extracted.contains(reference))
                issues.add(issue("INDEX_EXTRA", "存在多余的配置引用索引", reference));
        }
        return response(input, issues, invalidSources.isEmpty(), invalidSources.isEmpty() ? extracted.size() : null);
    }

    private static void invalidSource(String gameId, SourceKey source, String fieldPath,
                                      Set<SourceKey> invalidSources, List<Issue> issues) {
        if (invalidSources.add(source)) issues.add(new Issue("SOURCE_JSON_INVALID", "源对象内容无法提取或确认引用目标", gameId,
            source.skillKey(), source.type().name(), source.key(), fieldPath, null, null, null, null));
    }

    private static boolean isSourceStructureError(ApiException ex) {
        if (!"409.SKILL_OBJECT_REFERENCE_INVALID".equals(ex.getCode())
            || !(ex.getDetails().get("fieldIssues") instanceof List<?> fields) || fields.isEmpty()) return false;
        for (Object item : fields) {
            if (!(item instanceof Map<?, ?> issue) || issue.containsKey("code")
                || !(issue.get("field") instanceof String field) || field.isBlank()
                || !Set.of("field", "sourceSkillKey", "sourceType", "sourceKey").containsAll(issue.keySet())) return false;
        }
        return true;
    }

    private static String knownFieldPath(RuntimeException ex) {
        if (ex instanceof ApiException api && api.getDetails().get("fieldIssues") instanceof List<?> fields) {
            for (Object item : fields) {
                if (item instanceof Map<?, ?> issue && issue.get("field") instanceof String field
                    && FIELD_PATH.matcher(field).matches()) return field;
            }
        }
        return "";
    }

    private static void addMissingTargets(ApiException ex, List<Reference> references, List<Issue> issues) {
        if (!"409.SKILL_OBJECT_REFERENCE_INVALID".equals(ex.getCode())
            || !(ex.getDetails().get("fieldIssues") instanceof List<?> fields) || fields.isEmpty()) throw ex;
        Set<Map<?, ?>> missing = new HashSet<>();
        for (Object item : fields) {
            if (!(item instanceof Map<?, ?> issue) || !"MISSING_REFERENCE_TARGET".equals(issue.get("code"))) throw ex;
            missing.add(issue);
        }
        List<Reference> confirmed = new ArrayList<>();
        for (Reference reference : references) {
            Target target = reference.target();
            Map<String, String> identity = Map.of("field", reference.fieldPath(), "code", "MISSING_REFERENCE_TARGET",
                "sourceSkillKey", reference.sourceSkillKey(), "sourceType", reference.sourceType().name(),
                "sourceKey", reference.sourceKey(), "targetType", target.type().name(),
                "targetSkillKey", target.skillKey(), "targetKey", target.key(), "targetSubKey", target.subKey());
            if (missing.remove(identity)) confirmed.add(reference);
        }
        if (!missing.isEmpty()) throw ex;
        for (Reference reference : confirmed)
            issues.add(issue("TARGET_MISSING", "配置引用目标不存在或无法唯一定位", reference));
    }

    private static SourceKey targetOwner(Target target) {
        SourceType type = switch (target.type()) {
            case FORMULA -> SourceType.FORMULA;
            case EFFECT, RESULT, LIFECYCLE -> SourceType.EFFECT;
            case STATE, OPTION -> SourceType.STATE;
            case PROCESS, STEP -> SourceType.PROCESS;
            case ACTION -> SourceType.TRIGGER;
            case DAMAGE_TYPE -> SourceType.DAMAGE_TYPE;
            default -> null;
        };
        return type == null ? null : new SourceKey(type, target.skillKey(), target.key());
    }

    private static Issue issue(String code, String message, Reference reference) {
        Target target = reference.target();
        return new Issue(code, message, reference.gameId(), reference.sourceSkillKey(), reference.sourceType().name(),
            reference.sourceKey(), reference.fieldPath(), target.type().name(), target.skillKey(), target.key(), target.subKey());
    }

    private static Issue limit(String gameId, String message) {
        return new Issue("AUDIT_LIMIT_EXCEEDED", message, gameId, null, null, null, null, null, null, null, null);
    }

    private static ConfigurationReferenceAuditResponse response(Input input, List<Issue> issues,
                                                                 boolean complete, Integer extractedCount) {
        Comparator<String> text = Comparator.nullsFirst(Comparator.naturalOrder());
        issues.sort(Comparator.comparing(Issue::code).thenComparing(Issue::gameId, text)
            .thenComparing(Issue::sourceSkillKey, text).thenComparing(Issue::sourceType, text)
            .thenComparing(Issue::sourceKey, text).thenComparing(Issue::fieldPath, text)
            .thenComparing(Issue::targetType, text).thenComparing(Issue::targetSkillKey, text)
            .thenComparing(Issue::targetKey, text).thenComparing(Issue::targetSubKey, text)
            .thenComparing(Issue::message));
        int count = issues.size();
        List<Issue> returned = List.copyOf(issues.subList(0, Math.min(count, MAX_RETURNED_ISSUES)));
        ReadCounts counts = input.counts();
        return new ConfigurationReferenceAuditResponse(input.gameId(), complete, complete && count == 0,
            count, complete ? count : null, returned.size(), returned.size() < count,
            new Counts(counts.sourceCount(), counts.existingReferenceCount(), counts.catalogTargetCount(), extractedCount), returned);
    }
}
