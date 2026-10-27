// ValuePipeline：damage/heal/shield 统一解析入口（D1 最小实现，E1 扩展 priority shield）。
package pipeline

import (
	"math"

	"tinygo_engine_v2/internal/base/attribute"
)

// CombatantView 是 pipeline 可见的 combatant 属性/护盾视图。
type CombatantView struct {
	Attributes attribute.Table
	Shields    []ShieldInstance
}

// DamageOutcome 记录 damage 经 pipeline 后的分解。
// Amount 口径：MitigatedAmount = 抗性后、护盾前；HPDamage 经护盾与 HP clipping。
type DamageOutcome struct {
	ShieldAbsorptions *ShieldAbsorptionSnapshot
	RawAmount         float64
	MitigatedAmount   float64
	TotalAmount       float64 // 兼容别名：等于 MitigatedAmount（summary / Result.Amount）
	ShieldAbsorbed    float64
	HPDamage          float64
}

// ExecuteOutcome 记录 execute_threshold 经 pipeline 后的非伤害结果。
// Execute 绕过 shield：Shields 原样保留；唯一 HP 置零入口。
type ExecuteOutcome struct {
	HPBefore       float64
	Killed         bool
	ShieldBypassed bool
	Applied        bool
}

// ResolveCommand 路由治疗、护盾与斩杀；伤害只能使用已结算金额入口。
func ResolveCommand(cmd Command, view CombatantView, nowMs int64) (CommandResult, CombatantView) {
	switch cmd.Kind {
	case KindHeal:
		attrs, healed := ResolveHeal(cmd, view.Attributes)
		view.Attributes = attrs
		return CommandResult{Kind: cmd.Kind, Applied: healed > 0, Amount: healed}, view
	case KindShield:
		view = ResolveShield(cmd, view, nowMs)
		return CommandResult{Kind: cmd.Kind, Applied: cmd.Amount > 0, Amount: cmd.Amount}, view
	case KindExecuteThreshold:
		outcome, next := ResolveExecuteThreshold(cmd, view)
		return CommandResult{Kind: cmd.Kind, Applied: outcome.Applied, Amount: 0}, next
	default:
		return CommandResult{Kind: cmd.Kind, Applied: false, Message: "unsupported"}, view
	}
}

// ResolveExecuteThreshold 将 live target HP 置 0；不折算 shield、不产生 damage。
// live HP <= 0 时跳过（Applied=false），shield 保持不变。
// 只改 Current（经 SetHP）；ReadHP 读 hp.current，Base/Resolved 可保留给属性 refresh。
func ResolveExecuteThreshold(cmd Command, view CombatantView) (ExecuteOutcome, CombatantView) {
	before := attribute.ReadHP(view.Attributes)
	if before <= 0 || math.IsNaN(before) || math.IsInf(before, 0) {
		return ExecuteOutcome{HPBefore: before, Applied: false}, view
	}
	view.Attributes = attribute.SetHP(view.Attributes, 0)
	return ExecuteOutcome{
		HPBefore:       before,
		Killed:         true,
		ShieldBypassed: true,
		Applied:        true,
	}, view
}

// ApplyMitigatedDamage applies shields then HP from a post-resistance amount.
// RawAmount in the outcome is the pre-resistance raw; MitigatedAmount is the post-modifier mitigated value.
func ApplyMitigatedDamage(raw, mitigated float64, view CombatantView, nowMs int64, captureShieldAbsorptions bool) (DamageOutcome, CombatantView) {
	remaining := mitigated
	var absorbed float64
	var snapshot *ShieldAbsorptionSnapshot
	if captureShieldAbsorptions {
		snapshot = &ShieldAbsorptionSnapshot{Rows: []ShieldAbsorption{}}
	}
	shields := ActiveShields(view.Shields, nowMs)
	SortShields(shields)
	for i := range shields {
		if remaining <= 0 {
			break
		}
		if shields[i].Remaining <= 0 {
			continue
		}
		take := remaining
		if take > shields[i].Remaining {
			take = shields[i].Remaining
		}
		before := shields[i].Remaining
		shields[i].Remaining -= take
		if snapshot != nil && take > 0 {
			sh := shields[i]
			snapshot.Rows = append(snapshot.Rows, ShieldAbsorption{ShieldRef: sh.ShieldRef,
				DefinitionRef: sh.DefinitionRef, LifecycleProviderRef: sh.LifecycleProviderRef,
				Source: sh.Source, Owner: sh.Owner, RemainingBefore: before,
				RemainingAfter: sh.Remaining, Absorbed: take, ExpireAt: sh.ExpireAt})
		}
		absorbed += take
		remaining -= take
	}
	view.Shields = removeExpiredShields(shields, nowMs)
	before := attribute.ReadHP(view.Attributes)
	after := before - remaining
	if after < 0 {
		after = 0
	}
	view.Attributes = attribute.SetHP(view.Attributes, after)
	return DamageOutcome{
		ShieldAbsorptions: snapshot,
		RawAmount:         raw,
		MitigatedAmount:   mitigated,
		TotalAmount:       mitigated,
		ShieldAbsorbed:    absorbed,
		HPDamage:          before - after,
	}, view
}

// ResolveHeal 增加 HP 并 clamp max。
func ResolveHeal(cmd Command, attrs attribute.Table) (attribute.Table, float64) {
	attrs, healed := attribute.ApplyHeal(attrs, cmd.Amount)
	return attrs, healed
}

// ResolveShield 创建护盾实例。
func ResolveShield(cmd Command, view CombatantView, nowMs int64) CombatantView {
	if cmd.Amount <= 0 {
		return view
	}
	ref := cmd.Ref
	if ref == "" {
		ref = "shield:auto"
	}
	shields := make([]ShieldInstance, len(view.Shields), len(view.Shields)+1)
	copy(shields, view.Shields)
	view.Shields = append(shields, ShieldInstance{
		ShieldRef: ref,
		Source:    cmd.Source,
		Owner:     cmd.Target,
		Remaining: cmd.Amount,
		ExpireAt:  0,
		Priority:  0,
		State:     map[string]interface{}{},
	})
	_ = nowMs
	return view
}
