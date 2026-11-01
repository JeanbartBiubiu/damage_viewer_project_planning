package continuation

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// Identity 仅提供重复请求失败时的真实规则和会话身份。
type Identity struct{ SchemaHash, RulesHash, SessionID string }

// RegisterRepeat 在原操作位置检查重复范围、拥有者和默认次数，再暂存真实请求。
// 复制尾部不产生新的重复请求；失败不影响已发布的前序帧。
func (p *Pending) RegisterRepeat(c *Collector, op planbundle.CompiledOperation, owner, provider string, identity Identity) *model.EngineError {
	if c == nil || c.Phantom() {
		return nil
	}
	if op.RepeatScope != model.RepeatScopeCopyableOnHit {
		return repeatError(identity, model.GenericErrMissingRequiredField, "repeat requires repeatScope="+model.RepeatScopeCopyableOnHit)
	}
	if provider == "" {
		return repeatError(identity, model.GenericErrRuntimeInvariantFailed, "repeat requires owning provider context")
	}
	count := op.RepeatCount
	if count <= 0 {
		count = 1
	}
	p.repeats = append(p.repeats, RepeatRequest{
		OwnerCombatantKey: owner, OwnerProviderRef: provider, TriggerStateKey: op.TriggerStateKey,
		Threshold: op.Threshold, RepeatCount: count, RepeatScope: op.RepeatScope,
		RepeatTag: op.RepeatTag, RepeatDelayMs: op.RepeatDelayMs,
	})
	return nil
}

func repeatError(identity Identity, code model.GenericErrCode, message string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, code, message)
	err.SchemaHash, err.RulesHash, err.SessionID = identity.SchemaHash, identity.RulesHash, identity.SessionID
	return &err
}
