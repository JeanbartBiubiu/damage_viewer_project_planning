package xyz.game.enginev2demo.formula;

import java.util.List;
import java.util.Objects;

import xyz.game.enginev2demo.runtime.CounterScope;

/**
 * 公式 AST 节点。
 */
public sealed interface FormulaNode permits FormulaNode.Constant, FormulaNode.Attr, FormulaNode.InputValue,
        FormulaNode.Add, FormulaNode.Multiply, FormulaNode.Min, FormulaNode.Max, FormulaNode.Divide,
        FormulaNode.SignSwitch, FormulaNode.RecentDamageTaken, FormulaNode.RecentControlDuration,
        FormulaNode.CounterValue, FormulaNode.ResourceValue {

    record Constant(double value) implements FormulaNode {
    }

    record Attr(Scope scope, String attrKey) implements FormulaNode {
        public Attr {
            Objects.requireNonNull(scope, "scope");
            Objects.requireNonNull(attrKey, "attrKey");
        }
    }

    record InputValue(String key) implements FormulaNode {
        public InputValue {
            Objects.requireNonNull(key, "key");
        }
    }

    record Add(List<FormulaNode> nodes) implements FormulaNode {
        public Add {
            nodes = List.copyOf(nodes);
        }
    }

    record Multiply(List<FormulaNode> nodes) implements FormulaNode {
        public Multiply {
            nodes = List.copyOf(nodes);
        }
    }

    record Min(List<FormulaNode> nodes) implements FormulaNode {
        public Min {
            nodes = List.copyOf(nodes);
        }
    }

    record Max(List<FormulaNode> nodes) implements FormulaNode {
        public Max {
            nodes = List.copyOf(nodes);
        }
    }

    /**
     * 左右子表达式相除。
     * denominator 为 0 时直接返回 0，避免 demo 因配置失误炸掉。
     */
    record Divide(FormulaNode numerator, FormulaNode denominator) implements FormulaNode {
        public Divide {
            Objects.requireNonNull(numerator, "numerator");
            Objects.requireNonNull(denominator, "denominator");
        }
    }

    /**
     * 按符号分支。
     * test >= 0 走 whenNonNegative，否则走 whenNegative。
     */
    record SignSwitch(FormulaNode test, FormulaNode whenNonNegative, FormulaNode whenNegative) implements FormulaNode {
        public SignSwitch {
            Objects.requireNonNull(test, "test");
            Objects.requireNonNull(whenNonNegative, "whenNonNegative");
            Objects.requireNonNull(whenNegative, "whenNegative");
        }
    }

    record RecentDamageTaken(Scope scope, long windowMs) implements FormulaNode {
        public RecentDamageTaken {
            Objects.requireNonNull(scope, "scope");
        }
    }

    record RecentControlDuration(Scope scope, long windowMs) implements FormulaNode {
        public RecentControlDuration {
            Objects.requireNonNull(scope, "scope");
        }
    }

    record CounterValue(CounterScope counterScope, Scope scope, String counterId) implements FormulaNode {
        public CounterValue {
            Objects.requireNonNull(counterScope, "counterScope");
            Objects.requireNonNull(scope, "scope");
            Objects.requireNonNull(counterId, "counterId");
        }
    }

    record ResourceValue(Scope scope, String resourceId) implements FormulaNode {
        public ResourceValue {
            Objects.requireNonNull(scope, "scope");
            Objects.requireNonNull(resourceId, "resourceId");
        }
    }

    enum Scope {
        SOURCE,
        TARGET
    }
}
