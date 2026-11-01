package lifecycle

import (
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func WithElapsed(ctx pipeline.ProviderFormulaContext, providers effectpkg.ProviderList, providerRef string, nowMs int64, definitions []plan.CompiledProvider) pipeline.ProviderFormulaContext {
	inst, _, found := providers.Find(providerRef)
	if !found || int(inst.DefinitionIndex) >= len(definitions) {
		return ctx
	}
	if definitions[inst.DefinitionIndex].NeedsModifierExpiry && inst.Expired(nowMs) {
		ctx.SkipExpiredAttributeModifier = true
		return ctx
	}
	if !definitions[inst.DefinitionIndex].NeedsElapsedTime {
		return ctx
	}
	if !inst.HasAppliedAt || inst.AppliedAtMs < 0 || inst.AppliedAtMs > nowMs || inst.AppliedAtMs > maxJSONSafeInteger || inst.ExpireAt <= inst.AppliedAtMs {
		return ctx
	}
	// Another event at the same timestamp can resolve attributes before this
	// provider's own cleanup. Its finite effect is already inactive, so do not
	// evaluate its value formula without an active instance context. The original
	// queued cleanup retains ownership of removal, evidence and budget accounting.
	if inst.ExpireAt <= nowMs {
		ctx.SkipExpiredAttributeModifier = true
		return ctx
	}
	ctx.HasProviderElapsed, ctx.ProviderElapsedMs = true, nowMs-inst.AppliedAtMs
	return ctx
}

// The caller already owns the actual instance; no provider lookup or clock default
// can substitute for its recorded application and active finite deadline.
func ActualElapsed(inst effectpkg.Provider, nowMs int64) (int64, bool) {
	if !inst.HasAppliedAt || inst.AppliedAtMs < 0 || inst.AppliedAtMs > nowMs || inst.AppliedAtMs > maxJSONSafeInteger || nowMs > maxJSONSafeInteger || inst.ExpireAt <= nowMs || inst.ExpireAt <= inst.AppliedAtMs {
		return 0, false
	}
	return nowMs - inst.AppliedAtMs, true
}
