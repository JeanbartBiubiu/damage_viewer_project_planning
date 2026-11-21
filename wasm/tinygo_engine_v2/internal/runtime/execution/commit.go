// 帧预检、所属状态发布及事实提交，保留前序成功边界。
package execution

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/actor"
	contractpkg "tinygo_engine_v2/internal/runtime/contract"
	"tinygo_engine_v2/internal/runtime/execution/operation"
	reportpkg "tinygo_engine_v2/internal/runtime/report"
)

type damageRecord = contractpkg.DamageHistory

type genericExecuteEvidence = contractpkg.ExecuteFact

type genericDamageEvidence = contractpkg.DamageFact

func (s *Engine) recordGenericExecuteEvidence(ev genericExecuteEvidence) {
	s.recordEvidenceLazy(model.EvidenceKindExecute, func() model.EvidenceItem { return reportpkg.ExecuteEvidenceItem(ev, s.loop.TimeMs()) })
}

func (s *Engine) recordGenericDamageEvidence(ev genericDamageEvidence) {
	s.recordEvidenceLazy(model.EvidenceKindDamage, func() model.EvidenceItem { return reportpkg.DamageEvidenceItem(ev, s.loop.TimeMs()) })
}

func (f *Frame) commit() {
	if f.fatal || f.committed {
		return
	}
	if f.run.compiled.HasResourceMax || f.run.compiled.HasCooldownDuration || f.run.compiled.HasProviderDurationChange || f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasModifierSnapshots {
		f.flushDynamicProviders()
		if f.fatal {
			return
		}
	}
	if f.run.compiled.HasShieldLifecycle {
		f.prepareShieldLifecycleRemovals()
		if f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasProviderDurationChange && !f.run.compiled.HasResourceMax && !f.run.compiled.HasCooldownDuration {
			// Depletion can append a removal after the first projection pass.
			f.flushDynamicProviders()
			if f.fatal {
				return
			}
		}
	}
	var keyBuffer [2]string
	keys, err := f.commitKeysAndPreflight(keyBuffer[:0])
	if err != nil {
		f.fatal, f.fatalErr = true, err
		return
	}
	for _, key := range keys {
		staged := f.staged.Get(key)
		c, ok := f.run.combatants[key]
		if !ok {
			c = combatantRuntime{numbers: actor.New(key, attribute.Table{}, nil), cooldowns: actionpkg.NewCooldownLedger()}
		}

		c.numbers = staged.numbers.Publish(c.numbers)
		c.cooldowns = staged.cooldowns
		staged.cooldownsShared = true
		c.instances = staged.instances.Publish(key, f.sourceKey)

		c.providerState = staged.providerState.Publish()

		f.run.combatants[key] = c
	}
	// 冷却所属状态已经发布；后续生命周期或派发失败保留该成功前缀与对应额度。
	if len(f.pendingAmountBudgets) != 0 {
		f.commitAmountBudgets()
	}
	evalCtx, err := f.evalContext(planbundle.CompiledAbility{})
	if err != nil {
		f.run.recordFirstProcessFailure(err)
		return
	}
	for _, key := range keys {
		mutations := f.staged.Get(key).providerOps
		if len(mutations) == 0 {
			continue
		}
		executor := f.run.lifecycleExecutor()
		f.run.recordFirstProcessFailure(executor.PublishMutations(mutations, evalCtx, f.run.loop.TimeMs(), (*lifecycleLiveEffects)(f.run)))
		if err := f.run.processFailure; err != nil {
			f.fatal, f.fatalErr = true, err
			return
		}
	}
	f.commitProjectedProviderLifecycles()
	if err := f.run.processFailure; err != nil {
		f.fatal, f.fatalErr = true, err
		return
	}
	if f.fatal {
		f.run.recordFirstProcessFailure(f.fatalErr)
		return
	}
	if f.run.compiled.HasResourceMax {
		for _, key := range keys {
			c := f.run.combatants[key]

			c.setAttributes(operation.SyncHPResolved(c.attributesView()))
			f.run.combatants[key] = c
		}
	}
	if f.pendingProcess != nil {
		f.processChanges.Publish(f.processOriginal)
		if f.processIsNew {
			f.run.actions.AddProcess(f.processOriginal)
		}
		f.run.updateEmpoweredWait(f.processOriginal)
	}
	if f.empowered != nil {
		f.commitEmpoweredProcesses()
	}
	for i := 0; i < f.pendingPassiveProcesses.Len(); i++ {
		f.run.actions.AddProcess(f.pendingPassiveProcesses.At(i))
	}
	f.run.freezeActionDeaths()
	f.commitFrameQueues()
	if f.run.processFailure != nil {
		f.fatal, f.fatalErr = true, f.run.processFailure
		return
	}
	f.commitFrameFacts()
	if !f.run.settlingProcessDeaths && f.run.processFailure == nil {
		f.run.recordFirstProcessFailure(f.run.failDeadProcesses())
	}
	if f.run.processFailure == nil {
		f.run.recordFirstProcessFailure(f.run.failStunnedProcesses())
	}
	if err := f.run.processFailure; err != nil {
		f.fatal, f.fatalErr = true, err
	}
}

// 只保存当前帧新增的事实，不复制整场伤害历史、过程列表或可靠记录。
func (f *Frame) recordEvidence(item model.EvidenceItem) {
	if f.committed {
		f.run.recordEvidence(item)
		return
	}
	if !f.run.detailedOutput() {
		f.recordEvidenceKind(item.Kind)
		return
	}
	f.pendingEvidence = append(f.pendingEvidence, item)
}

