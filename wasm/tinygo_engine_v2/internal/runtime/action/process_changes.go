package action

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (c *ProcessChangeSet) EnterEmpowered(step planbundle.CompiledProcessStep, now, deadline int64) {
	c.EnterStep(0, step, now)
	c.SetTiming(now, &deadline)
	if step.MaximumAttackCount > 0 {
		c.view.data.snapshot.EmpoweredAttackWindow = &model.ProcessEmpoweredAttackWindow{MaximumAttackCount: step.MaximumAttackCount, Consumptions: make([]model.ProcessAttackConsumption, 0, step.MaximumAttackCount)}
	}
}
func (c *ProcessChangeSet) SetEmpoweredAttack(association *model.ProcessEmpoweredAttack) {
	if association == nil {
		c.view.data.snapshot.EmpoweredAttack = nil
		return
	}
	copy := *association
	copy.ReplacedPrimary = cloneOptional(copy.ReplacedPrimary)
	c.view.data.snapshot.EmpoweredAttack = &copy
}
func (c *ProcessChangeSet) ReserveEmpowered(use, target string, now int64) (int, bool) {
	window := c.view.data.snapshot.EmpoweredAttackWindow
	if window.ConsumptionCount >= window.MaximumAttackCount {
		return 0, false
	}
	window.ConsumptionCount++
	window.PendingHitCount++
	window.Consumptions = append(window.Consumptions, model.ProcessAttackConsumption{ConsumptionIndex: window.ConsumptionCount, UseRef: use, Target: target, StartedAtMs: now})
	return window.ConsumptionCount - 1, true
}
func (c *ProcessChangeSet) ResolveEmpowered(index int, now int64, hit string, sequence int) {
	window := c.view.data.snapshot.EmpoweredAttackWindow
	row := &window.Consumptions[index]
	row.ResolvedAtMs = cloneOptional(&now)
	row.HitRef = cloneOptional(&hit)
	row.HitSequence = cloneOptional(&sequence)
	window.PendingHitCount--
}
func (c *ProcessChangeSet) ReconcileOccupancy(previous *ProcessView, now int64) bool {
	pending := c.View()
	owner := pending.Owner()
	before, after := previous.OccupiesAction(owner), pending.OccupiesAction(owner)
	changed := previous != nil && previous.StepVersion() != pending.StepVersion()
	if before && (!after || changed) {
		items := c.view.data.snapshot.ActionOccupancies
		last := len(items) - 1
		if last < 0 || items[last].StepVersion != previous.StepVersion() || items[last].FinishedAtMs != nil {
			return false
		}
		items[last].FinishedAtMs = cloneOptional(&now)
	}
	if after && (!before || changed) {
		r := &c.view.data.snapshot
		r.ActionOccupancies = append(r.ActionOccupancies, model.ProcessActionOccupancy{StepKey: r.StepKey, StepVersion: r.StepVersion, StartedAtMs: r.StepStartedAtMs, ExpectedEndAtMs: pending.ActionDeadline()})
	}
	return true
}
func (c *ProcessChangeSet) AdvanceRepeat(now int64) (bool, bool) {
	p := c.View()
	repeat := c.view.data.snapshot.Repeat
	if repeat.ExecutionIndex >= repeat.ExecutionCount || repeat.NextExecutionAtMs == nil || *repeat.NextExecutionAtMs != now {
		return false, false
	}
	repeat.ExecutionIndex++
	repeat.NextExecutionAtMs = nil
	if repeat.ExecutionIndex < repeat.ExecutionCount {
		next := p.StepStartedAtMs() + p.RepeatOffset(repeat.ExecutionIndex)
		repeat.NextExecutionAtMs = &next
	}
	return repeat.NextExecutionAtMs != nil || (p.Definition().Steps[p.StepIndex()].StepType == "CHANNEL" && *p.data.snapshot.ExpiresAtMs > now), true
}
