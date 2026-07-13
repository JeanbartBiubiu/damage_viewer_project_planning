// ValuePipeline：damage/heal/shield 统一解析入口（D1 最小实现，E1 扩展 priority shield）。
package pipeline

import (
	"math"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/model"
	shieldpkg "tinygo_engine_v2/internal/shield"
)

// ShieldInstance 是 pipeline 可见的护盾视图（兼容 D1 测试）。
type ShieldInstance struct {
	Remaining float64
	ExpireAt  int64
	Priority  int16
	ShieldRef string
	Source    string
	Owner     string
	State     map[string]interface{}
}

// CombatantView 是 pipeline 可见的 combatant 属性/护盾视图。
type CombatantView struct {
	Attributes map[string]model.AttributeSlotDef
	Shields    []ShieldInstance
}

// DamageOutcome 记录 damage 经 pipeline 后的分解。
// Amount 口径：MitigatedAmount = 抗性后、护盾前；HPDamage 经护盾与 HP clipping。
type DamageOutcome struct {
	RawAmount       float64
	MitigatedAmount float64
	TotalAmount     float64 // 兼容别名：等于 MitigatedAmount（summary / Result.Amount）
	ShieldAbsorbed  float64
	HPDamage        float64
}

// ExecuteOutcome 记录 execute_threshold 经 pipeline 后的非伤害结果。
// Execute 绕过 shield：Shields 原样保留；唯一 HP 置零入口。
type ExecuteOutcome struct {
	HPBefore       float64
	Killed         bool
	ShieldBypassed bool
	Applied        bool
}

var damageResolver = resolveDamage

// ResolveCommand 将 command 路由到对应 pipeline 函数。
func ResolveCommand(cmd command.Command, view CombatantView, nowMs int64) (command.Result, CombatantView) {
	switch cmd.Kind {
	case command.KindDamage:
		outcome, next := damageResolver(cmd, view, nowMs)
		return command.Result{
			Kind:    cmd.Kind,
			Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0,
			Amount:  outcome.MitigatedAmount,
		}, next
	case command.KindHeal:
		attrs, healed := ResolveHeal(cmd, view.Attributes)
		view.Attributes = attrs
		return command.Result{Kind: cmd.Kind, Applied: healed > 0, Amount: healed}, view
	case command.KindShield:
		view = ResolveShield(cmd, view, nowMs)
		return command.Result{Kind: cmd.Kind, Applied: cmd.Amount > 0, Amount: cmd.Amount}, view
	case command.KindExecuteThreshold:
		outcome, next := ResolveExecuteThreshold(cmd, view)
		return command.Result{Kind: cmd.Kind, Applied: outcome.Applied, Amount: 0}, next
	default:
		return command.Result{Kind: cmd.Kind, Applied: false, Message: "unsupported"}, view
	}
}

// ResolveExecuteThreshold 将 live target HP 置 0；不折算 shield、不产生 damage。
// live HP <= 0 时跳过（Applied=false），shield 保持不变。
// 只改 Current（经 SetHP）；ReadHP 读 hp.current，Base/Resolved 可保留给属性 refresh。
func ResolveExecuteThreshold(cmd command.Command, view CombatantView) (ExecuteOutcome, CombatantView) {
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

func resolveDamage(cmd command.Command, view CombatantView, nowMs int64) (DamageOutcome, CombatantView) {
	raw := cmd.Amount
	if raw <= 0 || math.IsNaN(raw) || math.IsInf(raw, 0) {
		return DamageOutcome{}, view
	}
	mitigated, ok := applyTargetResistance(raw, cmd.DamageType, view.Attributes)
	if !ok || math.IsNaN(mitigated) || math.IsInf(mitigated, 0) || mitigated < 0 {
		// Unknown damage type or non-finite mitigation: do not commit partial state.
		return DamageOutcome{}, view
	}
	remaining := mitigated
	var absorbed float64
	shields := shieldInstancesFromView(view.Shields, nowMs)
	shieldpkg.SortByPriority(shields)
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
		shields[i].Remaining -= take
		absorbed += take
		remaining -= take
	}
	view.Shields = shieldsToView(shieldpkg.RemoveExpired(shields, nowMs))
	before := attribute.ReadHP(view.Attributes)
	after := before - remaining
	if after < 0 {
		after = 0
	}
	view.Attributes = attribute.SetHP(view.Attributes, after)
	return DamageOutcome{
		RawAmount:       raw,
		MitigatedAmount: mitigated,
		TotalAmount:     mitigated,
		ShieldAbsorbed:  absorbed,
		HPDamage:        before - after,
	}, view
}

