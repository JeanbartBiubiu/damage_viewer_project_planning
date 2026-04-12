package xyz.game.enginev2demo.formula;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 公式目录——管理 formulaId → {@link FormulaDefinition} 的映射。
 * 在 compile 阶段构建，运行期通过 {@link #require} 获取公式定义。
 */
public record FormulaCatalog(Map<String, FormulaDefinition> definitions) {

    public FormulaCatalog {
        definitions = Map.copyOf(definitions);
    }

    public static FormulaCatalog fromDefinitions(List<FormulaDefinition> definitions) {
        Map<String, FormulaDefinition> byId = new LinkedHashMap<>();
        for (FormulaDefinition definition : definitions) {
            byId.put(definition.formulaId(), definition);
        }
        return new FormulaCatalog(byId);
    }

    public FormulaDefinition require(String formulaId) {
        FormulaDefinition definition = definitions.get(formulaId);
        if (definition == null) {
            throw new IllegalArgumentException("missing formula: " + formulaId);
        }
        return definition;
    }
}
