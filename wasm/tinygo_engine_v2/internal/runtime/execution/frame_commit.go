package execution

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/actor"
)

// 实例列表可供帧读取；State与StatusContributions在列表内始终只读。

type damageRecord struct {
	timeMs    int64
	sourceKey string
	targetKey string
	amount    float64
}

type genericExecuteEvidence struct {
	source       string
	target       string
	providerRef  string
	abilityRef   string
	operationRef string
	hpBefore     float64
	maxHp        float64
	hpRatio      float64
	threshold    float64
	killed       bool
	shieldBypass bool
}

// genericDamageEvidence 是 damage evidence Data 的构造输入（不新增顶层 DTO）。
type genericDamageEvidence struct {
	healthOrder           uint64
	empoweredAttack       *model.ProcessEmpoweredAttack
	activationUseRef      string
	providerDefinitionRef string
	providerActivatedAtMs *int64
	source                string
	target                string
	damageType            string
	rawAmount             float64
	mitigatedAmount       float64
	providerRef           string
	abilityRef            string
	operationRef          string
	operationPath         string
	owner                 string
	hpBefore              float64
	hpAfter               float64
	hasSourceHp           bool
	sourceHpBefore        float64
	sourceHpAfter         float64
	phantom               bool
	repeatTag             string
	replayedFrom          map[string]interface{}
	crit                  frozenCritEvidence
	modifiers             []map[string]interface{}
	traits                []string
	castInstanceID        uint64
	castOrigin            string
	damageID              uint64
	outcome               *pipeline.DamageOutcome
	// 成功的普通与复制结算都记录真实共同倍率和防御后两部分。
	// 金额无效的结算不伪造这些数值。
	hasPostResistanceEvidence bool
	resistanceFactor          float64
	normalPartPostResistance  float64
	critPartPostResistance    float64
}

func (s *Engine) recordGenericExecuteEvidence(ev genericExecuteEvidence) {
	s.recordEvidenceLazy(model.EvidenceKindExecute, func() model.EvidenceItem { return genericExecuteEvidenceItem(ev, s.loop.TimeMs()) })
}

func genericExecuteEvidenceItem(ev genericExecuteEvidence, timeMs int64) model.EvidenceItem {
	data := map[string]interface{}{
		"source":         ev.source,
		"target":         ev.target,
		"operationRef":   ev.operationRef,
		"hpBefore":       ev.hpBefore,
		"maxHp":          ev.maxHp,
		"hpRatio":        ev.hpRatio,
		"threshold":      ev.threshold,
		"thresholdType":  executeThresholdTypeRatio,
		"comparison":     executeThresholdComparison,
		"killed":         ev.killed,
		"shieldBypassed": ev.shieldBypass,
		"phantom":        false,
	}
	if ev.providerRef != "" {
		data["providerRef"] = ev.providerRef
	}
	if ev.abilityRef != "" {
		data["abilityRef"] = ev.abilityRef
	}
	ref := ev.operationRef
	if ref == "" {
		ref = ev.abilityRef
	}
	return model.EvidenceItem{
		TimeMs: timeMs,
		Kind:   model.EvidenceKindExecute,
		Ref:    ref,
		Data:   data,
	}
}

func (s *Engine) recordGenericDamageEvidence(ev genericDamageEvidence) {
	s.recordEvidenceLazy(model.EvidenceKindDamage, func() model.EvidenceItem { return genericDamageEvidenceItem(ev, s.loop.TimeMs()) })
}

func genericDamageEvidenceItem(ev genericDamageEvidence, timeMs int64) model.EvidenceItem {
	phase := "original"
	if ev.phantom {
		phase = "phantom"
	}
	data := map[string]interface{}{
		"phase":           phase,
		"phantom":         ev.phantom,
		"source":          ev.source,
		"target":          ev.target,
		"damageType":      ev.damageType,
		"rawAmount":       ev.rawAmount,
		"mitigatedAmount": ev.mitigatedAmount,
	}
	if ev.empoweredAttack != nil {
		data["empoweredAttack"], data["useRef"] = ev.empoweredAttack, ev.activationUseRef
	}
	if ev.outcome != nil {
		data["damageId"] = ev.damageID
		data["postDefenseDamage"] = ev.outcome.MitigatedAmount
		data["shieldAbsorbed"] = ev.outcome.ShieldAbsorbed
		data["actualHpLoss"] = ev.outcome.HPDamage
		data["overkillDamage"] = math.Max(0, ev.outcome.MitigatedAmount-ev.outcome.ShieldAbsorbed-ev.outcome.HPDamage)
	}
	if ev.providerRef != "" {
		data["providerRef"] = ev.providerRef
	}
	if ev.abilityRef != "" {
		data["abilityRef"] = ev.abilityRef
	}
	if ev.operationRef != "" {
		data["operationRef"] = ev.operationRef
	}
	if len(ev.traits) > 0 {
		data["traits"] = append([]string(nil), ev.traits...)
	}
	attachCastProvenance(data, ev.castInstanceID, ev.castOrigin)
	if ev.phantom {
		if ev.repeatTag != "" {
			data["repeatTag"] = ev.repeatTag
		}
		if len(ev.replayedFrom) > 0 {
			data["replayedFrom"] = ev.replayedFrom
		}
	}
	writeCritEvidenceFields(data, ev.crit)
	if ev.hasPostResistanceEvidence {
		data["resistanceFactor"] = ev.resistanceFactor
		data["normalPartPostResistance"] = ev.normalPartPostResistance
		data["critPartPostResistance"] = ev.critPartPostResistance
	}
	if len(ev.modifiers) > 0 {
		data["modifiers"] = ev.modifiers
	}
	ref := ev.abilityRef
	if ref == "" {
		ref = ev.operationRef
	}
	return model.EvidenceItem{
		TimeMs: timeMs,
		Kind:   model.EvidenceKindDamage,
		Ref:    ref,
		Data:   data,
	}
}

