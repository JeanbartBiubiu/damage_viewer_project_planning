package execution

import (
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// 初始属性与派生重算使用同一真实实例期限，恢复时刻等于期限即不再参与。
func materializedProviderFormulaContext(actors map[string]combatantRuntime, compiled planbundle.CompiledSession, actorKey, castProxy string, at int64) pipeline.ProviderFormulaContextFunc {
	return func(ownerKey, providerRef string) pipeline.ProviderFormulaContext {
		bagOwner := ownerKey
		if bagOwner == "" {
			bagOwner = actorKey
		}
		activeTarget := providerTargetActiveKey(actorKey, ownerKey, castProxy)
		owner, found := actors[bagOwner]
		if !found {
			return providerFormulaContextFromBag(effectpkg.BagView{}, activeTarget)
		}
		bag := owner.providerState.Lookup(providerRef)
		if bag.Present() {
			change := owner.providerState.Edit(providerRef, false)
			change.BindFieldDefs(compiledStateFieldsForProvider(compiled, bagOwner, providerRef, owner.instances.Providers()))
			bag = change.View()
		}
		context := providerFormulaContextFromBag(bag, activeTarget)
		if compiled.HasProviderElapsedReads || compiled.HasFiniteModifierExpiry {
			context = withProviderElapsed(context, owner.instances.Providers(), providerRef, at, compiled.Providers)
		}
		return context
	}
}
