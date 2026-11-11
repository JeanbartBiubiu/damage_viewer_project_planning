package execution

import (
	"errors"
	"tinygo_engine_v2/internal/formula"
)

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
