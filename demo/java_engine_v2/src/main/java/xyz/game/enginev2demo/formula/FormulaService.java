package xyz.game.enginev2demo.formula;

import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.CounterScope;
import xyz.game.enginev2demo.runtime.PairRuntimeState;
import xyz.game.enginev2demo.runtime.ResourceState;

/**
 * 公式求值服务。
 */
public final class FormulaService {

    public double evaluate(FormulaDefinition definition, FormulaEvalContext context) {
        return evaluateNode(definition.root(), context);
    }

    public double evaluate(FormulaCatalog formulaCatalog, String formulaId, FormulaEvalContext context) {
        return evaluate(formulaCatalog.require(formulaId), context);
    }

    private double evaluateNode(FormulaNode node, FormulaEvalContext context) {
        return switch (node) {
            case FormulaNode.Constant constant -> constant.value();
            case FormulaNode.Attr attr -> actorForScope(context, attr.scope()).attr(attr.attrKey());
            case FormulaNode.InputValue inputValue -> context.inputValues().getOrDefault(inputValue.key(), 0.0);
            case FormulaNode.Add add -> add.nodes().stream().mapToDouble(child -> evaluateNode(child, context)).sum();
            case FormulaNode.Multiply multiply -> multiply.nodes().stream()
                    .mapToDouble(child -> evaluateNode(child, context))
                    .reduce(1.0, (left, right) -> left * right);
            case FormulaNode.Min min -> min.nodes().stream()
                    .mapToDouble(child -> evaluateNode(child, context))
                    .min()
                    .orElse(0.0);
            case FormulaNode.Max max -> max.nodes().stream()
                    .mapToDouble(child -> evaluateNode(child, context))
                    .max()
                    .orElse(0.0);
            case FormulaNode.Divide divide -> divide(divide, context);
            case FormulaNode.SignSwitch signSwitch -> evaluateNode(signSwitch.test(), context) >= 0.0
                    ? evaluateNode(signSwitch.whenNonNegative(), context)
                    : evaluateNode(signSwitch.whenNegative(), context);
            case FormulaNode.RecentDamageTaken recentDamageTaken -> actorForScope(context, recentDamageTaken.scope())
                    .history()
                    .recentDamageTaken(context.state().nowMs(), recentDamageTaken.windowMs());
            case FormulaNode.RecentControlDuration recentControlDuration -> actorForScope(context, recentControlDuration.scope())
                    .history()
                    .recentControlDuration(context.state().nowMs(), recentControlDuration.windowMs());
            case FormulaNode.CounterValue counterValue -> counterValue(context, counterValue.counterScope(), counterValue.scope(), counterValue.counterId());
            case FormulaNode.ResourceValue resourceValue -> resourceValue(actorForScope(context, resourceValue.scope()), resourceValue.resourceId());
        };
    }

    private double divide(FormulaNode.Divide divide, FormulaEvalContext context) {
        double denominator = evaluateNode(divide.denominator(), context);
        if (Math.abs(denominator) < 1e-9) {
            return 0.0;
        }
        return evaluateNode(divide.numerator(), context) / denominator;
    }

    private ActorRuntime actorForScope(FormulaEvalContext context, FormulaNode.Scope scope) {
        return scope == FormulaNode.Scope.SOURCE ? context.source() : context.target();
    }

    private double counterValue(
            FormulaEvalContext context,
            CounterScope counterScope,
            FormulaNode.Scope scope,
            String counterId) {
        ActorRuntime owner = actorForScope(context, scope);
        if (counterScope == CounterScope.ACTOR) {
            return owner.actorCounter(counterId).value();
        }
        ActorRuntime other = scope == FormulaNode.Scope.SOURCE ? context.target() : context.source();
        PairRuntimeState pairRuntimeState = context.state().pairState(owner.actorId(), other.actorId());
        return pairRuntimeState.pairCounter(counterId).value();
    }

    private double resourceValue(ActorRuntime actorRuntime, String resourceId) {
        ResourceState resourceState = actorRuntime.resource(resourceId);
        if (resourceState == null) {
            return 0.0;
        }
        return resourceState.current();
    }
}
