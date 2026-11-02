package xyz.game.datamanage.service.skillformula;

import com.fasterxml.jackson.databind.JsonNode;
import xyz.game.datamanage.support.formula.SkillFormulaBindings;

import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillformula.SkillFormulaMapper;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeStatusRow;
import xyz.game.datamanage.model.skillformula.SkillFormulaCreateRequest;
import xyz.game.datamanage.model.skillformula.SkillFormulaDetailResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaRow;
import xyz.game.datamanage.model.skillformula.SkillFormulaSummaryResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaUpdateRequest;
import xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceGuard;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillFormulaService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Logger log = LoggerFactory.getLogger(SkillFormulaService.class);

    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_formulas";

    private final GamesMapper gamesMapper;
    private final SkillMapper skillMapper;
    private final SkillFormulaMapper formulaMapper;
    private final SkillTriggerReferenceGuard triggerReferences;

    public SkillFormulaService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillFormulaMapper formulaMapper,
        SkillTriggerReferenceGuard triggerReferences,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.formulaMapper = formulaMapper;
        this.triggerReferences = java.util.Objects.requireNonNull(triggerReferences);

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public List<SkillFormulaSummaryResponse> list(String gameId, String skillKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        List<SkillFormulaRow> rows = formulaMapper.listSummaries(gameId, skillKey);
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        List<SkillFormulaSummaryResponse> items = new ArrayList<>(rows.size());
        for (SkillFormulaRow row : rows) {
            items.add(toSummary(row));
        }
        return items;
    }

    @Transactional(readOnly = true)
    public SkillFormulaDetailResponse get(String gameId, String skillKey, String formulaKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        return requireDetail(gameId, skillKey, formulaKey);
    }

    @Transactional
    public SkillFormulaDetailResponse create(
        String gameId,
        String skillKey,
        @Valid SkillFormulaCreateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedFormula values = validateCreate(request);
        CollectedRefs refs = validateAndCollectExpression(skillKey, values.expression());

        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
        if (formulaMapper.countByKey(gameId, skillKey, values.formulaKey()) > 0) {
            throw keyExists();
        }

        validateReferences(gameId, skillKey, refs);
        validateAttributeEnabled(gameId, refs);

        try {
            formulaMapper.insert(
                gameId,
                skillKey,
                values.formulaKey(),
                values.name(),
                values.description(),
                values.sortOrder(),
                AggregateJson.write(values.expression())
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireDetail(gameId, skillKey, values.formulaKey());
    }

    @Transactional
    public SkillFormulaDetailResponse update(
        String gameId,
        String skillKey,
        String formulaKey,
        @Valid SkillFormulaUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedFormula values = validateUpdate(request, formulaKey);
        CollectedRefs refs = validateAndCollectExpression(skillKey, values.expression());

        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
        if (formulaMapper.findByIdForUpdate(gameId, skillKey, formulaKey) == null) {
            throw formulaNotFound(formulaKey);
        }


        validateReferences(gameId, skillKey, refs);
        validateAttributeEnabled(gameId, refs);

        try {
            if (formulaMapper.update(
                gameId,
                skillKey,
                formulaKey,
                values.name(),
                values.description(),
                values.sortOrder(),
                AggregateJson.write(values.expression())
            ) == 0) {
                throw formulaNotFound(formulaKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireDetail(gameId, skillKey, formulaKey);
    }

    @Transactional
    public void delete(String gameId, String skillKey, String formulaKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
        if (formulaMapper.findByIdForUpdate(gameId, skillKey, formulaKey) == null) {
            throw formulaNotFound(formulaKey);
        }
        triggerReferences.assertFormulaDeletable(gameId, skillKey, formulaKey);
        configurationWrites.assertNotReferenced(gameId, "FORMULA", skillKey, formulaKey,
            "409.SKILL_FORMULA_IN_USE", "技能公式已被引用，不能删除");
        try {
            if (formulaMapper.delete(gameId, skillKey, formulaKey) == 0) {
                throw formulaNotFound(formulaKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    /** Validate against the complete candidate parameter set, including parameters created in this transaction. */
    public void validateConfigurationCreate(
        String gameId, String skillKey, SkillFormulaCreateRequest request, Set<String> candidateParameterKeys
    ) {
        ValidatedFormula values = validateCreate(request);
        CollectedRefs refs = validateAndCollectExpression(skillKey, values.expression());
        validateReferences(gameId, skillKey, refs, candidateParameterKeys);
        validateAttributeEnabled(gameId, refs);
    }

    public void validateConfigurationUpdate(
        String gameId, String skillKey, String formulaKey,
        SkillFormulaUpdateRequest request, Set<String> candidateParameterKeys
    ) {
        ValidatedFormula values = validateUpdate(request, formulaKey);
        CollectedRefs refs = validateAndCollectExpression(skillKey, values.expression());

        validateReferences(gameId, skillKey, refs, candidateParameterKeys);
        validateAttributeEnabled(gameId, refs);
    }

    /** Existing formulas also participate when a submitted parameter is removed. */
    public void validateFinalParameterReferences(
        String gameId, String skillKey,
        Map<String, JsonNode> finalExpressions,
        Set<String> candidateParameterKeys
    ) {
        for (Map.Entry<String, JsonNode> formula : finalExpressions.entrySet()) {
            CollectedRefs refs = validateAndCollectExpression(skillKey, formula.getValue());
            List<Map<String, String>> issues = new ArrayList<>();
            for (PathRef ref : refs.parameterRefs) {
                if (!candidateParameterKeys.contains(ref.value())) {
                    issues.add(fieldIssue("formulas/" + formula.getKey() + "/" + ref.path(),
                        "UNKNOWN_SKILL_PARAMETER", "技能参数不存在或不属于当前技能"));
                }
            }
            if (!issues.isEmpty()) {
                throw new ApiException(HttpStatus.CONFLICT, "409.SKILL_FORMULA_PARAMETER_IN_USE",
                    "公式仍引用待删除参数", Map.of("fieldIssues", List.copyOf(issues)));
            }
        }
    }

    public boolean referencesAnyParameter(JsonNode expression, Set<String> parameterKeys) {
        if (parameterKeys.isEmpty()) return false;
        return SkillFormulaBindings.reachableParameterKeys(expression).stream().anyMatch(parameterKeys::contains);
    }
    @Transactional(propagation = Propagation.MANDATORY)
    public void createWithinConfiguration(
        String gameId, String skillKey, SkillFormulaCreateRequest request, Set<String> candidateParameterKeys
    ) {
        validateConfigurationCreate(gameId, skillKey, request, candidateParameterKeys);
        if (formulaMapper.countByKey(gameId, skillKey, request.formulaKey()) > 0) {
            throw keyExists();
        }
        try {
            formulaMapper.insert(gameId, skillKey, request.formulaKey(), request.name(),
                request.description(), request.sortOrder(), AggregateJson.write(request.expression()));
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void updateWithinConfiguration(
        String gameId, String skillKey, String formulaKey,
        SkillFormulaUpdateRequest request, Set<String> candidateParameterKeys
    ) {
        if (formulaMapper.findByIdForUpdate(gameId, skillKey, formulaKey) == null) {
            throw formulaNotFound(formulaKey);
        }
        validateConfigurationUpdate(gameId, skillKey, formulaKey, request, candidateParameterKeys);
        try {
            if (formulaMapper.update(gameId, skillKey, formulaKey, request.name(),
                request.description(), request.sortOrder(), AggregateJson.write(request.expression())) == 0) {
                throw formulaNotFound(formulaKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    /** The write guard checks final references after all submitted objects are applied. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void deleteWithinConfiguration(String gameId, String skillKey, String formulaKey) {
        if (formulaMapper.findByIdForUpdate(gameId, skillKey, formulaKey) == null) {
            throw formulaNotFound(formulaKey);
        }
        try {
            if (formulaMapper.delete(gameId, skillKey, formulaKey) == 0) {
                throw formulaNotFound(formulaKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    private SkillFormulaDetailResponse requireDetail(String gameId, String skillKey, String formulaKey) {
        SkillFormulaRow row = formulaMapper.findById(gameId, skillKey, formulaKey);
        if (row == null) {
            throw formulaNotFound(formulaKey);
        }
        try {
            JsonNode expression = SkillFormulaParser.readStored(skillKey, row.expression());
            SkillFormulaParser.validateBeforeCatalog(skillKey, expression);
            return toDetail(row, expression);
        } catch (IllegalStateException | ApiException ex) {
            throw corrupt(gameId, skillKey, formulaKey, "公式表达式形状不合法");
        }
    }

    private ValidatedFormula validateCreate(SkillFormulaCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能公式不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.expression() == null) {
            issues.add(fieldIssue("expression", "REQUIRED", "公式表达式不能为空"));
        }
        throwIfInvalid(issues);
        return new ValidatedFormula(
            request.formulaKey(),
            request.name(),
            request.description(),
            request.sortOrder(),
            request.expression()
        );
    }

    private ValidatedFormula validateUpdate(SkillFormulaUpdateRequest request, String pathKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能公式不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.formulaKey() != null) {
            issues.add(fieldIssue("formulaKey", "IMMUTABLE", "公式标识不能修改"));
        }
        if (request.expression() == null) {
            issues.add(fieldIssue("expression", "REQUIRED", "公式表达式不能为空"));
        }
        throwIfInvalid(issues);
        return new ValidatedFormula(
            pathKey,
            request.name(),
            request.description(),
            request.sortOrder(),
            request.expression()
        );
    }

    private CollectedRefs validateAndCollectExpression(String skillKey, JsonNode definition) {
        SkillFormulaParser.validateBeforeCatalog(skillKey, definition);
        CollectedRefs refs = new CollectedRefs();
        for (int i = 0; i < definition.path("inputs").size(); i++) {
            JsonNode binding = definition.path("inputs").get(i).path("binding");
            String path = "/expression/inputs/" + i + "/binding";
            if ("parameter".equals(binding.path("kind").asText())) {
                String key = binding.path("parameterKey").textValue();
                refs.parameterKeys.add(key);
                refs.parameterRefs.add(new PathRef(path + "/parameterKey", key));
            } else if ("attribute".equals(binding.path("kind").asText())) {
                String key = binding.path("attributeKey").textValue();
                refs.attributeKeys.add(key);
                refs.attributeRefs.add(new PathRef(path + "/attributeKey", key));
            }
        }
        return refs;
    }

    private void validateReferences(String gameId, String skillKey, CollectedRefs refs) {
        Set<String> parameters = refs.parameterKeys.isEmpty() ? Set.of()
            : new HashSet<>(nullToEmpty(formulaMapper.findExistingParameterKeys(gameId, skillKey, refs.parameterKeys)));
        validateReferences(gameId, skillKey, refs, parameters);
    }

    private void validateReferences(String gameId, String skillKey, CollectedRefs refs, Set<String> candidateParameterKeys) {
        List<Map<String, String>> issues = new ArrayList<>();
        for (PathRef ref : refs.parameterRefs) if (!candidateParameterKeys.contains(ref.value())) {
            issues.add(fieldIssue(ref.path(), "UNKNOWN_SKILL_PARAMETER", "技能参数不存在或不属于当前技能"));
        }
        if (!refs.attributeKeys.isEmpty()) {
            for (SkillFormulaAttributeStatusRow row : nullToEmpty(formulaMapper.findAttributesByKeys(gameId, refs.attributeKeys))) {
                refs.attributeStatusByKey.put(row.attributeKey(), row.status());
            }
            for (PathRef ref : refs.attributeRefs) if (!refs.attributeStatusByKey.containsKey(ref.value())) {
                issues.add(fieldIssue(ref.path(), "UNKNOWN_ATTRIBUTE", "属性不存在或不属于当前游戏"));
            }
        }
        throwIfInvalid(issues);
    }

    private void validateAttributeEnabled(String gameId, CollectedRefs refs) {
        List<Map<String, String>> issues = new ArrayList<>();
        for (PathRef ref : refs.attributeRefs) {
            if (!AttributeStatus.ENABLED.name().equals(refs.attributeStatusByKey.get(ref.value()))) {
                issues.add(fieldIssue(ref.path(), "FORMULA_ATTRIBUTE_DISABLED", "保存的技能共同公式必须引用启用属性"));
            }
        }
        if (!issues.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "409.FORMULA_ATTRIBUTE_DISABLED",
            "保存的技能共同公式必须引用启用属性", Map.of("fieldIssues", List.copyOf(issues), "gameId", gameId));
    }
    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw gameNotFound(gameId);
        }
    }

    private void requireSkillExists(String gameId, String skillKey) {
        if (skillMapper.findById(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
    }

    private static SkillFormulaSummaryResponse toSummary(SkillFormulaRow row) {
        return new SkillFormulaSummaryResponse(
            row.gameId(),
            row.skillKey(),
            row.formulaKey(),
            row.name(),
            row.description(),
            row.sortOrder(),
            row.createdAt(),
            row.updatedAt()
        );
    }

    private static SkillFormulaDetailResponse toDetail(
        SkillFormulaRow row,
        JsonNode expression
    ) {
        return new SkillFormulaDetailResponse(
            row.gameId(),
            row.skillKey(),
            row.formulaKey(),
            row.name(),
            row.description(),
            row.sortOrder(),
            expression,
            row.createdAt(),
            row.updatedAt()
        );
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能公式不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException gameNotFound(String gameId) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.GAME_NOT_FOUND",
            "游戏不存在",
            Map.of("gameId", gameId == null ? "" : gameId)
        );
    }

    private static ApiException skillNotFound(String skillKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_NOT_FOUND",
            "技能不存在",
            Map.of("skillKey", skillKey == null ? "" : skillKey)
        );
    }

    private static ApiException formulaNotFound(String formulaKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_FORMULA_NOT_FOUND",
            "技能公式不存在",
            Map.of("formulaKey", formulaKey == null ? "" : formulaKey)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.SKILL_FORMULA_KEY_EXISTS", "技能公式标识已存在", "formulaKey");
    }

    private static ApiException conflict(String code, String message, String field) {
        return new ApiException(
            HttpStatus.CONFLICT,
            code,
            message,
            Map.of("fieldIssues", List.of(fieldIssue(field, "CONFLICT", message)))
        );
    }

    private ApiException corrupt(
        String gameId,
        String skillKey,
        String formulaKey,
        String reason
    ) {
        log.error(
            "Skill formula data corruption detected. gameId={}, skillKey={}, formulaKey={}, reason={}",
            gameId,
            skillKey,
            formulaKey,
            reason
        );
        return new ApiException(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "500.INTERNAL_ERROR",
            "技能公式数据损坏",
            Map.of(
                "gameId", gameId,
                "skillKey", skillKey,
                "formulaKey", formulaKey,
                "reason", reason
            )
        );
    }

    private static RuntimeException mapWriteConstraint(DataIntegrityViolationException ex) {
        String text = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (text.contains(PRIMARY_KEY_CONSTRAINT)) {
            return keyExists();
        }
        return ex;
    }

    private static String collectCauseMessages(Throwable throwable) {
        StringBuilder result = new StringBuilder();
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            if (current.getMessage() != null) {
                result.append(' ').append(current.getMessage());
            }
        }
        return result.toString();
    }

    private static Map<String, String> fieldIssue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private record ValidatedFormula(
        String formulaKey,
        String name,
        String description,
        Integer sortOrder,
        JsonNode expression
    ) {
    }

    private static final class CollectedRefs {
        private final List<PathRef> parameterRefs = new ArrayList<>();
        private final List<PathRef> attributeRefs = new ArrayList<>();
        private final LinkedHashSet<String> parameterKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> attributeKeys = new LinkedHashSet<>();
        private final Map<String, String> attributeStatusByKey = new HashMap<>();
    }

    private record PathRef(String path, String value) {
    }


}
