package actionflow

import (
	"strconv"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// AttackWaitMutation 是等待预览实际消费的有限效果事实，不具有生命周期发布能力。
type AttackWaitMutation struct {
	Kind, DefinitionRef, ProviderRef, Source string
	Projected                                bool
	DefinitionIndex                          uint16
	ExpireAt                                 int64
}

// AttackProviderPreview 只借用独立等待预览的效果变更，不得修改父操作命令。
type AttackProviderPreview interface {
	// WaitingMutationCount 返回指定真实拥有者在本预览内的效果操作数。
	WaitingMutationCount(owner string) int
	// WaitingMutation 按原序读取单项等待所需事实，不返回可写操作。
	WaitingMutation(owner string, index int) AttackWaitMutation
	// WaitingProviderInstances 借用本预览独立的效果实例变更，借用不超过本次预览。
	WaitingProviderInstances(owner string) *effectpkg.InstanceChangeSet
	// RemoveWaitingProvider 从本预览移除指定原实例、状态及其跨拥有者属性挂载。
	RemoveWaitingProvider(owner, ref string)
	// MountWaitingAttribute 在本预览的实际属性宿主挂载原编译修正，不发布。
	MountWaitingAttribute(owner, ref string, modifier planbundle.CompiledModifier)
	// ResolveWaitingAttributes 按原两遍次序完成属性求值，失败不返回半成品。
	ResolveWaitingAttributes() *model.EngineError
}

func (s BasicAttackExecutor) PreviewProviders(now int64, providers []planbundle.CompiledProvider, work AttackProviderPreview) *model.EngineError {
	attack := s.actions.BasicAttack()
	for _, owner := range []string{attack.Plan().Source, attack.Plan().Target} {
		instances := work.WaitingProviderInstances(owner)
		for index := 0; index < work.WaitingMutationCount(owner); index++ {
			mutation := work.WaitingMutation(owner, index)
			if mutation.Projected {
				continue
			}
			if mutation.Kind == "apply" || mutation.Kind == "shield_apply" {
				definitionIndex, exists := mutation.DefinitionIndex, mutation.Kind == "shield_apply"
				if !exists {
					for candidate, provider := range providers {
						if provider.ProviderKey == mutation.DefinitionRef {
							definitionIndex, exists = uint16(candidate), true
							break
						}
					}
				}
				if !exists {
					return s.error("missing dynamic result definition", mutation.DefinitionRef)
				}
				definition := providers[definitionIndex]
				if mutation.Kind != "shield_apply" && definition.Lifecycle != nil && definition.Lifecycle.AllowsSourceTargetReuse() {
					if current, currentIndex, reused := instances.Providers().FindSourceTarget(mutation.DefinitionRef, mutation.Source, owner, now); reused {
						if definition.NeedsElapsedTime {
							current.AppliedAtMs, current.HasAppliedAt, current.ExpireAt = now, true, mutation.ExpireAt
							instances.ReplaceProvider(currentIndex, current)
						}
						continue
					}
					for instanceIndex, values := 0, instances.Providers(); instanceIndex < values.Len(); instanceIndex++ {
						instance := values.At(instanceIndex)
						if instance.DefinitionRef == mutation.DefinitionRef && instance.Source == mutation.Source && instance.Owner == owner && instance.Expired(now) {
							work.RemoveWaitingProvider(owner, instance.ProviderRef)
						}
					}
				}
				instance := effectpkg.Provider{ProviderRef: mutation.DefinitionRef + "@pending:" + strconv.FormatUint(uint64(uint32(index)), 10), DefinitionRef: mutation.DefinitionRef, DefinitionIndex: definitionIndex, Source: mutation.Source, Owner: owner, Stacks: 1, ExpireAt: mutation.ExpireAt}
				if mutation.Kind == "shield_apply" {
					instance.ProviderRef = mutation.ProviderRef
				}
				if definition.NeedsElapsedTime {
					instance.AppliedAtMs, instance.HasAppliedAt = now, true
				}
				instances.AppendProvider(instance)
				for _, modifier := range definition.Modifiers {
					if modifier.Kind == "attribute" || modifier.Kind == "" {
						work.MountWaitingAttribute(owner, instance.ProviderRef, modifier)
					}
				}
			} else if mutation.Kind == "expire" {
				work.RemoveWaitingProvider(owner, mutation.ProviderRef)
			}
		}
	}
	return work.ResolveWaitingAttributes()
}
