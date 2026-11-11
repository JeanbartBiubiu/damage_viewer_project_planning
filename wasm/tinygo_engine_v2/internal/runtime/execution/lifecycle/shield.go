package lifecycle

import (
	"errors"
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
)

type ShieldExpiry struct {
	CombatantKey, ShieldRef string
	ExpireAt                int64
}

type ShieldProjection struct {
	Mutations []Mutation
	Expiry    ShieldExpiry
	Changed   bool
}

func (e *Executor) LinkedShieldPresent(index uint16, provider, owner string, instances effectpkg.ProviderList, shields effectpkg.ShieldList, mutations []Mutation, now int64) (float64, error) {
	if int(index) >= len(e.compiled.Providers) || provider == "" {
		return 0, errors.New("linked shield presence requires a bound actual provider")
	}
	definition := e.compiled.Providers[index]
	origin, _, found := instances.Find(provider)
	if !found || origin.Expired(now) || origin.Owner != owner || origin.Source == "" || definition.ShieldDefinitionRef == "" {
		return 0, errors.New("linked shield presence provider does not own the compiled definition")
	}
	for shieldIndex := 0; shieldIndex < shields.Len(); shieldIndex++ {
		shield := shields.At(shieldIndex)
		if shield.DefinitionRef != definition.ShieldDefinitionRef || shield.Source != origin.Source || shield.Owner != origin.Owner ||
			shield.LifecycleProviderRef == "" || shield.Remaining <= 0 || shield.ExpireAt > 0 && shield.ExpireAt <= now {
			continue
		}
		instance, _, alive := instances.Find(shield.LifecycleProviderRef)
		alive = alive && !instance.Expired(now) && instance.DefinitionIndex == index && instance.Source == shield.Source && instance.Owner == shield.Owner && instance.ExpireAt == shield.ExpireAt
		for _, mutation := range mutations {
			if mutation.ProviderRef != shield.LifecycleProviderRef {
				continue
			}
			if mutation.Kind == "shield_apply" {
				alive = mutation.DefinitionIndex == index && mutation.SourceKey == shield.Source && mutation.TargetKey == shield.Owner && mutation.ExpireAt == shield.ExpireAt
			}
			if mutation.Kind == "expire" {
				alive = false
			}
		}
		if alive {
			return 1, nil
		}
	}
	return 0, nil
}

func (e *Executor) BindLinkedShield(op plan.CompiledOperation, amount float64) (plan.CompiledProvider, *model.EngineError) {
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		return plan.CompiledProvider{}, e.invariant(op.Path, "linked shield amount must be finite and non-negative", op.ShieldRef)
	}
	if int(op.ShieldLifecycleProviderIndex) >= len(e.compiled.Providers) {
		return plan.CompiledProvider{}, e.invariant(op.Path, "linked shield provider is not bound", op.ShieldRef)
	}
	provider := e.compiled.Providers[op.ShieldLifecycleProviderIndex]
	if provider.ShieldDefinitionRef != op.ShieldRef || op.ShieldRef == "" {
		return plan.CompiledProvider{}, e.invariant(op.Path, "linked shield definition does not match its provider", op.ShieldRef)
	}
	return provider, nil
}

func (e *Executor) ShieldDuration(op plan.CompiledOperation, context formula.GenericEvalContext, now int64) (int64, *model.EngineError) {
	path := "shieldDurationMs"
	if int(op.ShieldDurationProgram) < e.formulas.Metadata.Count() {
		path = e.formulas.Metadata.Info(formula.GenericProgramID(op.ShieldDurationProgram)).Key
	}
	value, err := e.formulas.Evaluation.EvalContext(op.ShieldDurationProgram, &context)
	if err != nil {
		return 0, evaluation.PreserveFormulaIssue(err, e.fail(model.GenericErrFormulaTypeError, path, err.Error(), op.ShieldRef), "")
	}
	if !formula.ValidPositiveInt64DurationMs(value) {
		return 0, e.fail(model.GenericErrFormulaTypeError, path, "shieldDurationMs must be a positive integer within the timestamp range", op.ShieldRef)
	}
	deadline := now + int64(value)
	if now > math.MaxInt64-int64(value) || deadline <= now {
		return 0, e.fail(model.GenericErrFormulaTypeError, path, "shieldDurationMs expiry overflows the timestamp range", op.ShieldRef)
	}
	return deadline, nil
}

