package effect

import (
	"fmt"
	"math"
	"strconv"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// RestoreProviders 从输入快照恢复效果实例和独立嵌套状态；返回空属性解析器，跨角色挂载由执行协调完成。
func RestoreProviders(snapshot []model.CombatantProviderSnapshot, combatantKey string, compiled planbundle.CompiledSession, combatantKeys map[string]bool, path string, schemaHash, rulesHash, sessionID string) (ProviderList, AttributeResolver, *model.EngineError) {
	// Resolver stays empty here; cross-combatant mounts happen in remountAllProviderModifiers.
	resolver := AttributeResolver{}
	if len(snapshot) == 0 {
		return ProviderList{}, resolver, nil
	}
	instances := ProviderList{}
	seenRefs := map[string]bool{}
	seenSourceTargets := map[string]bool{}
	for i, snap := range snapshot {
		p := path + ".providers[" + strconv.FormatUint(uint64(uint32(i)), 10) + "]"
		defIdx, ok := FindProviderDefinitionIndex(compiled, snap.DefinitionRef)
		if !ok {
			if len(snap.StatusContributions) > 0 || snap.ModifierSnapshots != nil {
				return ProviderList{}, resolver, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider definition with statusContributions", p+".definitionRef", snap.DefinitionRef, schemaHash, rulesHash, sessionID)
			}
			continue
		}
		provider := compiled.Providers[defIdx]
		strictIdentity := (provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse()) || provider.NeedsElapsedTime
		if strictIdentity {
			invalid := func(field, message string) *model.EngineError {
				return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, p+"."+field, snap.ProviderRef, schemaHash, rulesHash, sessionID)
			}
			if snap.Source == "" || !combatantKeys[snap.Source] {
				return ProviderList{}, resolver, invalid("source", "source_target snapshot requires the actual source combatant")
			}
			if snap.Owner != combatantKey {
				return ProviderList{}, resolver, invalid("owner", "source_target snapshot owner must equal its recipient combatant")
			}
			if snap.ProviderRef == "" {
				return ProviderList{}, resolver, invalid("providerRef", "source_target snapshot requires an explicit instance reference")
			}
			if snap.Stacks != 1 {
				return ProviderList{}, resolver, invalid("stacks", "source_target snapshot must have exactly one stack")
			}
			if provider.ShieldDefinitionRef == "" && (snap.ExpireAt == nil || *snap.ExpireAt <= 0) {
				return ProviderList{}, resolver, invalid("expireAt", "source_target snapshot requires a positive expiry timestamp")
			}
			identity := snap.DefinitionRef + "\x00" + snap.Source + "\x00" + snap.Owner
			if seenSourceTargets[identity] {
				return ProviderList{}, resolver, invalid("providerRef", "duplicate source_target snapshot instance")
			}
			seenSourceTargets[identity] = true
		}
		if priorStrict, duplicate := seenRefs[snap.ProviderRef]; duplicate && (priorStrict || strictIdentity) {
			return ProviderList{}, resolver, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "duplicate providerRef involving a source_target instance", p+".providerRef", snap.ProviderRef, schemaHash, rulesHash, sessionID)
		}
		seenRefs[snap.ProviderRef] = strictIdentity
		owner := snap.Owner
		if owner == "" {
			owner = combatantKey
		}
		source := snap.Source
		if source == "" {
			source = owner
		}
		expireAt := int64(0)
		if snap.ExpireAt != nil && *snap.ExpireAt > 0 {
			expireAt = *snap.ExpireAt
		}
		if len(provider.StatusContributions) > 0 && expireAt <= 0 {
			return ProviderList{}, resolver, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "status contribution duration must be positive", p+".expireAt", snap.ProviderRef, schemaHash, rulesHash, sessionID)
		}
		state := snap.State
		if state == nil {
			state = map[string]interface{}{}
		}
		contribs, err := restoreStatusContributions(snap, provider, p, schemaHash, rulesHash, sessionID)
		if err != nil {
			return ProviderList{}, resolver, err
		}
		snapshots, snapshotErr := restoreModifierSnapshots(snap, provider, p, schemaHash, rulesHash, sessionID)
		if snapshotErr != nil {
			return ProviderList{}, resolver, snapshotErr
		}
		inst := Provider{
			ModifierSnapshots:   model.BorrowNumericView(snapshots),
			ProviderRef:         snap.ProviderRef,
			DefinitionRef:       snap.DefinitionRef,
			Source:              source,
			Owner:               owner,
			Stacks:              snap.Stacks,
			ExpireAt:            expireAt,
			State:               ObjectState(state),
			DefinitionIndex:     defIdx,
			StatusContributions: contribs,
		}
		if snap.AppliedAtMs != nil {
			inst.AppliedAtMs, inst.HasAppliedAt = *snap.AppliedAtMs, true
		}
		if inst.Stacks <= 0 {
			inst.Stacks = 1
		}
		instances = instances.Append(inst)
	}
	return instances, resolver, nil
}

