package execution

import (
	"errors"
	"slices"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (f *Frame) evalContextForProgram(ability planbundle.CompiledAbility, id formula.GenericProgramID) (formula.GenericEvalContext, *model.EngineError) {
	context, err := f.evalContext(ability)
	if err != nil {
		return formula.GenericEvalContext{}, err
	}
	if requests := f.run.compiled.FormulaFacts(id); len(requests) != 0 {
		context.Facts = f.frameLinkedFacts(ability, requests)
	}
	return context, nil
}

func (f *Frame) frameLinkedFacts(ability planbundle.CompiledAbility, requests []formula.FactRequest) formula.FactView {
	if f.ownerProviderRef == "" || !f.run.compiled.Features.Has(planbundle.FeatureLinkedShieldReads) {
		return formula.FactView{}
	}
	providerIndex := int(ability.ProviderIndex)
	if instance, _, found := f.stageFor(f.providerOwnerKey()).instances.Providers().Find(f.ownerProviderRef); found {
		providerIndex = int(instance.DefinitionIndex)
	}
	if providerIndex >= len(f.run.compiled.Providers) {
		return formula.FactView{}
	}
	allowed := f.run.compiled.Providers[providerIndex].AuthorizedLinkedShields
	first, last, count := 0, 0, 0
	for index, request := range requests {
		if request.Kind == formula.ReadLinkedShieldPresent && slices.Contains(allowed, request.Index) {
			if count == 0 {
				first = index
			}
			last = index + 1
			count++
		}
	}
	if last-first == count {
		return f.prepareFormulaFacts(requests[first:last])
	}
	// 只有资格过滤在请求中间留下空位时才复制，正常挂载直接借用编译目录。
	filtered := make([]formula.FactRequest, 0, count)
	for _, request := range requests[first:last] {
		if request.Kind == formula.ReadLinkedShieldPresent && slices.Contains(allowed, request.Index) {
			filtered = append(filtered, request)
		}
	}
	return f.prepareFormulaFacts(filtered)
}

// prepareFormulaFacts 位于原效果、投影和机制上下文准备之后。只准备编译后有限请求，
// 不扫描程序；每个错误与自己的读取身份一起保存，未选分支不会提前返回错误。
func (f *Frame) prepareFormulaFacts(requests []formula.FactRequest) formula.FactView {
	if len(requests) == 0 {
		return formula.FactView{}
	}
	var first [2]formula.PreparedFact
	var rest []formula.PreparedFact
	if len(requests) > len(first) {
		rest = make([]formula.PreparedFact, len(requests)-len(first))
	}
	for index, request := range requests {
		var fact formula.PreparedFact
		switch request.Kind {
		case formula.ReadLinkedShieldPresent:
			fact.Value, fact.Err = f.linkedShieldPresent(request.Index)
		case formula.ReadReceivedLinkedShieldAbsorbed:
			fact.Value, fact.Err = f.receivedLinkedShieldAbsorbed(request.Index)
		case formula.ReadEventProviderTargetStateBefore:
			fact.Value, fact.Err = f.damageStateBefore(request.Key)
		default:
			fact.Err = errors.New("unsupported prepared formula fact")
		}
		if index < len(first) {
			first[index] = fact
		} else {
			rest[index-len(first)] = fact
		}
	}
	return formula.PreparedFacts(requests, first, rest)
}
