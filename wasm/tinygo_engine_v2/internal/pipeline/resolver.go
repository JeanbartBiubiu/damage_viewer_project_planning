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
	Mitigation      MitigationResult
}

// MitigationResult 暴露 source-aware 抗性/穿透结算细节（供 evidence 与调用方复用）。
type MitigationResult struct {
	Amount                      float64
	ResistanceBeforePenetration float64
	PenetrationPercent          float64
	PenetrationFlat             float64
	EffectiveResistance         float64
	ResistanceFactor            float64
}

// ExecuteOutcome 记录 execute_threshold 经 pipeline 后的非伤害结果。
// Execute 绕过 shield：Shields 原样保留；唯一 HP 置零入口。
type ExecuteOutcome struct {
	HPBefore       float64
	Killed         bool
	ShieldBypassed bool
	Applied        bool
}

type damageResolveFunc func(cmd command.Command, view CombatantView, sourceAttrs map[string]model.AttributeSlotDef, nowMs int64) (DamageOutcome, CombatantView)

var damageResolver damageResolveFunc = resolveDamageWithSource

// ResolveCommand 将 command 路由到对应 pipeline 函数（无 source penetration，兼容旧调用）。
func ResolveCommand(cmd command.Command, view CombatantView, nowMs int64) (command.Result, CombatantView) {
	result, next, _ := ResolveCommandWithSource(cmd, view, nil, nowMs)
	return result, next
}