// RestoreShields 按原顺序恢复正余量护盾；输入状态独立复制，缺失或无有效盾时保留缺失集合。
func RestoreShields(snapshot []model.CombatantShieldSnapshot, combatantKey string) ShieldList {
	if len(snapshot) == 0 {
		return ShieldList{}
	}
	out := ShieldList{}
	for i, snap := range snapshot {
		ref := snap.ShieldRef
		if ref == "" {
			ref = fmt.Sprintf("shield#%d", i+1)
		}
		owner := snap.Owner
		if owner == "" {
			owner = combatantKey
		}
		source := snap.Source
		if source == "" {
			source = owner
		}
		expireAt := int64(0)
		if snap.ExpireAt != nil && *snap.ExpireAt > 0 {
			expireAt = *snap.ExpireAt
		}
		state := snap.State
		if state == nil {
			state = map[string]interface{}{}
		}
		if snap.Remaining > 0 {
			out = out.Append(Shield{
				ShieldRef:            ref,
				DefinitionRef:        snap.DefinitionRef,
				LifecycleProviderRef: snap.LifecycleProviderRef,
				Source:               source,
				Owner:                owner,
				Remaining:            snap.Remaining,
				Priority:             snap.Priority,
				ExpireAt:             expireAt,
				State:                ObjectState(state),
			})
		}
	}
	return out
}

// FindProviderDefinitionIndex 在只读计划中查找完整效果定义引用，返回实际编号及存在标记。
func FindProviderDefinitionIndex(compiled planbundle.CompiledSession, definitionRef string) (uint16, bool) {
	for i, p := range compiled.Providers {
		if p.ProviderKey == definitionRef {
			return uint16(i), true
		}
	}
	return 0, false
}

// ProvidersToSnapshot 按实例原顺序导出独立快照；嵌套状态、贡献与冻结金额不借出可写存储。
func ProvidersToSnapshot(instances ProviderList) []model.CombatantProviderSnapshot {
	if !instances.Present() {
		return []model.CombatantProviderSnapshot{}
	}
	out := make([]model.CombatantProviderSnapshot, 0, instances.Len())
	for instanceIndex, instanceValues := 0, instances; instanceIndex < instanceValues.Len(); instanceIndex++ {
		inst := instanceValues.At(instanceIndex)
		state := inst.State.ToMap()
		if state == nil {
			state = map[string]interface{}{}
		}
		source := inst.Source
		if source == "" {
			source = inst.Owner
		}
		snap := model.CombatantProviderSnapshot{
			ProviderRef:         inst.ProviderRef,
			DefinitionRef:       inst.DefinitionRef,
			Source:              source,
			Owner:               inst.Owner,
			Stacks:              inst.Stacks,
			ExpireAt:            expireAtPtr(inst.ExpireAt),
			State:               state,
			StatusContributions: contributionsToSnapshot(inst.StatusContributions),
			AppliedAtMs:         providerAppliedAtPtr(inst),
		}
		if inst.ModifierSnapshots.Present() {
			snap.ModifierSnapshots = inst.ModifierSnapshots.ToMap()
		}
		out = append(out, snap)
	}
	return out
}

// ShieldsToSnapshot 按护盾原顺序导出独立快照；缺失集合沿协议转换为显式空列表。
func ShieldsToSnapshot(instances ShieldList) []model.CombatantShieldSnapshot {
	if !instances.Present() {
		return []model.CombatantShieldSnapshot{}
	}
	out := make([]model.CombatantShieldSnapshot, 0, instances.Len())
	for instanceIndex, instanceValues := 0, instances; instanceIndex < instanceValues.Len(); instanceIndex++ {
		sh := instanceValues.At(instanceIndex)
		state := sh.State.ToMap()
		if state == nil {
			state = map[string]interface{}{}
		}
		source := sh.Source
		if source == "" {
			source = sh.Owner
		}
		out = append(out, model.CombatantShieldSnapshot{
			ShieldRef:            sh.ShieldRef,
			DefinitionRef:        sh.DefinitionRef,
			LifecycleProviderRef: sh.LifecycleProviderRef,
			Source:               source,
			Owner:                sh.Owner,
			Remaining:            sh.Remaining,
			Priority:             sh.Priority,
			ExpireAt:             expireAtPtr(sh.ExpireAt),
			State:                state,
		})
	}
	return out
}

func expireAtPtr(expireAt int64) *int64 {
	if expireAt <= 0 {
		return nil
	}
	v := expireAt
	return &v
}

func contributionsToSnapshot(items ContributionView) []model.ProviderStatusContributionSnapshot {
	if items.Len() == 0 {
		return nil
	}
	out := make([]model.ProviderStatusContributionSnapshot, 0, items.Len())
	for instanceIndex, instanceValues := 0, items; instanceIndex < instanceValues.Len(); instanceIndex++ {
		item := instanceValues.At(instanceIndex)
		strength := item.Strength
		out = append(out, model.ProviderStatusContributionSnapshot{
			ResultRef:  item.ResultRef,
			StatusKey:  item.StatusKey,
			StatusKind: item.StatusKind,
			Strength:   &strength,
		})
	}
	return out
}