func (f *Frame) recordEvidenceKind(kind model.EvidenceKind) {
	if f.committed {
		f.run.recordEvidence(model.EvidenceItem{Kind: kind})
		return
	}
	f.pendingEvidenceKinds = append(f.pendingEvidenceKinds, kind)
}

func (f *Frame) pendingEvidenceIndex() int {
	if !f.run.detailedOutput() {
		return len(f.pendingEvidenceKinds)
	}
	return len(f.pendingEvidence)
}

func (f *Frame) recordGenericExecuteEvidence(ev genericExecuteEvidence) {
	f.recordEvidenceLazy(model.EvidenceKindExecute, func() model.EvidenceItem { return reportpkg.ExecuteEvidenceItem(ev, f.run.loop.TimeMs()) })
}

func (f *Frame) recordGenericDamageEvidence(ev genericDamageEvidence) {
	if f.run.compiled.HasResourceMax {
		ev.HealthOrder = f.run.reserveHealthOrder()
	}
	if f.empoweredAttack != nil {
		ev.EmpoweredAttack, ev.ActivationUseRef = f.empoweredAttack, f.processUseKey
	}
	if f.providerDefinitionRef != "" {
		ev.ProviderDefinitionRef = f.providerDefinitionRef
		ev.ProviderActivatedAtMs = f.providerActivatedAtMs
	}
	if f.damageOwnerKey != "" {
		ev.Owner = f.damageOwnerKey
	}
	if ev.Owner == "" {
		ev.Owner = f.ownerCombatantKey
	}
	if ev.Owner == "" {
		if ref, ok := parseFrameAbilityOwner(ev.AbilityRef); ok {
			ev.Owner = ref
		}
	}
	f.numeric.AddDamage(ev)
	f.recordEvidenceLazy(model.EvidenceKindDamage, func() model.EvidenceItem { return reportpkg.DamageEvidenceItem(ev, f.run.loop.TimeMs()) })
}

func (f *Frame) nextDamageID() uint64 {
	return f.numeric.NextDamageID(f.run.nextDamageID)
}

func (f *Frame) recordDamage(source, target string, amount float64) {
	if amount > 0 {
		f.numeric.AddHistory(damageRecord{TimeMs: f.run.loop.TimeMs(), SourceKey: source, TargetKey: target, Amount: amount})
	}
}

func (f *Frame) recordOverheal(source string, amount float64) { f.numeric.AddOverheal(source, amount) }

func (f *Frame) commitFrameFacts() {
	f.committed = true
	f.commitTargetMarkSummary()
	if f.processIsNew && f.processOriginal != nil {
		f.run.publishSkillActionStart(f.processOriginal)
	}
	if f.processOriginal != nil {
		if f.countCastOnCommit {
			f.run.publishSkillActionControl(f.processOriginal, f.castStatRef)
		}
		if f.processMomentKind != "" && f.empowered == nil {
			f.run.publishSkillActionMoment(f.processOriginal, f.processMomentKind)
		}
	}
	if f.empowered != nil {
		f.commitEmpoweredFacts()
	}
	for _, record := range f.numeric.Facts().DirectHealing {
		f.run.recordDirectHealing(record)
	}
	for _, record := range f.numeric.Facts().ResourceChanges {
		f.run.commitResourceChange(record)
	}
	if capture := f.pendingAmmoCapture; capture != nil {
		f.run.skillUses[capture.UseKey()].ammoBefore = capture
	}
	for _, record := range f.pendingMechanicRecords {
		f.run.report.RecordMechanic(record, f.run.detailedOutput())
	}
	f.run.nextDamageID += f.numeric.Facts().DamageIDs
	for _, row := range f.numeric.Facts().History {
		f.run.recordDamage(row.SourceKey, row.TargetKey, row.Amount, row.TimeMs)
	}
	for source, amount := range f.numeric.Facts().Overheal {
		f.run.recordOverheal(source, amount)
	}
	for _, damage := range f.numeric.Facts().Damages {
		f.run.recordCommittedDamage(f, damage)
	}
	hitIndex := 0
	if f.run.detailedOutput() {
		for index, item := range f.pendingEvidence {
			for hitIndex < len(f.pendingSkillHits) && f.pendingSkillHits[hitIndex].evidenceIndex == index {
				f.run.recordSkillActionHit(f.pendingSkillHits[hitIndex])
				hitIndex++
			}
			f.run.recordEvidence(item)
		}
	} else {
		for index, kind := range f.pendingEvidenceKinds {
			for hitIndex < len(f.pendingSkillHits) && f.pendingSkillHits[hitIndex].evidenceIndex == index {
				f.run.recordSkillActionHit(f.pendingSkillHits[hitIndex])
				hitIndex++
			}
			f.run.recordEvidence(model.EvidenceItem{Kind: kind})
		}
	}
	if f.copyableCollector != nil {
		f.pendingContinuation.Publish(f.copyableCollector)
		f.run.commitOncePerUse(f.copyableCollector.Reservation())
	}
	ref := f.statRef
	if ref == "" {
		ref = f.abilityRef
	}
	if f.countCastOnCommit || f.numeric.Facts().Damage > 0 || f.numeric.Facts().Healing > 0 {
		f.run.report.EnsureAbility(ref)
		if f.countCastOnCommit {
			f.run.abilityCastCount++
			castRef := ref
			if f.castStatRef != "" {
				castRef = f.castStatRef
			}
			f.run.report.Cast(castRef)
		}
		damage, healing := 0.0, 0.0
		if f.numeric.Facts().Damage > 0 {
			damage = f.numeric.Facts().Damage
		}
		if f.numeric.Facts().Healing > 0 {
			healing = f.numeric.Facts().Healing
		}
		f.run.report.AbilityOutput(ref, damage, healing)
	}
}