// applyTargetResistance applies LoL-style resistance. Source penetration is intentionally ignored.
// Returns ok=false for unknown damage types (must be rejected at compile; refuse silent true/raw).
func applyTargetResistance(amount float64, damageType string, attrs map[string]model.AttributeSlotDef) (float64, bool) {
	switch damageType {
	case "physical", "damage/physical":
		return mitigateByResistance(amount, resolvedAttr(attrs, "armor")), true
	case "magic", "damage/magic", "magical", "damage/magical":
		return mitigateByResistance(amount, resolvedAttr(attrs, "magic_resist")), true
	case "true", "damage/true":
		return amount, true
	default:
		return 0, false
	}
}

func mitigateByResistance(amount, r float64) float64 {
	if r >= 0 {
		return amount * 100 / (100 + r)
	}
	return amount * (2 - 100/(100-r))
}

// resolvedAttr returns slot.Resolved when key exists (0 is a legal value after modifiers).
// Missing key (or nil attrs) returns 0 — do not fall back to Current.
func resolvedAttr(attrs map[string]model.AttributeSlotDef, key string) float64 {
	if attrs == nil {
		return 0
	}
	slot, ok := attrs[key]
	if !ok {
		return 0
	}
	return slot.Resolved
}

// ResolveHeal 增加 HP 并 clamp max。
func ResolveHeal(cmd command.Command, attrs map[string]model.AttributeSlotDef) (map[string]model.AttributeSlotDef, float64) {
	attrs, healed := attribute.ApplyHeal(attrs, cmd.Amount)
	return attrs, healed
}

// ResolveShield 创建护盾实例。
func ResolveShield(cmd command.Command, view CombatantView, nowMs int64) CombatantView {
	if cmd.Amount <= 0 {
		return view
	}
	ref := cmd.Ref
	if ref == "" {
		ref = "shield:auto"
	}
	view.Shields = append(view.Shields, ShieldInstance{
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

func shieldInstancesFromView(viewShields []ShieldInstance, nowMs int64) []shieldpkg.Instance {
	if len(viewShields) == 0 {
		return nil
	}
	out := make([]shieldpkg.Instance, 0, len(viewShields))
	for _, s := range viewShields {
		inst := shieldpkg.Instance{
			ShieldRef: s.ShieldRef,
			Source:    s.Source,
			Owner:     s.Owner,
			Remaining: s.Remaining,
			Priority:  s.Priority,
			ExpireAt:  s.ExpireAt,
			State:     s.State,
		}
		if inst.Remaining <= 0 || inst.Expired(nowMs) {
			continue
		}
		out = append(out, inst)
	}
	return out
}

func shieldsToView(instances []shieldpkg.Instance) []ShieldInstance {
	if len(instances) == 0 {
		return nil
	}
	out := make([]ShieldInstance, 0, len(instances))
	for _, inst := range instances {
		out = append(out, ShieldInstance{
			ShieldRef: inst.ShieldRef,
			Source:    inst.Source,
			Owner:     inst.Owner,
			Remaining: inst.Remaining,
			Priority:  inst.Priority,
			ExpireAt:  inst.ExpireAt,
			State:     inst.State,
		})
	}
	return out
}

// ShieldsFromRuntime 将 runtime shield 列表转为 pipeline 视图。
func ShieldsFromRuntime(instances []shieldpkg.Instance, nowMs int64) []ShieldInstance {
	active := shieldpkg.ActiveInstances(instances, nowMs)
	return shieldsToView(active)
}

// RuntimeShieldsFromView 将 pipeline 视图转为 runtime shield 列表。
// 若视图条目缺少 source/owner，则回退到传入的 frame source 与 combatant owner。
func RuntimeShieldsFromView(viewShields []ShieldInstance, owner, source string) []shieldpkg.Instance {
	if len(viewShields) == 0 {
		return nil
	}
	out := make([]shieldpkg.Instance, 0, len(viewShields))
	for _, s := range viewShields {
		src := s.Source
		if src == "" {
			src = source
		}
		own := s.Owner
		if own == "" {
			own = owner
		}
		state := s.State
		if state == nil {
			state = map[string]interface{}{}
		}
		out = append(out, shieldpkg.Instance{
			ShieldRef: s.ShieldRef,
			Source:    src,
			Owner:     own,
			Remaining: s.Remaining,
			Priority:  s.Priority,
			ExpireAt:  s.ExpireAt,
			State:     state,
		})
	}
	return out
}