func restoreStatusContributions(snap model.CombatantProviderSnapshot, provider planbundle.CompiledProvider, path string, schemaHash, rulesHash, sessionID string) (ContributionView, *model.EngineError) {
	defs := provider.StatusContributions
	raw := snap.StatusContributions
	if len(defs) == 0 && len(raw) == 0 {
		return ContributionView{}, nil
	}
	if len(defs) == 0 {
		return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "provider snapshot has statusContributions but definition has none", path+".statusContributions", snap.ProviderRef, schemaHash, rulesHash, sessionID)
	}
	if len(raw) != len(defs) {
		return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "provider snapshot statusContributions must align with definition", path+".statusContributions", snap.ProviderRef, schemaHash, rulesHash, sessionID)
	}
	byRef := map[string]int{}
	out := ContributionView{}
	for i, item := range raw {
		p := path + ".statusContributions[" + strconv.FormatUint(uint64(uint32(i)), 10) + "]"
		if item.ResultRef == "" {
			return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "status contribution resultRef is required", p+".resultRef", snap.ProviderRef, schemaHash, rulesHash, sessionID)
		}
		if prev, dup := byRef[item.ResultRef]; dup {
			_ = prev
			return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "duplicate status contribution resultRef", p+".resultRef", item.ResultRef, schemaHash, rulesHash, sessionID)
		}
		byRef[item.ResultRef] = i
		def, ok := findCompiledStatusContribution(defs, item.ResultRef)
		if !ok {
			return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "status contribution resultRef is not in definition", p+".resultRef", item.ResultRef, schemaHash, rulesHash, sessionID)
		}
		if item.StatusKey != def.StatusKey {
			return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "status contribution statusKey does not match definition", p+".statusKey", item.StatusKey, schemaHash, rulesHash, sessionID)
		}
		if item.StatusKind != def.StatusKind {
			return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "status contribution statusKind does not match definition", p+".statusKind", item.StatusKind, schemaHash, rulesHash, sessionID)
		}
		if item.Strength == nil {
			return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "status contribution strength is required; explicit zero is allowed", p+".strength", item.ResultRef, schemaHash, rulesHash, sessionID)
		}
		strength := *item.Strength
		if math.IsNaN(strength) || math.IsInf(strength, 0) || strength < 0 || strength > 1 {
			return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "status contribution strength must be finite and within [0,1]", p+".strength", item.ResultRef, schemaHash, rulesHash, sessionID)
		}
		out = out.Append(StatusContribution{
			ResultRef:  item.ResultRef,
			StatusKey:  item.StatusKey,
			StatusKind: item.StatusKind,
			Strength:   strength,
		})
	}
	for _, def := range defs {
		if _, ok := byRef[def.ResultRef]; !ok {
			return ContributionView{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "provider snapshot missing status contribution", path+".statusContributions", def.ResultRef, schemaHash, rulesHash, sessionID)
		}
	}
	return out, nil
}

func findCompiledStatusContribution(defs []planbundle.CompiledStatusContribution, resultRef string) (planbundle.CompiledStatusContribution, bool) {
	for _, def := range defs {
		if def.ResultRef == resultRef {
			return def, true
		}
	}
	return planbundle.CompiledStatusContribution{}, false
}

func restoreModifierSnapshots(snapshot model.CombatantProviderSnapshot, provider planbundle.CompiledProvider, path, schema, rules, session string) (map[string]float64, *model.EngineError) {
	invalid := func(message string) (map[string]float64, *model.EngineError) {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, path+".modifierSnapshots", snapshot.ProviderRef, schema, rules, session)
	}
	if !provider.HasModifierSnapshots {
		if snapshot.ModifierSnapshots != nil {
			return invalid("unmarked provider cannot restore modifier snapshots")
		}
		return nil, nil
	}
	if snapshot.Source == snapshot.Owner || snapshot.ModifierSnapshots == nil {
		return invalid("snapshot provider requires actual distinct participants and all frozen values")
	}
	expected := 0
	for _, modifier := range provider.Modifiers {
		if modifier.ValueReadMode != "APPLICATION_SNAPSHOT" {
			continue
		}
		expected++
		value, present := snapshot.ModifierSnapshots[modifier.ModifierKey]
		if !present || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return invalid("snapshot provider has a missing or invalid frozen value")
		}
		if modifier.ValuePolicy == "multiply" && value != modifier.StaticValue {
			return invalid("static snapshot multiplier differs from its compiled definition")
		}
	}
	if len(snapshot.ModifierSnapshots) != expected {
		return invalid("snapshot provider contains unknown frozen modifier keys")
	}
	return CloneFloatMap(snapshot.ModifierSnapshots), nil
}

func providerAppliedAtPtr(inst Provider) *int64 {
	if !inst.HasAppliedAt {
		return nil
	}
	value := inst.AppliedAtMs
	return &value
}
