package execution

import "tinygo_engine_v2/internal/formula"

// evalBinding 保存一次同步借用的外层绑定与局部数值读取基线。
type evalBinding struct {
	scope                       evalScope
	outputs                     map[string]formula.OperationOutputValues
	beforeDamage, beforeHealing float64
}

func (f *Frame) pushEvalScope(next evalScope) evalBinding {
	facts := f.numeric.Facts()
	saved := evalBinding{scope: f.evalScope, outputs: f.numeric.Outputs(), beforeDamage: facts.Damage, beforeHealing: facts.Healing}
	f.evalScope = next
	return saved
}

func (f *Frame) restoreEvalScope(saved evalBinding) {
	f.evalScope = saved.scope
	f.numeric.SetOutputs(saved.outputs)
}
