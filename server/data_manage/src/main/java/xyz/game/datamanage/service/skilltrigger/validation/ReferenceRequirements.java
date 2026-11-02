package xyz.game.datamanage.service.skilltrigger.validation;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;

/** 一次结构校验得到的只读引用需求；引用问题仍由目录阶段报告。 */
public record ReferenceRequirements(
    List<CatalogRef> attributes,
    List<CatalogRef> damageTypes,
    List<CatalogRef> statuses,
    List<CatalogRef> formulas,
    List<CatalogRef> effects,
    List<CatalogRef> processes,
    List<OwnedRef> states,
    List<OwnedRef> readEffects,
    List<OwnedRef> readProcesses,
    List<CatalogRef> skills,
    List<CatalogRef> parameters,
    Set<String> attributeKeys,
    Set<String> damageTypeKeys,
    Set<String> statusKeys,
    Set<String> formulaKeys,
    Set<String> effectKeys,
    Set<String> processKeys,
    Set<String> skillKeys,
    Set<String> parameterKeys,
    List<Map<String, String>> referenceIssues
) {
    public ReferenceRequirements {
        attributes = List.copyOf(attributes);
        damageTypes = List.copyOf(damageTypes);
        statuses = List.copyOf(statuses);
        formulas = List.copyOf(formulas);
        effects = List.copyOf(effects);
        processes = List.copyOf(processes);
        states = List.copyOf(states);
        readEffects = List.copyOf(readEffects);
        readProcesses = List.copyOf(readProcesses);
        skills = List.copyOf(skills);
        parameters = List.copyOf(parameters);
        attributeKeys = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(attributeKeys));
        damageTypeKeys = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(damageTypeKeys));
        statusKeys = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(statusKeys));
        formulaKeys = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(formulaKeys));
        effectKeys = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(effectKeys));
        processKeys = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(processKeys));
        skillKeys = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(skillKeys));
        parameterKeys = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(parameterKeys));
        referenceIssues = referenceIssues.stream()
            .map(issue -> java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(issue))).toList();
    }

    public record CatalogRef(String field, String key, boolean numeric) {
        public CatalogRef(String field, SkillNumericValue value) { this(field, value == null ? null : value.formulaKey(), false); }
        public CatalogRef(String field, String key) {
            this(field, key, false);
        }
    }

    public record OwnedRef(String field, String skillKey, String key) {
    }
}
