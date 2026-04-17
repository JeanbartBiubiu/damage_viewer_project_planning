package enginev2demo

import "math"

type FormulaScope string

const (
	FormulaScopeSource FormulaScope = "SOURCE"
	FormulaScopeTarget FormulaScope = "TARGET"
)

type EvalContext struct {
	Source *ActorRuntime
	Target *ActorRuntime
	Inputs map[string]float64
}

type Formula interface {
	Eval(EvalContext) float64
}

type FormulaDefinition struct {
	ID   string
	Root Formula
}

type FormulaService struct {
	formulas map[string]Formula
}

func NewFormulaService(defs []FormulaDefinition) (FormulaService, error) {
	service := FormulaService{formulas: make(map[string]Formula, len(defs))}
	for _, def := range defs {
		if def.ID == "" {
			return FormulaService{}, errString("formula id must not be empty")
		}
		if def.Root == nil {
			return FormulaService{}, errString("formula root must not be nil")
		}
		service.formulas[def.ID] = def.Root
	}
	return service, nil
}

func (s FormulaService) Has(id string) bool {
	_, ok := s.formulas[id]
	return ok
}

func (s FormulaService) Eval(id string, ctx EvalContext) float64 {
	root, ok := s.formulas[id]
	if !ok {
		return 0
	}
	return root.Eval(ctx)
}

type Constant struct {
	Value float64
}

func (n Constant) Eval(_ EvalContext) float64 {
	return n.Value
}

type Attr struct {
	Scope FormulaScope
	Key   string
}

func (n Attr) Eval(ctx EvalContext) float64 {
	switch n.Scope {
	case FormulaScopeSource:
		return lookupAttr(ctx.Source, n.Key)
	case FormulaScopeTarget:
		return lookupAttr(ctx.Target, n.Key)
	default:
		return 0
	}
}

type InputValue struct {
	Key string
}

func (n InputValue) Eval(ctx EvalContext) float64 {
	if ctx.Inputs == nil {
		return 0
	}
	return ctx.Inputs[n.Key]
}

type Add struct {
	Nodes []Formula
}

func (n Add) Eval(ctx EvalContext) float64 {
	sum := 0.0
	for _, node := range n.Nodes {
		sum += node.Eval(ctx)
	}
	return sum
}

type Multiply struct {
	Nodes []Formula
}

func (n Multiply) Eval(ctx EvalContext) float64 {
	if len(n.Nodes) == 0 {
		return 0
	}
	product := 1.0
	for _, node := range n.Nodes {
		product *= node.Eval(ctx)
	}
	return product
}

type Max struct {
	Nodes []Formula
}

func (n Max) Eval(ctx EvalContext) float64 {
	if len(n.Nodes) == 0 {
		return 0
	}
	value := n.Nodes[0].Eval(ctx)
	for _, node := range n.Nodes[1:] {
		value = math.Max(value, node.Eval(ctx))
	}
	return value
}

type Divide struct {
	Numerator   Formula
	Denominator Formula
}

func (n Divide) Eval(ctx EvalContext) float64 {
	denominator := n.Denominator.Eval(ctx)
	if math.Abs(denominator) < 1e-9 {
		return 0
	}
	return n.Numerator.Eval(ctx) / denominator
}

type SignSwitch struct {
	Test            Formula
	WhenNonNegative Formula
	WhenNegative    Formula
}

func (n SignSwitch) Eval(ctx EvalContext) float64 {
	if n.Test.Eval(ctx) >= 0 {
		return n.WhenNonNegative.Eval(ctx)
	}
	return n.WhenNegative.Eval(ctx)
}

func SourceAttr(key string) Formula {
	return Attr{Scope: FormulaScopeSource, Key: key}
}

func TargetAttr(key string) Formula {
	return Attr{Scope: FormulaScopeTarget, Key: key}
}

func Input(key string) Formula {
	return InputValue{Key: key}
}

func Sum(nodes ...Formula) Formula {
	return Add{Nodes: nodes}
}

func Product(nodes ...Formula) Formula {
	return Multiply{Nodes: nodes}
}

func MaxOf(nodes ...Formula) Formula {
	return Max{Nodes: nodes}
}

func Quotient(numerator, denominator Formula) Formula {
	return Divide{Numerator: numerator, Denominator: denominator}
}

func Switch(test, whenNonNegative, whenNegative Formula) Formula {
	return SignSwitch{
		Test:            test,
		WhenNonNegative: whenNonNegative,
		WhenNegative:    whenNegative,
	}
}

func lookupAttr(actor *ActorRuntime, key string) float64 {
	if actor == nil {
		return 0
	}
	return actor.Attributes[key]
}
