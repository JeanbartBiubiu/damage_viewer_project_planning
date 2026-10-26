package execution

import "tinygo_engine_v2/internal/runtime/contract"

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

type pendingCooldownAttempt struct {
	entry int
	wait  actionpkg.CooldownWait
}

func whileReadyCooldownWaitKey(owner, entry string) actionpkg.CooldownWaitKey {
	return actionpkg.CooldownWaitKey{Kind: "while_ready", Owner: owner, Key: entry}
}

// 冷却改期与自动候选在状态发布前预留容量，发布后只执行已通过预检的队列修改。
func (f *Frame) prepareCooldownWakeups() (int, *model.EngineError) {
	count := 0
	f.pendingAutomaticWake = f.run.actions.HasAutomatic()
	if f.pendingAutomaticWake && !f.run.loop.Queue().HasAutomaticSkill() {
		count++
	}
	if f.processIsNew && f.pendingProcess != nil {
		if action := f.run.actions.ActionForUse(f.pendingProcess.UseKey()); action != nil && action.AutomaticRule() != nil {
			if rule := action.AutomaticRule(); rule.Predecessor() != nil && rule.Qualification().RemainingCount != 1 {
				return 0, f.run.processErr("automaticSkills.qualifications", "initial commit requires an unconsumed predecessor qualification", action.UseRef())
			}
		}
	}
	f.pendingCooldownAttempts = nil
	f.pendingBasicAttackCooldownWake = false
	f.staged.Range(func(owner string, staged *stagedCombatant) {
		before := f.run.combatants[owner].cooldowns
		for _, wait := range staged.cooldowns.ChangedWaits(before) {
			if attack := f.run.actions.BasicAttack(); attack != nil && wait.Key == basicAttackCooldownWaitKey(attack) &&
				f.pendingBasicAttackWait == nil && !f.hasPendingBasicAttackAmmo() && !f.pendingActionWait && f.continuousCombatantsLive() {
				// A reset can invalidate a queued first attack before an attack period exists.
				f.pendingBasicAttackCooldownWake = true
				if !f.run.loop.Queue().HasBasicAttack() {
					count++
				}
				continue
			}
			if wait.Key.Kind != "while_ready" {
				continue
			}
			for index, entry := range f.run.req.DriverPlan.Entries {
				if wait.Key.Key == entry.EntryKey && f.run.isWhileReady(entry) {
					f.pendingCooldownAttempts = append(f.pendingCooldownAttempts, pendingCooldownAttempt{entry: index, wait: wait})
					if !f.run.loop.Queue().HasCooldownAttempt(index) {
						count++
					}
					break
				}
			}
		}
	})
	return count, nil
}

func (f *Frame) commitCooldownWakeups() {
	if f.pendingBasicAttackCooldownWake && f.continuousCombatantsLive() {
		attack := f.run.actions.BasicAttack()
		if wait, exists := f.run.combatants[attack.Plan().Source].cooldowns.Wait(basicAttackCooldownWaitKey(attack)); exists {
			if !f.run.loop.Queue().RescheduleBasicAttack(wait.ReadyAt, wait.Version) {
				f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: wait.ReadyAt, Category: scheduler.GenericCategoryAbilityAttempt,
					Kind: scheduler.GenericEventBasicAttack, DriverEntryIndex: -1, BasicAttackGeneration: wait.Version})
			}
		}
	}
	for _, pending := range f.pendingCooldownAttempts {
		if f.run.loop.Queue().RescheduleCooldownAttempt(pending.entry, pending.wait.ReadyAt, pending.wait.Version) {
			continue
		}
		f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: pending.wait.ReadyAt, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventAbilityAttempt, DriverEntryIndex: pending.entry, CooldownWaitVersion: pending.wait.Version})
	}
	if f.pendingAutomaticWake {
		f.run.queueAutomaticSkills(f.run.loop.TimeMs())
	}
}

func (s *Engine) enqueueCooldownAttempt(at int64, index, attempt int, owner, ability string) {
	entry := s.req.DriverPlan.Entries[index]
	c := s.combatants[owner]
	c.cooldowns = c.cooldowns.Clone()
	wait := c.cooldowns.RegisterWait(whileReadyCooldownWaitKey(owner, entry.EntryKey), []contract.CooldownIdentity{actionpkg.AbilityCooldownIdentity(owner, ability)}, 0, s.loop.TimeMs())
	s.combatants[owner] = c
	if s.loop.Queue().RescheduleCooldownAttempt(index, wait.ReadyAt, wait.Version) {
		return
	}
	s.pushCombatEvent(scheduler.GenericEvent{TimeMs: wait.ReadyAt, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventAbilityAttempt, DriverEntryIndex: index, AttemptIndex: attempt, CooldownWaitVersion: wait.Version})
}
