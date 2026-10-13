package xyz.game.datamanage.service.skillformula;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.formula.FormulaContractValidator;
import xyz.game.datamanage.support.formula.SkillFormulaBindings;

/** 正式技能接口只接共同定义；读取保留停用目录供修复，保存授权来自真实最终目录。 */
public final class SkillFormulaParser {
    private SkillFormulaParser() {}

    public static JsonNode validate(String skillKey, JsonNode definition, Collection<String> enabledAttributes, Collection<String> parameters) {
        var issue = FormulaContractValidator.validate(definition, SkillFormulaBindings.allowed(skillKey, enabledAttributes, parameters));
        if (issue != null) throw invalid(issue);
        return definition;
    }

    public static JsonNode readStored(String skillKey, String json) {
        JsonNode definition = AggregateJson.tree(json);
        var issue = structuralIssue(skillKey, definition);
        if (issue != null) throw new IllegalStateException("技能共同公式数据损坏：" + issue.code() + issue.path());
        return definition;
    }

    public static void validateBeforeCatalog(String skillKey, JsonNode definition) {
        var issue = structuralIssue(skillKey, definition);
        if (issue != null) throw invalid(issue);
    }

    public static FormulaContractValidator.Issue structuralIssue(String skillKey, JsonNode definition) {
        return FormulaContractValidator.validate(definition, SkillFormulaBindings.allowed(skillKey,
            SkillFormulaBindings.attributeKeys(definition), SkillFormulaBindings.parameterKeys(definition)));
    }

    public static ApiException invalid(FormulaContractValidator.Issue issue) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", "技能共同公式不合法",
            Map.of("fieldIssues", List.of(Map.of("field", "/expression" + issue.path(), "code", issue.code(),
                "message", "共同公式结构、引用或授权绑定不合法"))));
    }
}
