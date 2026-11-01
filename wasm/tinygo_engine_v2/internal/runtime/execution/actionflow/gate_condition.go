package actionflow

import (
	"encoding/json"
	"sort"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// GateConditions 只在原读值位置准备驱动与能力条件，后项不复用前项上下文。
type GateConditions interface {
	// DriverGateCondition 从已准备的真实双方数值读取本次驱动条件。
	DriverGateCondition(program formula.GenericProgramID) (float64, *model.EngineError)
	// AbilityGateCondition 按原能力独立准备来源状态并返回是否阻挡。
	AbilityGateCondition() (bool, *model.EngineError)
}

func (s SkillActionExecutor) ConditionGate(index int, ability planbundle.CompiledAbility, reads GateConditions) (bool, *model.EngineError) {
	if program, present := s.actions.DriverCondition(index); present {
		value, err := reads.DriverGateCondition(program)
		if err != nil {
			return false, err
		}
		if value == 0 {
			return true, nil
		}
	}
	if ability.HasCastCondition {
		return reads.AbilityGateCondition()
	}
	return false, nil
}

// GateProviderOwner 按原门禁实际双方解析来源拥有者，返回是否具有可解析的来源引用。
func GateProviderOwner(ref, source, target string) (string, string, bool) {
	parsed, valid := planbundle.ParseAbilityRef(ref)
	if !valid {
		return source, "", false
	}
	owner := source
	switch parsed.Combatant {
	case model.SelectorSource, model.SelectorSelf, "":
	case model.SelectorTarget:
		owner = target
	case model.SelectorOpponent:
		if source == model.SelectorSource {
			owner = model.SelectorTarget
		} else if source == model.SelectorTarget {
			owner = model.SelectorSource
		} else {
			owner = target
		}
	default:
		owner = parsed.Combatant
	}
	return owner, parsed.ProviderRef, true
}

// MaterializeCooldowns 按原排序从恢复输入建立所属普通冷却账，保留原容错与有效零语义。
func MaterializeCooldowns(raw map[string]interface{}, owner string) *actionpkg.CooldownLedger {
	ledger := actionpkg.NewCooldownLedger()
	keys := make([]string, 0, len(raw))
	for key := range raw {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if ready := ParseCooldownReadyAt(raw[key]); ready > 0 {
			ledger.Set(actionpkg.AbilityCooldownIdentity(owner, key), ready, 0)
		}
	}
	return ledger
}

// ParseCooldownReadyAt 读取既有恢复期限格式，缺失或原不支持格式保持返回0。
func ParseCooldownReadyAt(value interface{}) int64 {
	switch number := value.(type) {
	case float64:
		return int64(number)
	case int64:
		return number
	case int:
		return int64(number)
	case json.Number:
		if result, err := number.Int64(); err == nil {
			return result
		}
	case map[string]interface{}:
		if raw, present := number["readyAtMs"]; present {
			return ParseCooldownReadyAt(raw)
		}
	}
	return 0
}
