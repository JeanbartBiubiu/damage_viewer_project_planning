package execution

import "tinygo_engine_v2/internal/model"

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
	f.recordEvidenceLazy(model.EvidenceKindExecute, func() model.EvidenceItem { return genericExecuteEvidenceItem(ev, f.run.loop.TimeMs()) })
}

func (f *Frame) recordGenericDamageEvidence(ev genericDamageEvidence) {
	if f.run.compiled.HasResourceMax {
		ev.healthOrder = f.run.reserveHealthOrder()
	}
	if f.empoweredAttack != nil {
		ev.empoweredAttack, ev.activationUseRef = f.empoweredAttack, f.processUseKey
	}
	if f.providerDefinitionRef != "" {
		ev.providerDefinitionRef = f.providerDefinitionRef
		ev.providerActivatedAtMs = f.providerActivatedAtMs
	}
	if f.damageOwnerKey != "" {
		ev.owner = f.damageOwnerKey
	}
	if ev.owner == "" {
		ev.owner = f.ownerCombatantKey
	}
	if ev.owner == "" {
		if ref, ok := parseFrameAbilityOwner(ev.abilityRef); ok {
			ev.owner = ref
		}
	}
	f.pendingDamage = append(f.pendingDamage, ev)
	f.recordEvidenceLazy(model.EvidenceKindDamage, func() model.EvidenceItem { return genericDamageEvidenceItem(ev, f.run.loop.TimeMs()) })
}

func (f *Frame) nextDamageID() uint64 {
	f.pendingDamageIDs++
	return f.run.nextDamageID + f.pendingDamageIDs
}

func (f *Frame) recordDamage(source, target string, amount float64) {
	if amount > 0 {
		f.pendingDamageHistory = append(f.pendingDamageHistory, damageRecord{timeMs: f.run.loop.TimeMs(), sourceKey: source, targetKey: target, amount: amount})
	}
}

func (f *Frame) recordOverheal(source string, amount float64) {
	if amount <= 0 {
		return
	}
	if f.pendingOverheal == nil {
		f.pendingOverheal = make(map[string]float64)
	}
	f.pendingOverheal[source] += amount
}

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
	for _, record := range f.pendingDirectHealing {
		f.run.recordDirectHealing(record)
	}
	for _, record := range f.pendingResourceChanges {
		f.run.commitResourceChange(record)
	}
	if capture := f.pendingAmmoCapture; capture != nil {
		f.run.skillUses[capture.useRef].ammoBefore = capture
	}
	for _, record := range f.pendingMechanicRecords {
		f.run.report.RecordMechanic(record, f.run.detailedOutput())
	}
	f.run.nextDamageID += f.pendingDamageIDs
	for _, row := range f.pendingDamageHistory {
		f.run.recordDamage(row.sourceKey, row.targetKey, row.amount, row.timeMs)
	}
	for source, amount := range f.pendingOverheal {
		f.run.recordOverheal(source, amount)
	}
	for _, damage := range f.pendingDamage {
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
		f.copyableCollector.damages = append(f.copyableCollector.damages, f.pendingCopyable...)
		f.copyableCollector.repeats = append(f.copyableCollector.repeats, f.pendingRepeats...)
		if reservation := f.copyableCollector.reservation; reservation != nil {
			f.run.commitOncePerUse(reservation.listener, reservation.event)
		}
	}
	ref := f.statRef
	if ref == "" {
		ref = f.abilityRef
	}
	if f.countCastOnCommit || f.damageDealt > 0 || f.healingDone > 0 {
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
		if f.damageDealt > 0 {
			damage = f.damageDealt
		}
		if f.healingDone > 0 {
			healing = f.healingDone
		}
		f.run.report.AbilityOutput(ref, damage, healing)
	}
}
