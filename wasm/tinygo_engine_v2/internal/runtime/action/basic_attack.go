package action

import (
	"strconv"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

type BasicAttackView struct{ data *basicAttackData }

type basicAttackData struct {
	primary                       *model.BasicAttackPrimaryIdentity
	primaryCandidate              int
	primaryHitPlan                *planbundle.CompiledSkillHit
	replacementSlots              []primaryReplacementSlot
	ammo                          *AmmoView
	plan                          model.BasicAttackPlan
	summary                       model.BasicAttackSummary
	current                       *AttackRecordView
	currentRecordIndex            int
	targetKilledAt                *int64
	unfinishedTail, windowSettled bool
	initialAbility                planbundle.CompiledAbility
	wait                          *AttackWaitView
	cooldownDependencies          []formula.GenericInstr
}

type primaryReplacementSlot struct {
	binding uint16
	target  string
	index   int
}

type BasicAttackSeed struct {
	Plan                 model.BasicAttackPlan
	InitialAbility       planbundle.CompiledAbility
	CooldownDependencies []formula.GenericInstr
	Ammo                 *AmmoView
}

type AttackRecordView struct{ data *model.BasicAttackRecord }

func (s *State) InitBasicAttack(seed BasicAttackSeed) {
	s.basicAttack = &BasicAttackView{data: &basicAttackData{plan: seed.Plan, summary: model.BasicAttackSummary{PlanKey: seed.Plan.PlanKey}, initialAbility: seed.InitialAbility, cooldownDependencies: seed.CooldownDependencies, ammo: seed.Ammo, currentRecordIndex: -1}}
}
func (s *State) BasicAttack() *BasicAttackView                        { return s.basicAttack }
func (s *State) SetBasicAmmo(ammo *AmmoView)                          { s.basicAttack.data.ammo = ammo }
func (b *BasicAttackView) Plan() model.BasicAttackPlan                { return b.data.plan }
func (b *BasicAttackView) InitialAbility() planbundle.CompiledAbility { return b.data.initialAbility }
func (b *BasicAttackView) Ammo() *AmmoView                            { return b.data.ammo }
func (b *BasicAttackView) Current() *AttackRecordView                 { return b.data.current }
func (b *BasicAttackView) CurrentRecordIndex() int                    { return b.data.currentRecordIndex }
func (b *BasicAttackView) Wait() *AttackWaitView                      { return b.data.wait }
func (b *BasicAttackView) UnfinishedTail() bool                       { return b.data.unfinishedTail }
func (b *BasicAttackView) WindowSettled() bool                        { return b.data.windowSettled }
func (b *BasicAttackView) StartedCount() int                          { return b.data.summary.StartedCount }
func (b *BasicAttackView) HitCount() int                              { return b.data.summary.HitCount }
func (b *BasicAttackView) CompletedCount() int                        { return b.data.summary.CompletedCount }
func (b *BasicAttackView) HasTargetKilled() bool                      { return b.data.targetKilledAt != nil }
func (b *BasicAttackView) TargetKilledAt() *int64                     { return cloneOptional(b.data.targetKilledAt) }
func (b *BasicAttackView) Summary() model.BasicAttackSummary {
	v := b.data.summary
	v.InitialActionReadyAtMs = cloneOptional(v.InitialActionReadyAtMs)
	v.InitialMechanicReadyAtMs = cloneOptional(v.InitialMechanicReadyAtMs)
	v.PrimaryReplacements = append([]model.BasicAttackPrimaryReplacement(nil), v.PrimaryReplacements...)
	return v
}
func (b *BasicAttackView) HasPrimary() bool { return b.data.primary != nil }
func (b *BasicAttackView) Primary() *model.BasicAttackPrimaryIdentity {
	return cloneOptional(b.data.primary)
}
func (b *BasicAttackView) PrimaryProviderRef() string                   { return b.data.primary.ProviderRef }
func (b *BasicAttackView) PrimaryCandidate() int                        { return b.data.primaryCandidate }
func (b *BasicAttackView) PrimaryHitPlan() *planbundle.CompiledSkillHit { return b.data.primaryHitPlan }
func (b *BasicAttackView) CooldownDependencyCount() int                 { return len(b.data.cooldownDependencies) }
func (b *BasicAttackView) CooldownDependencyAt(index int) formula.GenericInstr {
	return b.data.cooldownDependencies[index]
}
func (b *BasicAttackView) Replacement(binding uint16, target string) (model.BasicAttackPrimaryReplacement, bool) {
	for _, slot := range b.data.replacementSlots {
		if slot.binding == binding && slot.target == target {
			return b.data.summary.PrimaryReplacements[slot.index], true
		}
	}
	return model.BasicAttackPrimaryReplacement{}, false
}
func (s *State) BindPrimary(index int, plan *planbundle.CompiledSkillHit, identity model.BasicAttackPrimaryIdentity) {
	b := s.basicAttack.data
	b.primaryCandidate, b.primaryHitPlan = index, plan
	b.primary = &identity
}
func (s *State) CommitPrimaryReplacement(row model.BasicAttackPrimaryReplacement, binding uint16) {
	b := s.basicAttack.data
	for _, slot := range b.replacementSlots {
		if slot.binding != binding || slot.target != row.Target {
			continue
		}
		v := &b.summary.PrimaryReplacements[slot.index]
		v.Count += row.Count
		v.BlockedCount += row.BlockedCount
		v.PostDefenseDamage += row.PostDefenseDamage
		v.ShieldAbsorbed += row.ShieldAbsorbed
		v.ActualHpLoss += row.ActualHpLoss
		return
	}
	b.replacementSlots = append(b.replacementSlots, primaryReplacementSlot{binding: binding, target: row.Target, index: len(b.summary.PrimaryReplacements)})
	b.summary.PrimaryReplacements = append(b.summary.PrimaryReplacements, row)
}

func (s *State) BeginAttack(now int64, speed float64) (string, string, string) {
	b := s.basicAttack.data
	b.wait = nil
	b.summary.StartedCount++
	index := b.summary.StartedCount
	use := "basic:" + b.plan.PlanKey + ":" + strconv.Itoa(index)
	b.current = &AttackRecordView{data: &model.BasicAttackRecord{PlanKey: b.plan.PlanKey, AttackIndex: index, UseRef: use, Source: b.plan.Source, Target: b.plan.Target, SkillKey: b.plan.SkillKey, StartAtMs: now, AttackSpeed: speed}}
	b.unfinishedTail = true
	return use, use + ":start", use + ":hit"
}
func (s *State) SetAttackRecordIndex(index int) { s.basicAttack.data.currentRecordIndex = index }
func (s *State) SetAttackActive(active bool)    { s.basicAttackEventActive = active }
func (s *State) AttackActive() bool             { return s.basicAttackEventActive }
func (s *State) MarkAttackHit(use string, now int64) {
	if b := s.basicAttack; b != nil && b.data.current != nil && b.data.current.data.UseRef == use && b.data.current.data.HitAtMs == nil {
		b.data.current.data.HitAtMs = cloneOptional(&now)
		b.data.summary.HitCount++
	}
}
func (s *State) FinishAttackRecord(sourceHP, targetHP float64) {
	r := s.basicAttack.data.current.data
	r.SourceHpAfter, r.TargetHpAfter = sourceHP, targetHP
}
func (s *State) CompleteAttack() {
	b := s.basicAttack.data
	b.current.data.Completed = true
	b.summary.CompletedCount++
	b.unfinishedTail = false
}
func (s *State) SetAttackWait(wait *AttackWaitView)  { s.basicAttack.data.wait = wait }
func (s *State) SetAttackWindowSettled(settled bool) { s.basicAttack.data.windowSettled = settled }
func (s *State) SetInitialActionReady(at *int64) {
	s.basicAttack.data.summary.InitialActionReadyAtMs = cloneOptional(at)
}
func (s *State) SetInitialMechanicReady(at *int64) {
	s.basicAttack.data.summary.InitialMechanicReadyAtMs = cloneOptional(at)
}
func (s *State) SetAttackReady(at int64) {
	s.basicAttack.data.current.data.ReadyAtMs = cloneOptional(&at)
}
func (s *State) SetAttackMechanicReady(at int64) {
	s.basicAttack.data.current.data.MechanicReadyAtMs = cloneOptional(&at)
}
func (s *State) SetAttackNext(at *int64) {
	s.basicAttack.data.current.data.NextStartAtMs = cloneOptional(at)
}
func (s *State) SetAttackFinalReady(at int64, actionAt *int64) {
	r := s.basicAttack.data.current.data
	r.FinalReadyAtMs = cloneOptional(&at)
	r.ActionReadyAtMs = cloneOptional(actionAt)
}
func (s *State) ObserveAttackDamage(source, target string, mitigated, hploss, before, after float64, now int64) {
	b := s.basicAttack
	if b == nil {
		return
	}
	d := b.data
	if s.basicAttackEventActive && d.current != nil && source == d.plan.Source && target == d.plan.Target {
		d.current.data.PostDefenseDamage += mitigated
		d.current.data.ActualHpLoss += hploss
	}
	if target == d.plan.Target && before > 0 && after <= 0 && d.targetKilledAt == nil {
		d.targetKilledAt = cloneOptional(&now)
	}
}

func (r *AttackRecordView) UseRef() string             { return r.data.UseRef }
func (r *AttackRecordView) AttackIndex() int           { return r.data.AttackIndex }
func (r *AttackRecordView) Source() string             { return r.data.Source }
func (r *AttackRecordView) Target() string             { return r.data.Target }
func (r *AttackRecordView) StartAtMs() int64           { return r.data.StartAtMs }
func (r *AttackRecordView) Completed() bool            { return r.data.Completed }
func (r *AttackRecordView) PlanKey() string            { return r.data.PlanKey }
func (r *AttackRecordView) SkillKey() string           { return r.data.SkillKey }
func (r *AttackRecordView) AttackSpeed() float64       { return r.data.AttackSpeed }
func (r *AttackRecordView) PostDefenseDamage() float64 { return r.data.PostDefenseDamage }
func (r *AttackRecordView) ActualHpLoss() float64      { return r.data.ActualHpLoss }
func (r *AttackRecordView) SourceHpAfter() float64     { return r.data.SourceHpAfter }
func (r *AttackRecordView) TargetHpAfter() float64     { return r.data.TargetHpAfter }
func (r *AttackRecordView) HitAtMs() *int64            { return cloneOptional(r.data.HitAtMs) }
func (r *AttackRecordView) ReadyAtMs() *int64          { return cloneOptional(r.data.ReadyAtMs) }
func (r *AttackRecordView) FinalReadyAtMs() *int64     { return cloneOptional(r.data.FinalReadyAtMs) }
func (r *AttackRecordView) NextStartAtMs() *int64      { return cloneOptional(r.data.NextStartAtMs) }
func (r *AttackRecordView) ActionReadyAtMs() *int64    { return cloneOptional(r.data.ActionReadyAtMs) }
func (r *AttackRecordView) MechanicReadyAtMs() *int64  { return cloneOptional(r.data.MechanicReadyAtMs) }
func (r *AttackRecordView) HasHit() bool               { return r.data.HitAtMs != nil }
func (r *AttackRecordView) HasReady() bool             { return r.data.ReadyAtMs != nil }
func (r *AttackRecordView) Snapshot() model.BasicAttackRecord {
	v := *r.data
	v.MechanicReadyAtMs = cloneOptional(v.MechanicReadyAtMs)
	v.ActionReadyAtMs = cloneOptional(v.ActionReadyAtMs)
	v.HitAtMs = cloneOptional(v.HitAtMs)
	v.ReadyAtMs = cloneOptional(v.ReadyAtMs)
	v.FinalReadyAtMs = cloneOptional(v.FinalReadyAtMs)
	v.NextStartAtMs = cloneOptional(v.NextStartAtMs)
	return v
}