// ResolveCommandWithSource 与 ResolveCommand 相同，但对 damage 使用 sourceAttrs 的穿透。
// sourceAttrs 为 nil/空时与无穿透兼容路径一致。
func ResolveCommandWithSource(cmd command.Command, view CombatantView, sourceAttrs map[string]model.AttributeSlotDef, nowMs int64) (command.Result, CombatantView, MitigationResult) {
	switch cmd.Kind {
	case command.KindDamage:
		outcome, next := damageResolver(cmd, view, sourceAttrs, nowMs)
		return command.Result{
			Kind:    cmd.Kind,
			Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0,
			Amount:  outcome.MitigatedAmount,
		}, next, outcome.Mitigation
	case command.KindHeal:
		attrs, healed := ResolveHeal(cmd, view.Attributes)
		view.Attributes = attrs
		return command.Result{Kind: cmd.Kind, Applied: healed > 0, Amount: healed}, view, MitigationResult{}
	case command.KindShield:
		view = ResolveShield(cmd, view, nowMs)
		return command.Result{Kind: cmd.Kind, Applied: cmd.Amount > 0, Amount: cmd.Amount}, view, MitigationResult{}
	case command.KindExecuteThreshold:
		outcome, next := ResolveExecuteThreshold(cmd, view)
		return command.Result{Kind: cmd.Kind, Applied: outcome.Applied, Amount: 0}, next, MitigationResult{}
	default:
		return command.Result{Kind: cmd.Kind, Applied: false, Message: "unsupported"}, view, MitigationResult{}
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

// resolveDamage 无 source penetration 的兼容入口（测试与旧调用）。
func resolveDamage(cmd command.Command, view CombatantView, nowMs int64) (DamageOutcome, CombatantView) {
	return resolveDamageWithSource(cmd, view, nil, nowMs)
}

func resolveDamageWithSource(cmd command.Command, view CombatantView, sourceAttrs map[string]model.AttributeSlotDef, nowMs int64) (DamageOutcome, CombatantView) {
	raw := cmd.Amount
	if raw <= 0 || math.IsNaN(raw) || math.IsInf(raw, 0) {
		return DamageOutcome{}, view
	}
	mitigation, ok := MitigateRawDamageWithSource(raw, cmd.DamageType, view.Attributes, sourceAttrs)
	if !ok {
		return DamageOutcome{}, view
	}
	outcome, next := ApplyMitigatedDamage(raw, mitigation.Amount, view, nowMs)
	outcome.Mitigation = mitigation
	return outcome, next
}

// MitigateRawDamage applies target resistance without source penetration (compat wrapper).
// ok=false means unknown damage type or non-finite mitigation.
func MitigateRawDamage(raw float64, damageType string, attrs map[string]model.AttributeSlotDef) (mitigated float64, ok bool) {
	res, ok := MitigateRawDamageWithSource(raw, damageType, attrs, nil)
	return res.Amount, ok
}

// MitigateRawDamageWithSource applies target resistance with optional source penetration.
// Percent then flat; percent clamped to [0,1]; negative flat ignored; positive base resistance
// floored at 0 after penetration; non-positive base resistance unchanged (existing negative formula).
// True damage bypasses resistance/penetration (factor 1, pen fields zero).
func MitigateRawDamageWithSource(raw float64, damageType string, targetAttrs, sourceAttrs map[string]model.AttributeSlotDef) (MitigationResult, bool) {
	if raw <= 0 || math.IsNaN(raw) || math.IsInf(raw, 0) {
		return MitigationResult{}, false
	}
	res, ok := applyTargetResistanceWithSource(raw, damageType, targetAttrs, sourceAttrs)
	if !ok || math.IsNaN(res.Amount) || math.IsInf(res.Amount, 0) || res.Amount < 0 {
		return MitigationResult{}, false
	}
	return res, true
}

// ApplyMitigatedDamage applies shields then HP from a post-resistance amount.
// RawAmount in the outcome is the pre-resistance raw; MitigatedAmount is the post-modifier mitigated value.
func ApplyMitigatedDamage(raw, mitigated float64, view CombatantView, nowMs int64) (DamageOutcome, CombatantView) {
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

// applyTargetResistanceWithSource applies LoL-style resistance with optional source penetration.
// Returns ok=false for unknown damage types (must be rejected at compile; refuse silent true/raw).
func applyTargetResistanceWithSource(amount float64, damageType string, targetAttrs, sourceAttrs map[string]model.AttributeSlotDef) (MitigationResult, bool) {
	switch damageType {
	case "physical", "damage/physical":
		base := resolvedAttr(targetAttrs, "armor")
		pct := firstFiniteResolved(sourceAttrs,
			"armor_pen_percent", "armor_pen_pct", "physical_pen_percent", "physical_pen_pct")
		flat := firstFiniteResolved(sourceAttrs,
			"armor_pen_flat", "physical_pen", "physical_pen_flat", "lethality")
		return mitigateWithPenetration(amount, base, pct, flat), true
	case "magic", "damage/magic", "magical", "damage/magical":
		base := resolvedAttr(targetAttrs, "magic_resist")
		pct := firstFiniteResolved(sourceAttrs, "magic_pen_percent", "magic_pen_pct")
		flat := firstFiniteResolved(sourceAttrs, "magic_pen_flat", "magic_pen")
		return mitigateWithPenetration(amount, base, pct, flat), true
	case "true", "damage/true":
		return MitigationResult{
			Amount:                      amount,
			ResistanceBeforePenetration: 0,
			PenetrationPercent:          0,
			PenetrationFlat:             0,
			EffectiveResistance:         0,
			ResistanceFactor:            1,
		}, true
	default:
		return MitigationResult{}, false
	}
}

func mitigateWithPenetration(amount, baseResist, percentPen, flatPen float64) MitigationResult {
	pct := clampUnitInterval(percentPen)
	flat := flatPen
	if flat < 0 || math.IsNaN(flat) || math.IsInf(flat, 0) {
		flat = 0
	}
	effective := baseResist
	if baseResist > 0 {
		effective = baseResist * (1 - pct)
		if flat > 0 {
			effective -= flat
		}
		if effective < 0 {
			effective = 0
		}
	}
	mitigated := mitigateByResistance(amount, effective)
	factor := 0.0
	if amount > 0 {
		factor = mitigated / amount
	}
	return MitigationResult{
		Amount:                      mitigated,
		ResistanceBeforePenetration: baseResist,
		PenetrationPercent:          pct,
		PenetrationFlat:             flat,
		EffectiveResistance:         effective,
		ResistanceFactor:            factor,
	}
}

func mitigateByResistance(amount, r float64) float64 {
	if r >= 0 {
		return amount * 100 / (100 + r)
	}
	return amount * (2 - 100/(100-r))
}

func clampUnitInterval(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// firstFiniteResolved returns the first finite Resolved among aliases; missing/non-finite skipped.
func firstFiniteResolved(attrs map[string]model.AttributeSlotDef, keys ...string) float64 {
	if attrs == nil {
		return 0
	}
	for _, key := range keys {
		slot, ok := attrs[key]
		if !ok {
			continue
		}
		v := slot.Resolved
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		return v
	}
	return 0
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
