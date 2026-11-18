package actionflow

import (
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

// CooldownOperationInput 是当前真实冷却操作的有限帧身份，不含帧或执行器。
type CooldownOperationInput struct {
	Source, Target, AbilityRef, Owner string
	Mounted                           bool
	Event                             *contract.EventSnapshot
}

// CooldownOperationWork 只借用一个冷却操作的当前金额、所属冷却暂存及实际写入。
type CooldownOperationWork interface {
	CooldownRefundWork
	// CooldownOwnerPresent 核对实际期限所属角色是否存在，不推导缺失拥有者。
	CooldownOwnerPresent(owner string) bool
	// CooldownAmount 在原策略位置使用当前能力和同一帧读值，保留原公式错误。
	CooldownAmount(program formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError)
}

func (s SkillActionExecutor) ApplyCooldown(input CooldownOperationInput, operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, now int64, work CooldownOperationWork) *model.EngineError {
	if operation.OwnCooldownTarget != nil {
		ability = s.abilities[operation.OwnCooldownTarget.AbilityIndex]
	}
	if operation.ValuePolicy == "reduce_total_ratio" {
		return s.ApplyTotalCooldownRefund(operation, ability, input.Mounted, input.Event, input.Owner, now, work)
	}
	ref := input.AbilityRef
	if operation.HasAbilityRef && operation.AbilityRefStr != "" {
		ref = NormalizeAbilityRef(operation.AbilityRefStr, input.Source, input.Target)
	}
	owner := ref
	if index := strings.Index(ref, "."); index > 0 {
		owner = ref[:index]
	}
	if !work.CooldownOwnerPresent(owner) {
		return s.castError(model.GenericErrOperationTargetMissing, "operation target unavailable")
	}
	existing := now
	if current := work.RefundCooldown(owner).AbilityReadyAt(owner, ref); current > 0 {
		existing = current
	}
	ready := now
	switch operation.ValuePolicy {
	case "set_remaining":
		if !operation.HasAmount {
			err := s.error("set_remaining requires amount", "operation.cooldown_change.amount")
			err.Ref = ref
			return err
		}
		duration, err := work.CooldownAmount(operation.AmountProgram, ability)
		if err != nil {
			return err
		}
		var valid bool
		ready, valid = actionpkg.ProcessTimeAfter(now, duration, true)
		if !valid {
			err := s.error("set_remaining requires finite non-negative integer milliseconds and safe timestamp addition", "operation.cooldown_change.amount")
			err.Ref = ref
			return err
		}
	case "reset":
		ready = now
	case "reduce", "refund", "extend":
		if !operation.HasAmount {
			return s.castError(model.GenericErrMissingRequiredField, "cooldown_change requires amount")
		}
		duration, err := work.CooldownAmount(operation.AmountProgram, ability)
		if err != nil {
			return err
		}
		if operation.ValuePolicy == "reduce" {
			milliseconds, valid := actionpkg.ProcessTimeAfter(0, duration, true)
			if !valid {
				err := s.error("reduce requires finite non-negative safe integer milliseconds", "operation.cooldown_change.amount")
				err.Ref = ref
				return err
			}
			if existing <= now || milliseconds >= existing-now {
				ready = now
			} else {
				ready = existing - milliseconds
			}
		} else if operation.ValuePolicy == "extend" {
			base := existing
			if base < now {
				base = now
			}
			ready = base + int64(duration)
		} else {
			ready = existing - int64(duration)
			if ready < now {
				ready = now
			}
		}
	default:
		if operation.HasAmount {
			duration, err := work.CooldownAmount(operation.AmountProgram, ability)
			if err != nil {
				return err
			}
			ready = now + int64(duration)
		}
	}
	if ready < now {
		ready = now
	}
	return work.StageCooldownRefund(owner, ref, ready)
}
