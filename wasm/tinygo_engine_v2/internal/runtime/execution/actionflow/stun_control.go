package actionflow

import (
	"sort"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// ControlMutation 是当前同步资格查询借用的有限效果变更，不包含写入或排程能力。
type ControlMutation struct {
	Kind, Definition, Reference, Source, Owner string
	Projected, HasExpiry                       bool
	Expires                                    int64
}

// ProcessStunReads 在提交后读取实际控制，重入标记只覆盖本次同步过程失败收敛。
type ProcessStunReads interface {
	// ProcessStunUntil 返回该拥有方当前实际有限眩晕截止；无控制为0。
	ProcessStunUntil(owner string) (int64, *model.EngineError)
	// ProcessStunSettling 查询同一同步收敛是否已经进入。
	ProcessStunSettling() bool
	// BeginProcessStun 开始有界失败收敛，防止失败帧重入原活动过程。
	BeginProcessStun()
	// EndProcessStun 在当前同步收敛返回时释放标记。
	EndProcessStun()
}

// StunDeadline 从实际拥有方及原顺序暂存变更读取有限眩晕期限，不保留借用或发布状态。
func StunDeadline(owner string, now int64, providers []planbundle.CompiledProvider, instances effectpkg.ProviderList, mutations []ControlMutation) (int64, *model.EngineError) {
	failure := func(ref string) *model.EngineError {
		err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "action stun requires a valid actual owner and finite safe expiry")
		err.Path, err.Ref = "providers", ref
		return &err
	}
	until := int64(0)
	add := func(expiry int64, ref string) *model.EngineError {
		if expiry <= 0 || expiry > maxJSONSafeInteger {
			return failure(ref)
		}
		if expiry > now && expiry > until {
			until = expiry
		}
		return nil
	}
	definition := func(ref string) (planbundle.CompiledProvider, bool) {
		for _, provider := range providers {
			if provider.ProviderKey == ref {
				return provider, true
			}
		}
		return planbundle.CompiledProvider{}, false
	}
	for index := 0; index < instances.Len(); index++ {
		instance := instances.At(index)
		if int(instance.DefinitionIndex) >= len(providers) || instance.Owner != owner || providers[instance.DefinitionIndex].ProviderKey != instance.DefinitionRef {
			return 0, failure(instance.ProviderRef)
		}
		provider := providers[instance.DefinitionIndex]
		if !provider.ActionStun {
			continue
		}
		// 同刻刷新可以延续刚到期的实际实例，存在性由最终期限判断。
		expiry, removed := instance.ExpireAt, false
		for _, mutation := range mutations {
			if mutation.Projected || mutation.Owner != owner {
				continue
			}
			if mutation.Kind == "expire" && mutation.Reference == instance.ProviderRef {
				removed = true
			}
			if mutation.Kind == "refresh" && mutation.Reference == instance.ProviderRef && mutation.HasExpiry {
				expiry = mutation.Expires
			}
			if mutation.Kind == "apply" && mutation.Definition == instance.DefinitionRef && mutation.Source == instance.Source && provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
				removed = true // 新施加的最终期限在下面按真实变更加入。
			}
		}
		if !removed {
			if err := add(expiry, instance.ProviderRef); err != nil {
				return 0, err
			}
		}
	}
	for index, mutation := range mutations {
		if mutation.Projected || mutation.Owner != owner || mutation.Kind != "apply" {
			continue
		}
		provider, exists := definition(mutation.Definition)
		if !exists {
			return 0, failure(mutation.Definition)
		}
		if !provider.ActionStun {
			continue
		}
		replaced := false
		if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
			for _, later := range mutations[index+1:] {
				if !later.Projected && later.Kind == "apply" && later.Owner == owner && later.Source == mutation.Source && later.Definition == mutation.Definition {
					replaced = true
				}
			}
		}
		if !replaced {
			if !mutation.HasExpiry {
				return 0, failure(mutation.Definition)
			}
			if err := add(mutation.Expires, mutation.Definition); err != nil {
				return 0, err
			}
		}
	}
	return until, nil
}

func (s ProcessExecutor) FailStunnedProcesses(now int64, reads ProcessStunReads, phases ProcessPhases) *model.EngineError {
	if reads.ProcessStunSettling() || s.actions.ProcessCount() == 0 {
		return nil
	}
	reads.BeginProcessStun()
	defer reads.EndProcessStun()
	for {
		pending := false
		for i := 0; i < s.actions.ProcessCount(); i++ {
			process := s.actions.ProcessAt(i)
			if !stunInterruptible(process) {
				continue
			}
			until, err := reads.ProcessStunUntil(process.Owner())
			if err != nil {
				return err
			}
			if until > now {
				pending = true
				break
			}
		}
		if !pending {
			return nil
		}
		ordered := s.actions.ProcessViews()
		sort.Slice(ordered, func(i, j int) bool { return ordered[i].StableKey() < ordered[j].StableKey() })
		for _, process := range ordered {
			if !stunInterruptible(process) {
				continue
			}
			until, err := reads.ProcessStunUntil(process.Owner())
			if err != nil {
				return err
			}
			if until > now {
				if err := s.Finish(process, "failed", "CONTROLLED", "", phases); err != nil {
					return err
				}
				if process.Status() == "active" {
					return s.error("processInstances", "controlled process finish did not publish progress", process.UseKey())
				}
			}
		}
		// 同步失败效果可能改变先前实例的控制或新增实例。
		// 每次完成必须发布进展，派生工作仍消费原命令与实例额度。
	}
}

func stunInterruptible(process *actionpkg.ProcessView) bool {
	if process.Status() != "active" || process.StepIndex() < 0 || process.StepIndex() >= len(process.Definition().Steps) {
		return false
	}
	kind := process.Definition().Steps[process.StepIndex()].StepType
	return kind == "CHARGE" || kind == "CHANNEL"
}