func writeCritEvidenceFields(data map[string]interface{}, critEv frozenCritEvidence) {
	if !critEv.present {
		return
	}
	data["eligible"] = critEv.eligible
	if critEv.policy != "" {
		data["policy"] = critEv.policy
	}
	data["baseRawAmount"] = critEv.baseRawAmount
	if !critEv.eligible {
		return
	}
	data["chanceRaw"] = critEv.chanceRaw
	data["chanceEffective"] = critEv.chanceEffective
	data["originalCritChance"] = critEv.originalCritChance
	data["effectiveCritChance"] = critEv.chanceEffective
	data["multiplier"] = critEv.multiplier
	data["naturalCritWeight"] = critEv.naturalWeight
	data["forcedCritWeight"] = critEv.forcedWeight
	data["naturalCritMultiplier"] = critEv.naturalMultiplier
	data["forcedCritMultiplier"] = critEv.forcedMultiplier
	data["normalPart"] = critEv.normalPart
	data["critPart"] = critEv.critPart
	data["critAdjustedRawAmount"] = critEv.critAdjustedRawAmount
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
	evalAbility := planbundle.CompiledAbility{}
	evalCtx := f.evalContext(evalAbility)
	for _, key := range keys {
		staged := f.staged.Get(key)
		for _, mut := range staged.providerOps {
			if mut.projected {
				continue
			}
			switch mut.kind {
			case "shield_apply":
				f.run.mountFreshProviderInstance(mut.targetKey, mut.sourceKey, mut.definitionIndex, mut.providerRef, mut.expireAt, mut.contributions)
			case "apply":
				if err := f.run.applyProviderInstanceWithRef(mut.targetKey, mut.sourceKey, mut.definitionRef, mut.providerRef, mut.expireAt, mut.hasExpireAt, mut.contributions); err != nil {
					f.fatal = true
					f.fatalErr = err
					return
				}
				if f.run.compiled.HasImmediatePeriodic {
					f.run.bindImmediatePeriodicUse(mut.targetKey, mut.sourceKey, mut.definitionRef, mut.useRef)
				}
			case "refresh":
				if err := f.run.refreshProviderInstance(mut.targetKey, mut.providerRef, mut.expireAt, mut.hasExpireAt, mut.contributions); err != nil {
					f.fatal = true
					f.fatalErr = err
					return
				}
			case "expire":
				if mut.strict {
					if err := f.run.removeProviderInstanceStrict(mut.targetKey, mut.providerRef, mut.definitionRef, evalCtx); err != nil {
						f.fatal = true
						f.fatalErr = err
						return
					}
					continue
				}
				kind := mut.evidenceKind
				if kind == "" {
					kind = model.EvidenceKindProviderRemove
				}
				f.run.removeProviderInstance(mut.targetKey, mut.providerRef, evalCtx, kind)
			}
		}
	}
	f.commitProjectedProviderLifecycles()
	if f.run.compiled.HasResourceMax {
		for _, key := range keys {
			c := f.run.combatants[key]

			c.setAttributes(syncHPResolved(c.attributesView()))
			f.run.combatants[key] = c
		}
	}
	if f.fatal {
		return
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
	f.run.freezeActionDeaths()
	f.commitFrameQueues()
	if f.run.processFailure != nil {
		f.fatal, f.fatalErr = true, f.run.processFailure
		return
	}
	f.commitFrameFacts()
	if !f.run.settlingProcessDeaths && f.run.processFailure == nil {
		f.run.processFailure = f.run.failDeadProcesses()
		if f.run.processFailure != nil {
			f.fatal = true
			f.fatalErr = f.run.processFailure
		}
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
