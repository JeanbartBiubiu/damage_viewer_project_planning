package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type MarkContact struct {
	UseRef, Source, SkillKey string
	Blocked                  bool
}

type MarkConsumption struct {
	Contact       MarkContact
	Deadline      int64
	DamageBlocked bool
	DamageID      uint64
	Operation     plan.CompiledOperation
}

type MarkInput struct {
	Operation                           plan.CompiledOperation
	Ability                             plan.CompiledAbility
	Owner, Provider, AbilityRef, Target string
	Now                                 int64
}

// MarkExecution 只在当前专用操作中同步组合命中事实、数值操作和预算，不创建子帧或提交。
type MarkExecution interface {
	// MarkContact 取得当前真实监听的命中身份，由命中所有者核对原始使用和接触，不复制冻结上下文。
	MarkContact(abilityRef, kind string) (MarkContact, *model.EngineError)
	// MarkState 借用该实际拥有者和实例在当前操作点准备的状态袋。
	MarkState(owner, provider string) effectpkg.BagView
	// MarkAmount 在当前操作点按原能力上下文求值，保留实时数值变化与错误归属。
	MarkAmount(operation plan.CompiledOperation, ability plan.CompiledAbility) (float64, *model.EngineError)
	// MarkSpellShields 借用当前目标真实生效的法术盾，不替调用者选择多盾优先级。
	MarkSpellShields(target string) effectpkg.ProviderList
	// ConsumeMarkCommand 只消费当前真实事件/同步链的一个命令额度。
	ConsumeMarkCommand() *model.EngineError
	// ClearMark 在同帧运行原状态清除操作，不发布、不另建帧。
	ClearMark(operation plan.CompiledOperation, ability plan.CompiledAbility) *model.EngineError
	// BlockMarkDamage 组合当前真实冻结命中与阻挡事实，暂存原法术盾事件。
	BlockMarkDamage(operation plan.CompiledOperation, ability plan.CompiledAbility, shield effectpkg.Provider)
	// SettleMarkDamage 在同帧运行一笔真实伤害并返回新增逐伤数量与真实编号。
	SettleMarkDamage(operation plan.CompiledOperation, ability plan.CompiledAbility, amount float64) (int, uint64, *model.EngineError)
	// RestoreMarkResource 在伤害或阻挡之后，同帧运行原资源恢复操作。
	RestoreMarkResource(operation plan.CompiledOperation, ability plan.CompiledAbility, amount float64) *model.EngineError
	// RecordMarkConsumption 只暂存成功完成的标记消耗事实及统计，等待真实帧提交。
	RecordMarkConsumption(consumption MarkConsumption)
}

func (e *Executor) ConsumeTargetMark(input MarkInput, execution MarkExecution) *model.EngineError {
	op, ability := input.Operation, input.Ability
	mark := op.TargetMark
	if mark == nil || mark.Clear == nil || mark.Damage == nil || op.Target != "target" ||
		input.Provider != mark.OwnerProviderRef || input.Owner != mark.OwnerCombatantKey ||
		int(ability.ProviderIndex) != op.OwnerProviderIndex || ability.Kind != "passive_listener" {
		return e.invariant(op.Path, "target mark requires its actual complete owner listener payload", "")
	}
	contact, err := execution.MarkContact(mark.TriggerAbilityRef, mark.TriggerKind)
	if err != nil {
		return err
	}
	if mark.TriggerKind == model.EventTypeSkillHit && contact.Blocked {
		return nil
	}
	bag := execution.MarkState(mark.OwnerCombatantKey, mark.OwnerProviderRef)
	if !bag.Present() || bag.TargetKey() != input.Target || bag.TargetValues().At(mark.StateKey) == 0 {
		return nil
	}
	value, deadline := bag.TargetValues().At(mark.StateKey), bag.TargetExpireAt().At(mark.StateKey)
	if value != 1 || deadline <= 0 {
		return e.invariant(op.Path, "active target mark requires the exact value 1 and a real deadline", "")
	}
	if deadline <= input.Now {
		return nil
	}
	amount, err := execution.MarkAmount(*mark.Damage, ability)
	if err != nil {
		return err
	}
	if amount < 0 {
		return e.invariant(op.Path, "target mark damage amount must be nonnegative", "")
	}
	shields := execution.MarkSpellShields(input.Target)
	if shields.Len() > 1 {
		return e.invariant(op.Path, "multiple active spell_shield instances have no nominated priority", "")
	}
	if err := execution.ConsumeMarkCommand(); err != nil {
		return err
	}
	if err := execution.ClearMark(*mark.Clear, ability); err != nil {
		return err
	}
	consumption := MarkConsumption{Contact: contact, Deadline: deadline, DamageBlocked: shields.Len() == 1, Operation: op}
	if consumption.DamageBlocked {
		execution.BlockMarkDamage(op, ability, shields.At(0))
	} else {
		if err := execution.ConsumeMarkCommand(); err != nil {
			return err
		}
		count, damageID, err := execution.SettleMarkDamage(*mark.Damage, ability, amount)
		if err != nil {
			return err
		}
		if count != 1 {
			return e.invariant(op.Path, "target mark damage did not create one real settlement", "")
		}
		consumption.DamageID = damageID
	}
	if mark.Restore != nil {
		if err := execution.ConsumeMarkCommand(); err != nil {
			return err
		}
		restore, err := execution.MarkAmount(*mark.Restore, ability)
		if err != nil {
			return err
		}
		if restore < 0 {
			return e.invariant(op.Path, "target mark restore amount must be nonnegative", "")
		}
		if err := execution.RestoreMarkResource(*mark.Restore, ability, restore); err != nil {
			return err
		}
	}
	execution.RecordMarkConsumption(consumption)
	return nil
}