func (e *Executor) StageLinkedShield(op plan.CompiledOperation, provider plan.CompiledProvider, source, target string, amount float64, expires, now int64, context formula.GenericEvalContext, instances *effectpkg.InstanceChangeSet, mutations []Mutation) (ShieldProjection, *model.EngineError) {
	if provider.Lifecycle != nil && provider.Lifecycle.HasDuration {
		deadline, err := e.preparedDuration(provider, context, now)
		if err != nil {
			return ShieldProjection{}, err
		}
		if deadline != expires {
			return ShieldProjection{}, e.invariant(op.Path, "linked shield and provider must have the same expiry", op.ShieldRef)
		}
	}
	var contributions effectpkg.ContributionView
	if len(provider.StatusContributions) > 0 {
		if expires <= now {
			return ShieldProjection{}, e.invariant(op.Path, "linked status contributions require a positive shield duration", op.ShieldRef)
		}
		var err *model.EngineError
		contributions, err = e.preparedStatus(provider, context)
		if err != nil {
			return ShieldProjection{}, err
		}
	}
	kept := instances.Shields().Slice(0, 0)
	for index, shields := 0, instances.Shields(); index < shields.Len(); index++ {
		old := shields.At(index)
		if old.LifecycleProviderRef != "" && old.DefinitionRef == op.ShieldRef && old.Source == source && old.Owner == target {
			mutations, _ = StageShieldRemoval(mutations, target, old.LifecycleProviderRef)
			continue
		}
		kept = kept.Append(old)
	}
	instances.SetShields(kept)
	out := ShieldProjection{Mutations: mutations}
	// 显式零仍替换旧盾；只有正数盾会建立新身份和关联。
	if amount == 0 {
		return out, nil
	}
	shieldRef := e.identities.NextShield(op.ShieldRef)
	providerRef := e.identities.NextProvider(provider.ProviderKey)
	instances.SetShields(instances.Shields().Append(effectpkg.Shield{ShieldRef: shieldRef, DefinitionRef: op.ShieldRef,
		LifecycleProviderRef: providerRef, Source: source, Owner: target, Remaining: amount, ExpireAt: expires,
		State: effectpkg.ObjectState(map[string]interface{}{})}))
	out.Mutations = append(out.Mutations, Mutation{Kind: "shield_apply", DefinitionIndex: op.ShieldLifecycleProviderIndex,
		DefinitionRef: provider.ProviderKey, ProviderRef: providerRef, SourceKey: source, TargetKey: target,
		ExpireAt: expires, HasExpireAt: expires > 0, Contributions: contributions})
	out.Changed = true
	if expires > 0 {
		out.Expiry = ShieldExpiry{CombatantKey: target, ShieldRef: shieldRef, ExpireAt: expires}
	}
	return out, nil
}

// StageShieldRemoval 只追加一次关联实例移除操作，实际发布仍由原帧处理。
func StageShieldRemoval(mutations []Mutation, owner, ref string) ([]Mutation, bool) {
	if ref == "" {
		return mutations, false
	}
	for _, mutation := range mutations {
		if mutation.Kind == "expire" && mutation.ProviderRef == ref {
			return mutations, false
		}
	}
	return append(mutations, Mutation{Kind: "expire", ProviderRef: ref, TargetKey: owner}), true
}

// PrepareShieldRemovals 在预检前清理反向关联，并为耗尽或同帧耗尽的新盾暂存卸载，不发布状态。
func PrepareShieldRemovals(owner string, instances *effectpkg.InstanceChangeSet, committed effectpkg.ShieldList, mutations []Mutation, now int64) ([]Mutation, bool) {
	changed := false
	for _, mutation := range mutations {
		if mutation.Kind != "expire" {
			continue
		}
		kept := instances.Shields().Slice(0, 0)
		for index, shields := 0, instances.Shields(); index < shields.Len(); index++ {
			shield := shields.At(index)
			if shield.LifecycleProviderRef != mutation.ProviderRef {
				kept = kept.Append(shield)
			}
		}
		instances.SetShields(kept)
	}
	has := func(ref string) bool {
		for index, shields := 0, instances.Shields(); index < shields.Len(); index++ {
			shield := shields.At(index)
			if shield.LifecycleProviderRef == ref && shield.Remaining > 0 && (shield.ExpireAt <= 0 || shield.ExpireAt > now) {
				return true
			}
		}
		return false
	}
	for index := 0; index < committed.Len(); index++ {
		shield := committed.At(index)
		if shield.LifecycleProviderRef != "" && !has(shield.LifecycleProviderRef) {
			var appended bool
			mutations, appended = StageShieldRemoval(mutations, owner, shield.LifecycleProviderRef)
			changed = changed || appended
		}
	}
	for index := 0; index < len(mutations); index++ {
		mutation := mutations[index]
		if mutation.Kind == "shield_apply" && !has(mutation.ProviderRef) {
			var appended bool
			mutations, appended = StageShieldRemoval(mutations, owner, mutation.ProviderRef)
			changed = changed || appended
		}
	}
	return mutations, changed
}
