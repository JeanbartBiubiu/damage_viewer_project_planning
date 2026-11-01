package admission

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// ValidateReceivedShieldInitialSnapshot 校验原始初始快照中的真实自身父挂载。
// 仅接受原初始化器能够创建关联盾的完整新场景，不安装实例或补齐恢复身份。
func ValidateReceivedShieldInitialSnapshot(compiled *planbundle.CompiledSession, snapshot model.Snapshot, sessionID string) *model.EngineError {
	if !compiled.HasReceivedShieldReads {
		return nil
	}
	input := Input{Compiled: compiled, Identity: Identity{SchemaHash: compiled.SchemaHash, RulesHash: compiled.RulesHash, SessionID: sessionID}}
	if snapshot.TimeMs != 0 {
		return receivedShieldInitialError(input, "received shield absorption requires a fresh initialized scene", "")
	}
	for _, shield := range compiled.Providers {
		if !shield.HasReceivedShieldBinding {
			continue
		}
		parent := int(shield.ReceivedShieldParentIndex)
		if parent >= len(compiled.Providers) {
			return receivedShieldInitialError(input, "received shield parent binding is invalid", shield.ProviderKey)
		}
		for _, actor := range compiled.Combatants {
			mountRef, count := "", 0
			for _, mount := range actor.ProviderMounts {
				if int(mount.DefinitionIndex) == parent {
					mountRef, count = mount.ProviderRef, count+1
				}
			}
			if count == 0 {
				continue
			}
			if count != 1 {
				return receivedShieldInitialError(input, "received shield parent mount is ambiguous", mountRef)
			}
			actors, parents := 0, 0
			for _, actorSnapshot := range snapshot.Combatants {
				if actorSnapshot.Key != actor.Key {
					continue
				}
				actors++
				for _, instance := range actorSnapshot.Providers {
					if instance.DefinitionRef == shield.ProviderKey {
						return receivedShieldInitialError(input, "received shield instance must be created by its real initializer", instance.ProviderRef)
					}
					if instance.DefinitionRef != compiled.Providers[parent].ProviderKey && instance.ProviderRef != mountRef {
						continue
					}
					parents++
					if instance.DefinitionRef != compiled.Providers[parent].ProviderKey || instance.ProviderRef != mountRef || instance.Source != actor.Key || instance.Owner != actor.Key || instance.Stacks != 1 || instance.ExpireAt != nil || len(instance.State) != 0 {
						return receivedShieldInitialError(input, "received shield requires its explicit unchanged actual self parent", instance.ProviderRef)
					}
				}
				for _, instance := range actorSnapshot.Shields {
					if instance.DefinitionRef == shield.ShieldDefinitionRef {
						return receivedShieldInitialError(input, "received shield restoration is not authorized", instance.ShieldRef)
					}
					if instance.ShieldRef == "" || instance.Source == "" || instance.Owner != actor.Key {
						return receivedShieldInitialError(input, "received shield facts require explicit initial shield identities", instance.ShieldRef)
					}
				}
			}
			if actors != 1 || parents != 1 {
				return receivedShieldInitialError(input, "received shield parent is missing or duplicated in the initial snapshot", mountRef)
			}
		}
	}
	return nil
}

func receivedShieldInitialError(input Input, message, ref string) *model.EngineError {
	out := fail(input, message, "initialSnapshot.combatants.providers")
	out.Ref = ref
	return out
}
