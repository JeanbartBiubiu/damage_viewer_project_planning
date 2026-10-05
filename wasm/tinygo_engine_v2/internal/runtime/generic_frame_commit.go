package runtime

import "tinygo_engine_v2/internal/model"

// 只保存当前帧新增的事实，不复制整场伤害历史、过程列表或可靠记录。
func (f *executionFrame) recordEvidence(item model.EvidenceItem) {
	if f.committed {
		f.run.recordEvidence(item)
		return
	}
	f.pendingEvidence = append(f.pendingEvidence, item)
}

func (f *executionFrame) recordGenericExecuteEvidence(ev genericExecuteEvidence) {
	f.recordEvidence(genericExecuteEvidenceItem(ev, f.run.nowMs))
}

func (f *executionFrame) recordGenericDamageEvidence(ev genericDamageEvidence) {
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
	f.recordEvidence(genericDamageEvidenceItem(ev, f.run.nowMs))
}

func (f *executionFrame) nextDamageID() uint64 {
	f.pendingDamageIDs++
	return f.run.nextDamageID + f.pendingDamageIDs
}

func (f *executionFrame) recordDamage(source, target string, amount float64) {
	if amount > 0 {
		f.pendingDamageHistory = append(f.pendingDamageHistory, damageRecord{timeMs: f.run.nowMs, sourceKey: source, targetKey: target, amount: amount})
	}
}

func (f *executionFrame) recordOverheal(source string, amount float64) {
	if amount <= 0 {
		return
	}
	if f.pendingOverheal == nil {
		f.pendingOverheal = make(map[string]float64)
	}
	f.pendingOverheal[source] += amount
}

func (f *executionFrame) commitFrameFacts() {
	f.committed = true
	if capture := f.pendingAmmoCapture; capture != nil {
		f.run.skillUses[capture.useRef].ammoBefore = capture
	}
	for _, record := range f.pendingMechanicRecords {
		f.run.mechanicRecordCount++
		if len(f.run.mechanicRecords) < f.run.maxMechanicRecords {
			f.run.mechanicRecords = append(f.run.mechanicRecords, record)
		}
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
	for _, item := range f.pendingEvidence {
		f.run.recordEvidence(item)
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
		if f.run.abilityStats == nil {
			f.run.abilityStats = make(map[string]*abilityStatAcc)
		}
		acc := f.run.statFor(ref)
		if f.countCastOnCommit {
			f.run.abilityCastCount++
			castAcc := acc
			if f.castStatRef != "" {
				castAcc = f.run.statFor(f.castStatRef)
			}
			castAcc.castCount++
		}
		if f.damageDealt > 0 {
			if acc.damageDealt == nil {
				acc.damageDealt = new(float64)
			}
			*acc.damageDealt += f.damageDealt
		}
		if f.healingDone > 0 {
			if acc.healingDone == nil {
				acc.healingDone = new(float64)
			}
			*acc.healingDone += f.healingDone
		}
	}
}
