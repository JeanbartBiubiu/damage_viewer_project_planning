package execution

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
)

func syncHPResolved(attrs attribute.Table) attribute.Table {
	slot, ok := attrs.Lookup("hp")
	if !ok {
		return attrs
	}
	if math.Float64bits(slot.Resolved) == math.Float64bits(slot.Current) {
		return attrs
	}
	slot.Resolved = slot.Current
	attrs = attrs.With("hp", slot)
	return attrs
}

// reResolveStagedAttributesTwoPass 在 live HP/resource/attribute 变更后，确定性两遍
// 重算 Resolved（每遍先 source 后 target）。只改 Resolved；保留 Current/Max；
// 每遍结束后强制 hp.Resolved=hp.Current。不改 Base（attribute_change 的 Base 策略除外）。
func (f *Frame) reResolveStagedAttributesTwoPass(ability planbundle.CompiledAbility) {
	memos, inputs, unchanged := f.refreshMemo(f.evalContext(ability))
	if unchanged {
		for _, key := range []string{f.sourceKey, f.targetKey} {
			host := f.stageFor(key)

			host.setAttributes(syncHPResolved(host.attributesView()))
		}
		return
	}
	for pass := 0; pass < 2; pass++ {
		for _, key := range []string{f.sourceKey, f.targetKey} {
			if key == "" {
				continue
			}
			sc := f.stageFor(key)
			evalCtx := f.evalContext(ability)

			sc.setAttributes(f.resolveAttributesFor(key, sc.attributesView(), evalCtx))

			sc.setAttributes(syncHPResolved(sc.attributesView()))
		}
	}
	for index, memo := range memos {
		if memo != nil && !f.fatal {
			memo.Remember(inputs[index], f.stageFor([]string{f.sourceKey, f.targetKey}[index]).attributesView(), f.evalContext(ability).StrictReads)
		}
	}
}

// reResolveLiveAttributesTwoPass 对 live combatants 做与 Frame 相同的确定性两遍
// source→target Resolved 重算（provider-aware）。只改 Resolved；保留 Current/Max；
// 每遍结束后强制 hp.Resolved=hp.Current。不遍历 map；不派发事件、不重跑 crit。
func (s *Engine) reResolveLiveAttributesTwoPass(sourceKey, targetKey string) {
	for pass := 0; pass < 2; pass++ {
		for _, key := range []string{sourceKey, targetKey} {
			if key == "" {
				continue
			}
			c, ok := s.combatants[key]
			if !ok {
				continue
			}
			evalCtx := s.evalContextForCombatants(sourceKey, targetKey)
			resolved := s.resolveAttributesFor(key, c.attributesView(), evalCtx, targetKey)
			c = s.combatants[key]

			c.setAttributes(resolved)

			c.setAttributes(syncHPResolved(c.attributesView()))
			s.combatants[key] = c
		}
	}
}

// refreshMemo只跳过已有结果仍有效的整轮结算。依赖签名来自结算前，
// 因而尚未稳定的跨属性读取仍会继续原来的两遍，不改变求值顺序。
func (f *Frame) refreshMemo(abilityCtx formula.GenericEvalContext) ([2]*evaluation.Memo, [2]attribute.Table, bool) {
	var memos [2]*evaluation.Memo
	var inputs [2]attribute.Table
	// 反向和自身行动的派生补算会另用全局双方上下文；无法完整证明
	// 两种上下文的依赖均未变化时，继续执行原两遍路径及其错误检查。
	if f.sourceKey != "source" || f.targetKey != "target" {
		return memos, inputs, false
	}
	matched := true
	for index, actor := range []string{f.sourceKey, f.targetKey} {
		host := f.stageFor(actor)
		inputs[index] = host.attributesView()
		memo := f.run.evaluation.Memo(f.run.compiled.AttributeDerivations, f.run.formulas, actor, true, true, [2]string{f.sourceKey, f.targetKey}, host.instances.Attributes(), host.attributesView())
		memos[index] = memo
		if !memo.Probe(host.attributesView(), &abilityCtx, f.providerFormulaContextFunc(actor)) {
			matched = false
		}
		if !memo.OutputsMatch(host.attributesView()) {
			matched = false
		}
	}
	return memos, inputs, matched
}
