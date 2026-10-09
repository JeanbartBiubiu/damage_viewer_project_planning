package xyz.game.datamanage.service.damagetype;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.formula.DamageTypeFormulaBindings;
import xyz.game.datamanage.support.formula.FormulaContractValidator;

/** 伤害类型只消费共同定义；授权目录由真实调用点提供。 */
public final class DamageTypeFormulaParser {
    private DamageTypeFormulaParser() {}

    /** 目录查询前复用同源预算与结构检查；真实绑定授权仍留给随后目录校验。 */
    public static void validateBeforeCatalog(JsonNode definition) {
        FormulaContractValidator.Issue issue = FormulaContractValidator.validate(definition, List.of());
        if (issue != null && !"FORMULA_UNKNOWN_BINDING".equals(issue.code())) throw invalid(issue);
    }

    public static JsonNode validate(JsonNode definition, Collection<String> enabledAttributeKeys) {
        FormulaContractValidator.Issue issue = FormulaContractValidator.validate(
            definition, DamageTypeFormulaBindings.allowed(enabledAttributeKeys));
        if (issue != null) throw invalid(issue);
        return definition;
    }

    private static ApiException invalid(FormulaContractValidator.Issue issue) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", "伤害类型共同公式不合法",
            Map.of("fieldIssues", List.of(Map.of("field", "/formula" + issue.path(),
                "code", issue.code(), "message", "共同公式结构、引用或授权绑定不合法"))));
    }

    /** 管理读取检查结构与使用点口径，停用属性仍可展示；真实目录另由写入和快照检查。 */
    public static JsonNode readStored(String json) {
        JsonNode definition = AggregateJson.tree(json);
        FormulaContractValidator.Issue issue = FormulaContractValidator.validate(
            definition, DamageTypeFormulaBindings.allowed(DamageTypeFormulaBindings.attributeKeys(definition)));
        if (issue != null) throw new IllegalStateException("伤害类型共同公式数据损坏：" + issue.code() + issue.path());
        return definition;
    }
}
