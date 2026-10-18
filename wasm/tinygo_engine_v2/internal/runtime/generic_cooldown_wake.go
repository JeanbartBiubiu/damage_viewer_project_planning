package runtime

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

type pendingCooldownAttempt struct {
	entry int
	wait  genericCooldownWait
}

func whileReadyCooldownWaitKey(owner, entry string) genericCooldownWaitKey {
	return genericCooldownWaitKey{kind: "while_ready", owner: owner, key: entry}
}

// 冷却改期与自动候选在状态发布前预留容量，发布后只执行已通过预检的队列修改。
func (f *executionFrame) prepareCooldownWakeups() (int, *model.EngineError) {
	count := 0
	f.pendingAutomaticWake = f.run.automaticSkills != nil
	if f.pendingAutomaticWake && !f.run.heap.HasAutomaticSkill() {
		count++
	}
	if f.processIsNew && f.pendingProcess != nil {
		if action := f.run.skillActionByUse[f.pendingProcess.UseKey]; action != nil && action.automaticRule != nil {
			if rule := action.automaticRule; rule.predecessor != nil && rule.qualification.RemainingCount != 1 {
				return 0, f.run.processErr("automaticSkills.qualifications", "initial commit requires an unconsumed predecessor qualification", action.useRef)
			}
		}
	}
	f.pendingCooldownAttempts = nil
	f.pendingBasicAttackCooldownWake = false
	f.staged.Range(func(owner string, staged *stagedCombatant) {
		before := f.run.combatants[owner].cooldowns
		for _, wait := range staged.cooldowns.changedWaits(before) {
			if attack := f.run.basicAttack; attack != nil && wait.key == basicAttackCooldownWaitKey(attack) &&
				f.pendingBasicAttackWait == nil && f.pendingAmmoWait == nil && !f.pendingActionWait && f.continuousCombatantsLive() {
				// A reset can invalidate a queued first attack before an attack period exists.
				f.pendingBasicAttackCooldownWake = true
				if !f.run.heap.HasBasicAttack() {
					count++
				}
				continue
			}
			if wait.key.kind != "while_ready" {
				continue
			}
			for index, entry := range f.run.req.DriverPlan.Entries {
				if wait.key.key == entry.EntryKey && f.run.isWhileReady(entry) {
					f.pendingCooldownAttempts = append(f.pendingCooldownAttempts, pendingCooldownAttempt{entry: index, wait: wait})
					if !f.run.heap.HasCooldownAttempt(index) {
						count++
					}
					break
				}
			}
		}
	})
	return count, nil
}

func (f *executionFrame) commitCooldownWakeups() {
	if f.pendingBasicAttackCooldownWake && f.continuousCombatantsLive() {
		attack := f.run.basicAttack
		if wait, exists := f.run.combatants[attack.plan.Source].cooldowns.wait(basicAttackCooldownWaitKey(attack)); exists {
			if !f.run.heap.RescheduleBasicAttack(wait.readyAt, wait.version) {
				f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: wait.readyAt, Category: scheduler.GenericCategoryAbilityAttempt,
					Kind: scheduler.GenericEventBasicAttack, DriverEntryIndex: -1, BasicAttackGeneration: wait.version})
			}
		}
	}
	for _, pending := range f.pendingCooldownAttempts {
		if f.run.heap.RescheduleCooldownAttempt(pending.entry, pending.wait.readyAt, pending.wait.version) {
			continue
		}
		f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: pending.wait.readyAt, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventAbilityAttempt, DriverEntryIndex: pending.entry, CooldownWaitVersion: pending.wait.version})
	}
	if f.pendingAutomaticWake {
		f.run.queueAutomaticSkills(f.run.nowMs)
	}
}

func (s *genericRunState) enqueueCooldownAttempt(at int64, index, attempt int, owner, ability string) {
	entry := s.req.DriverPlan.Entries[index]
	c := s.combatants[owner]
	c.cooldowns = c.cooldowns.clone()
	wait := c.cooldowns.registerWait(whileReadyCooldownWaitKey(owner, entry.EntryKey), []genericCooldownIdentity{genericAbilityCooldownIdentity(owner, ability)}, 0, s.nowMs)
	s.combatants[owner] = c
	if s.heap.RescheduleCooldownAttempt(index, wait.readyAt, wait.version) {
		return
	}
	s.pushCombatEvent(scheduler.GenericEvent{TimeMs: wait.readyAt, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventAbilityAttempt, DriverEntryIndex: index, AttemptIndex: attempt, CooldownWaitVersion: wait.version})
}
