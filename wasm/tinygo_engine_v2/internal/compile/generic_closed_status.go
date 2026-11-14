package compile

import "tinygo_engine_v2/internal/model"

// 候选与全部定义完成后绑定真实逻辑状态键；控制类别和类型本身不充当状态键。
func finalizeClosedStatusBindings(ctx *genericCompileContext) {
	for _, operation := range ctx.session.Operations {
		if operation.SkillHit == nil {
			continue
		}
		for _, candidate := range operation.SkillHit.Candidates {
			semantic := candidate.Semantic
			if semantic.ResultType != model.SkillHitResultStatusOperation || semantic.StatusOperation != model.StatusOperationApply {
				continue
			}
			if _, closed := model.ClosedStatusKindProviderType[semantic.StatusKind]; !closed {
				continue
			}
			if _, declared := ctx.catalog.Registry.LookupDomain("status", "status/"+semantic.StatusKey); !declared {
				ctx.collector.addError(model.GenericErrUnknownTypeKey, candidate.Path+".semantic.statusKey", "closed control status key must be declared by the actual status catalog", semantic.StatusKey)
				continue
			}
			start, end := int(candidate.OperationStart), int(candidate.OperationStart)+int(candidate.OperationCount)
			if end > len(ctx.session.Operations) {
				ctx.collector.addError(model.GenericErrUnknownRef, candidate.Path+".operations", "closed control operation range exceeds the compiled plan", semantic.StatusKey)
				continue
			}
			for _, leaf := range ctx.session.Operations[start:end] {
				if leaf.Operation != "apply_provider" || !providerMatchesStatusKind(ctx, leaf.ProviderDefinitionRef, semantic.StatusKind, semantic.StatusKey) {
					continue // 真实操作类别与定义不一致已由原候选语义检查报告。
				}
				index, exists := ctx.providerKeyIndex[leaf.ProviderDefinitionRef]
				if !exists || int(index) >= len(ctx.session.Providers) {
					continue
				}
				provider := &ctx.session.Providers[index]
				if provider.ClosedStatusKey != "" && provider.ClosedStatusKey != semantic.StatusKey {
					ctx.collector.addError(model.GenericErrUnknownRef, candidate.Path+".semantic.statusKey", "one closed control definition cannot bind different status keys", semantic.StatusKey)
					continue
				}
				provider.ClosedStatusKey = semantic.StatusKey
			}
		}
	}
}
