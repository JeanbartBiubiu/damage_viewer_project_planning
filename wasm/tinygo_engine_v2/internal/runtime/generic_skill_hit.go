package runtime

import (
	"math"
	"sort"
	"strconv"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/status"
)

const (
	maxSkillUsesPerRun      = 256
	maxSkillHitFactsPerRun  = 1024
	maxSkillHistoryContacts = 4096
	maxSkillLedgerUnits     = 1024
	maxSkillHitOccurrences  = 4096
)

type skillUseRuntime struct {
	useKey       string
	source       string
	skillKey     string
	historyState string
	prior        []string
	contacts     []string
}

type skillHitGroup struct {
	useRef     string
	firstAtMs  int64
	entryKeys  []string
	knownOrder bool
	started    bool
	frozen     map[string]skillHitDecision // entryKey → first_contact freeze for unknown groups
}

type skillHitDecision struct {
	has   bool
	value float64
}

type frozenSkillHitContext struct {
	occurrenceID        uint64
	useRef              string
	skillKey            string
	sourceKey           string
	targetKey           string
	hasFirstContact     bool
	firstContact        float64
	blocked             float64
	unitScope           string
	effectOccurrenceKey string
	resultKey           string
	candidateKey        string
	shieldOwner         string
	shieldProviderRef   string
	shieldDefinitionRef string
	shieldSource        string
	reusedSkillUnit     bool
	matchedIndexes      []int
	ability             compilebundle.CompiledAbility
	plan                *compilebundle.CompiledSkillHit
	abilityRef          string
}

func skillHitBudget(maxEvents int) int {
	if maxEvents <= 0 {
		return 256
	}
	if maxEvents < 256 {
		return 256
	}
	if maxEvents > maxSkillHitOccurrences {
		return maxSkillHitOccurrences
	}
	return maxEvents
}

func (s *genericRunState) initSkillHitState() *model.EngineError {
	s.skillUses = map[string]*skillUseRuntime{}
	s.skillHitFacts = map[string]model.SkillHitFact{}
	s.skillHitGroups = map[string]*skillHitGroup{}
	s.skillHitLedger = map[string]*frozenSkillHitContext{}
	s.runtimeListeners = nil
	if err := s.validateAndIndexSkillHitFacts(); err != nil {
		return err
	}
	s.bindDynamicProviderListeners()
	return nil
}

func (s *genericRunState) validateAndIndexSkillHitFacts() *model.EngineError {
	if len(s.req.SkillUses) > maxSkillUsesPerRun {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "skillUses exceeded run budget", "skillUses", "")
	}
	if len(s.req.SkillHitFacts) > maxSkillHitFactsPerRun {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "skillHitFacts exceeded run budget", "skillHitFacts", "")
	}
	seenUse := map[string]int{}
	for i, use := range s.req.SkillUses {
		path := "skillUses[" + itoa(uint32(i)) + "]"
		if strings.TrimSpace(use.UseKey) == "" {
			return s.skillHitErr(model.GenericErrMissingRequiredField, "skillUses.useKey is required", path+".useKey", "")
		}
		if prev, ok := seenUse[use.UseKey]; ok {
			return s.skillHitErr(model.GenericErrUnknownRef, "duplicate skillUses.useKey", path+".useKey", use.UseKey+" previously "+itoa(uint32(prev)))
		}
		seenUse[use.UseKey] = i
		if strings.TrimSpace(use.Source) == "" {
			return s.skillHitErr(model.GenericErrMissingRequiredField, "skillUses.source is required", path+".source", use.UseKey)
		}
		if strings.TrimSpace(use.SkillKey) == "" {
			return s.skillHitErr(model.GenericErrMissingRequiredField, "skillUses.skillKey is required", path+".skillKey", use.UseKey)
		}
		if use.HistoryState != model.SkillHitHistoryComplete && use.HistoryState != model.SkillHitHistoryUnknown {
			return s.skillHitErr(model.GenericErrUnknownRef, "skillUses.historyState must be complete or unknown", path+".historyState", use.HistoryState)
		}
		if len(use.PriorQualifiedContacts) > maxSkillHistoryContacts {
			return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "priorQualifiedContacts exceeded run budget", path+".priorQualifiedContacts", use.UseKey)
		}
		s.skillUses[use.UseKey] = &skillUseRuntime{
			useKey:       use.UseKey,
			source:       use.Source,
			skillKey:     use.SkillKey,
			historyState: use.HistoryState,
			prior:        append([]string(nil), use.PriorQualifiedContacts...),
		}
	}

	hitEntries := map[string]int{}
	for i, entry := range s.req.DriverPlan.Entries {
		ability, _, ok := s.lookupDriverAbility(entry)
		if !ok || !ability.HasSkillHit {
			continue
		}
		hitEntries[entry.EntryKey] = i
		if entry.Repeat != nil || s.isWhileReady(entry) {
			return s.skillHitErr(model.GenericErrUnknownRef, "resolve_skill_hit driver cannot use Repeat or WhileReady", "driverPlan.entries["+entry.EntryKey+"]", entry.AbilityRef)
		}
		if entry.Source == "" || entry.Target == "" {
			return s.skillHitErr(model.GenericErrMissingRequiredField, "hit driver requires explicit source and target", "driverPlan.entries["+entry.EntryKey+"]", entry.AbilityRef)
		}
	}

	seenFact := map[string]int{}
	for i, fact := range s.req.SkillHitFacts {
		path := "skillHitFacts[" + itoa(uint32(i)) + "]"
		if strings.TrimSpace(fact.DriverEntryKey) == "" {
			return s.skillHitErr(model.GenericErrMissingRequiredField, "skillHitFacts.driverEntryKey is required", path+".driverEntryKey", "")
		}
		if prev, ok := seenFact[fact.DriverEntryKey]; ok {
			return s.skillHitErr(model.GenericErrUnknownRef, "duplicate skillHitFacts.driverEntryKey", path+".driverEntryKey", fact.DriverEntryKey+" previously "+itoa(uint32(prev)))
		}
		seenFact[fact.DriverEntryKey] = i
		entryIdx, ok := hitEntries[fact.DriverEntryKey]
		if !ok {
			return s.skillHitErr(model.GenericErrUnknownRef, "skillHitFact must point to a single-shot resolve_skill_hit driver", path+".driverEntryKey", fact.DriverEntryKey)
		}
		entry := s.req.DriverPlan.Entries[entryIdx]
		ability, _, _ := s.lookupDriverAbility(entry)
		if fact.UseRef != nil && *fact.UseRef != "" {
			use, found := s.skillUses[*fact.UseRef]
			if !found {
				return s.skillHitErr(model.GenericErrUnknownRef, "skillHitFact.useRef is not a declared skill use", path+".useRef", *fact.UseRef)
			}
			if use.source != entry.Source {
				return s.skillHitErr(model.GenericErrUnknownRef, "skill use source must equal the driver source", path+".useRef", *fact.UseRef)
			}
			if use.skillKey != ability.SkillHitSkillKey {
				return s.skillHitErr(model.GenericErrUnknownRef, "skill use skillKey must equal the hit plan skillKey", path+".useRef", *fact.UseRef)
			}
		}
		if fact.Sequence != nil && *fact.Sequence < 0 {
			return s.skillHitErr(model.GenericErrUnknownRef, "skillHitFact.sequence must be a non-negative integer", path+".sequence", fact.DriverEntryKey)
		}
		s.skillHitFacts[fact.DriverEntryKey] = fact
	}
	if err := s.bindMissingBasicAttackFacts(hitEntries); err != nil {
		return err
	}
	return s.buildSkillHitGroups(hitEntries)
}

func (s *genericRunState) bindMissingBasicAttackFacts(hitEntries map[string]int) *model.EngineError {
	for entryKey, idx := range hitEntries {
		if _, ok := s.skillHitFacts[entryKey]; ok {
			continue
		}
		entry := s.req.DriverPlan.Entries[idx]
		ability, _, ok := s.lookupDriverAbility(entry)
		if !ok || !ability.IsBasicAttack {
			continue
		}
		skillKey := strings.TrimSpace(ability.SkillHitSkillKey)
		if skillKey == "" {
			skillKey = strings.TrimSpace(ability.SkillKey)
		}
		if skillKey == "" {
			return s.skillHitErr(model.GenericErrMissingRequiredField, "basic attack resolve requires skillKey", "skillHitFacts", entryKey)
		}
		useKey := nativeBasicAttackSkillPrefix + entryKey
		if _, exists := s.skillUses[useKey]; exists {
			useKey = nativeBasicAttackSkillPrefix + entryKey + ":" + skillKey
		}
		if _, exists := s.skillUses[useKey]; exists {
			return s.skillHitErr(model.GenericErrUnknownRef, "could not allocate a unique basic-attack useKey", "skillUses", useKey)
		}
		s.skillUses[useKey] = &skillUseRuntime{
			useKey:       useKey,
			source:       entry.Source,
			skillKey:     skillKey,
			historyState: model.SkillHitHistoryComplete,
		}
		s.req.SkillUses = append(s.req.SkillUses, model.SkillUseFact{
			UseKey:       useKey,
			Source:       entry.Source,
			SkillKey:     skillKey,
			HistoryState: model.SkillHitHistoryComplete,
		})
		ref := useKey
		fact := model.SkillHitFact{DriverEntryKey: entryKey, UseRef: &ref}
		s.req.SkillHitFacts = append(s.req.SkillHitFacts, fact)
		s.skillHitFacts[entryKey] = fact
	}
	return nil
}

func (s *genericRunState) buildSkillHitGroups(hitEntries map[string]int) *model.EngineError {
	type groupKey struct {
		use     string
		at      int64
		nullUse bool
	}
	buckets := map[groupKey][]string{}
	for entryKey, fact := range s.skillHitFacts {
		entry := s.req.DriverPlan.Entries[hitEntries[entryKey]]
		key := groupKey{at: entry.FirstAtMs}
		if fact.UseRef != nil && *fact.UseRef != "" {
			key.use = *fact.UseRef
		} else {
			key.nullUse = true
			key.use = "\x00" + entryKey
		}
		buckets[key] = append(buckets[key], entryKey)
	}
	for key, members := range buckets {
		sort.SliceStable(members, func(i, j int) bool {
			ei := hitEntries[members[i]]
			ej := hitEntries[members[j]]
			pi := s.req.DriverPlan.Entries[ei].Priority
			pj := s.req.DriverPlan.Entries[ej].Priority
			if pi != pj {
				return pi < pj
			}
			return ei < ej
		})
		g := &skillHitGroup{useRef: key.use, firstAtMs: key.at, entryKeys: members, frozen: map[string]skillHitDecision{}}
		if key.nullUse {
			g.knownOrder = false
			s.skillHitGroups[groupMapKey(key.use, key.at)] = g
			continue
		}
		if len(members) <= 1 {
			g.knownOrder = true
			s.skillHitGroups[groupMapKey(key.use, key.at)] = g
			continue
		}
		known, err := s.groupOrderKnown(members, g.entryKeys)
		if err != nil {
			return err
		}
		g.knownOrder = known
		s.skillHitGroups[groupMapKey(key.use, key.at)] = g
	}
	return nil
}

func groupMapKey(use string, at int64) string {
	return use + "\x00" + strconv.FormatInt(at, 10)
}

func (s *genericRunState) groupOrderKnown(members, heapOrder []string) (bool, *model.EngineError) {
	seqs := make([]int, 0, len(members))
	missing := 0
	seenSeq := map[int]string{}
	lastProvided := -1
	for _, key := range members {
		fact := s.skillHitFacts[key]
		if fact.Sequence == nil {
			missing++
			continue
		}
		if prev, ok := seenSeq[*fact.Sequence]; ok {
			return false, s.skillHitErr(model.GenericErrUnknownRef, "duplicate skillHitFact.sequence in same-use same-time group", "skillHitFacts.sequence", key+" conflicts "+prev)
		}
		seenSeq[*fact.Sequence] = key
		if *fact.Sequence <= lastProvided {
			return false, s.skillHitErr(model.GenericErrUnknownRef, "provided sequence contradicts relative heap order", "skillHitFacts.sequence", key)
		}
		lastProvided = *fact.Sequence
		seqs = append(seqs, *fact.Sequence)
	}
	if missing > 0 {
		return false, nil
	}
	bySeq := append([]string(nil), members...)
	sort.SliceStable(bySeq, func(i, j int) bool {
		return *s.skillHitFacts[bySeq[i]].Sequence < *s.skillHitFacts[bySeq[j]].Sequence
	})
	for i := range heapOrder {
		if bySeq[i] != heapOrder[i] {
			return false, s.skillHitErr(model.GenericErrUnknownRef, "skillHitFact.sequence contradicts heap order (priority then driver entries index)", "skillHitFacts.sequence", bySeq[i])
		}
	}
	return true, nil
}

func (s *genericRunState) lookupDriverAbility(entry model.DriverEntry) (compilebundle.CompiledAbility, string, bool) {
	sourceKey, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	targetKey, _ := s.resolveDriverCombatantKey(entry.Target, sourceKey)
	resolved := normalizeAbilityRef(entry.AbilityRef, sourceKey, targetKey)
	ref, ok := s.compiled.AbilityRefIndex[resolved]
	if !ok || int(ref.AbilityIndex) >= len(s.compiled.Abilities) {
		return compilebundle.CompiledAbility{}, resolved, false
	}
	return s.compiled.Abilities[ref.AbilityIndex], resolved, true
}

func (s *genericRunState) skillHitErr(code model.GenericErrCode, message, path, ref string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, code, message, path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func (f *executionFrame) resolveSkillHit(op compilebundle.CompiledOperation, ability compilebundle.CompiledAbility) *model.EngineError {
	if op.SkillHit == nil {
		return f.run.skillHitErr(model.GenericErrMissingRequiredField, "resolve_skill_hit missing compiled plan", f.abilityRef, "")
	}
	if f.driverEntryKey == "" {
		return f.run.skillHitErr(model.GenericErrMissingRequiredField, "resolve_skill_hit requires a single driver fact", f.abilityRef, "")
	}
	fact, ok := f.run.skillHitFacts[f.driverEntryKey]
	if !ok {
		return f.run.skillHitErr(model.GenericErrMissingRequiredField, "missing skill hit fact for driver entry", "skillHitFacts", f.driverEntryKey)
	}
	if int(f.run.skillHitOccurrenceCount) >= skillHitBudget(f.run.budget.MaxEvents) {
		return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "skill hit occurrences exceeded run budget", "skillHitFacts", f.driverEntryKey)
	}
	f.run.skillHitOccurrenceCount++
	occurrenceID := f.run.skillHitOccurrenceCount
	f.skillHitOccurrenceID = occurrenceID

	useRef := ""
	if fact.UseRef != nil {
		useRef = *fact.UseRef
	}
	firstHas, firstVal, err := f.run.qualifyFirstContact(f.driverEntryKey, useRef, f.targetKey)
	if err != nil {
		return err
	}
	if err := f.run.registerQualifiedContact(useRef, f.targetKey); err != nil {
		return err
	}

	set, err := f.selectSkillHitCandidates(op.SkillHit, ability, firstHas, firstVal)
	if err != nil {
		return err
	}
	unit, err := f.formSkillHitUnit(op.SkillHit, set, occurrenceID, useRef)
	if err != nil {
		return err
	}

	blocked := 0.0
	reused := false
	var shield status.ProviderInstance
	hasShield := false
	hasBlockable := false
	for _, idx := range set {
		if op.SkillHit.Candidates[idx].InboundBlockEligible {
			hasBlockable = true
			break
		}
	}
	if useRef != "" && hasBlockable {
		if existing := f.run.skillHitLedger[useRef]; existing != nil && existing.unitScope == model.SpellShieldScopeSkill {
			if unitCoversCandidates(existing, op.SkillHit, set, occurrenceID, useRef) {
				blocked = 1
				reused = true
				unit = existing
			}
		}
	}
	if !reused && hasBlockable {
		if unit != nil && unit.unitScope == model.SpellShieldScopeSkill && useRef == "" {
			return f.run.skillHitErr(model.GenericErrMissingRequiredField, "SKILL block scope requires a qualified useRef", "skillHitFacts["+f.driverEntryKey+"].useRef", f.driverEntryKey)
		}
		insts := f.activeSpellShields(f.targetKey)
		switch len(insts) {
		case 0:
			blocked = 0
		case 1:
			blocked = 1
			shield = insts[0]
			hasShield = true
		default:
			return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "multiple active spell_shield instances have no nominated priority", "combatants["+f.targetKey+"].providers", f.targetKey)
		}
	}

	freeze := &frozenSkillHitContext{
		occurrenceID:    occurrenceID,
		useRef:          useRef,
		skillKey:        op.SkillHit.SkillKey,
		sourceKey:       f.sourceKey,
		targetKey:       f.targetKey,
		hasFirstContact: firstHas,
		firstContact:    firstVal,
		blocked:         blocked,
		reusedSkillUnit: reused,
		ability:         ability,
		plan:            op.SkillHit,
		abilityRef:      f.abilityRef,
	}
	if unit != nil {
		freeze.unitScope = unit.unitScope
		freeze.effectOccurrenceKey = unit.effectOccurrenceKey
		freeze.resultKey = unit.resultKey
		freeze.candidateKey = unit.candidateKey
	}
	if hasShield {
		freeze.shieldOwner = shield.Owner
		freeze.shieldProviderRef = shield.ProviderRef
		freeze.shieldDefinitionRef = shield.DefinitionRef
		freeze.shieldSource = shield.Source
	} else if reused && unit != nil {
		freeze.shieldOwner = unit.shieldOwner
		freeze.shieldProviderRef = unit.shieldProviderRef
		freeze.shieldDefinitionRef = unit.shieldDefinitionRef
		freeze.shieldSource = unit.shieldSource
	}
	if blocked == 1 && !reused && freeze.unitScope == model.SpellShieldScopeSkill && useRef != "" && !ability.IsBasicAttack {
		if len(f.run.skillHitLedger) >= maxSkillLedgerUnits {
			return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "SKILL ledger exceeded run budget", "skillUses", useRef)
		}
		copied := *freeze
		f.run.skillHitLedger[useRef] = &copied
	}

	matched, err := f.consumptionMatchedCandidates(op.SkillHit, ability, set, freeze)
	if err != nil {
		return err
	}
	freeze.matchedIndexes = matched

	eventType := model.EventTypeSkillHit
	if ability.IsBasicAttack {
		eventType = model.EventTypeBasicAttackHit
		if _, ok := f.run.compiled.Types.Registry.Lookup(eventType); !ok {
			return f.run.skillHitErr(model.GenericErrUnknownTypeKey, "basic attack resolve requires event/basic_attack_hit in typeCatalog", f.abilityRef, "")
		}
	} else if _, ok := f.run.compiled.Types.Registry.Lookup(model.EventTypeSkillHit); !ok {
		return f.run.skillHitErr(model.GenericErrUnknownTypeKey, "resolve_skill_hit requires event/skill_hit in typeCatalog", f.abilityRef, "")
	}
	snap := f.captureEmitSnapshot(eventType, f.sourceKey, f.targetKey)
	if eventType == model.EventTypeSkillHit {
		snap.hasSkillHit = true
		snap.skillHit = freeze
	}
	f.run.recordEvidence(model.EvidenceItem{
		TimeMs: f.run.nowMs,
		Kind:   model.EvidenceKindSkillHit,
		Ref:    f.abilityRef,
		Path:   "driverPlan.entries[" + f.driverEntryKey + "]",
		Data:   skillHitEvidenceData(freeze),
	})
	emitData := skillHitEvidenceData(freeze)
	emitData["eventType"] = eventType
	f.run.recordEvidence(model.EvidenceItem{
		TimeMs: f.run.nowMs,
		Kind:   model.EvidenceKindEmittedEvent,
		Ref:    eventType,
		Data:   emitData,
	})
	ev := emittedEvent{
		eventType:      eventType,
		ref:            eventType,
		sourceKey:      f.sourceKey,
		targetKey:      f.targetKey,
		types:          f.appendCastOriginEventType([]string{eventType}),
		snapshot:       snap,
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
		skillHit:       freeze,
	}
	if freeze.useRef != "" {
		ev.hasUse = true
		ev.useKey = freeze.useRef
		ev.useSource = freeze.sourceKey
		ev.useSkillKey = freeze.skillKey
	}
	f.pendingEvents = append(f.pendingEvents, ev)
	return nil
}

func skillHitEvidenceData(freeze *frozenSkillHitContext) map[string]interface{} {
	data := map[string]interface{}{
		"occurrenceId": float64(freeze.occurrenceID),
		"skillKey":     freeze.skillKey,
		"source":       freeze.sourceKey,
		"target":       freeze.targetKey,
		"blocked":      freeze.blocked,
		"reused":       freeze.reusedSkillUnit,
	}
	if freeze.useRef != "" {
		data["useRef"] = freeze.useRef
	}
	if freeze.hasFirstContact {
		data["firstContact"] = freeze.firstContact
	}
	if freeze.unitScope != "" {
		data["blockScope"] = freeze.unitScope
		data["candidateKey"] = freeze.candidateKey
		data["effectOccurrenceKey"] = freeze.effectOccurrenceKey
		data["resultKey"] = freeze.resultKey
	}
	if freeze.shieldProviderRef != "" {
		data["shieldProviderRef"] = freeze.shieldProviderRef
		data["shieldOwner"] = freeze.shieldOwner
		data["shieldDefinitionRef"] = freeze.shieldDefinitionRef
	}
	return data
}

func (s *genericRunState) qualifyFirstContact(entryKey, useRef, targetKey string) (bool, float64, *model.EngineError) {
	if useRef == "" {
		return false, 0, nil
	}
	use := s.skillUses[useRef]
	if use == nil {
		return false, 0, s.skillHitErr(model.GenericErrUnknownRef, "unknown skill use", "skillUses", useRef)
	}
	if use.historyState == model.SkillHitHistoryUnknown {
		return false, 0, nil
	}
	entry := s.driverEntryByKey(entryKey)
	g := s.skillHitGroups[groupMapKey(useRef, entry.FirstAtMs)]
	hasPriorContact := len(use.prior)+len(use.contacts) > 0
	if g == nil {
		return true, bool01(!hasPriorContact), nil
	}
	if !g.knownOrder {
		if !g.started {
			g.started = true
			for _, key := range g.entryKeys {
				if hasPriorContact {
					g.frozen[key] = skillHitDecision{has: true, value: 0}
				} else {
					g.frozen[key] = skillHitDecision{has: false}
				}
			}
		}
		dec := g.frozen[entryKey]
		return dec.has, dec.value, nil
	}
	if hasPriorContact {
		return true, 0, nil
	}
	return true, 1, nil
}

func (s *genericRunState) registerQualifiedContact(useRef, targetKey string) *model.EngineError {
	if useRef == "" {
		return nil
	}
	use := s.skillUses[useRef]
	if use == nil {
		return nil
	}
	if len(use.contacts)+len(use.prior) >= maxSkillHistoryContacts {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "skill use history exceeded run budget", "skillUses["+useRef+"].priorQualifiedContacts", useRef)
	}
	use.contacts = append(use.contacts, targetKey)
	return nil
}

func (s *genericRunState) driverEntryByKey(entryKey string) model.DriverEntry {
	for _, entry := range s.req.DriverPlan.Entries {
		if entry.EntryKey == entryKey {
			return entry
		}
	}
	return model.DriverEntry{}
}

func bool01(ok bool) float64 {
	if ok {
		return 1
	}
	return 0
}

func (f *executionFrame) selectSkillHitCandidates(plan *compilebundle.CompiledSkillHit, ability compilebundle.CompiledAbility, firstHas bool, firstVal float64) ([]int, *model.EngineError) {
	var out []int
	for i := range plan.Candidates {
		cand := plan.Candidates[i]
		if cand.HasParticipation {
			value, err := f.evalAmount(cand.ParticipationProgram, ability)
			if err != nil {
				if err.Path == "" {
					err.Path = cand.Path + ".participationCondition"
				}
				return nil, err
			}
			if value == 0 {
				continue
			}
		}
		ok, err := f.matchEventValueConds(cand, firstHas, firstVal, false, 0, false)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		if cand.HasBlockScope {
			unblocked, err := f.matchEventValueConds(cand, firstHas, firstVal, true, 0, true)
			if err != nil {
				return nil, err
			}
			if !unblocked {
				return nil, f.run.skillHitErr(model.GenericErrUnknownRef, "non-null incoming candidate cannot require its own blocked result", cand.Path+".eventValueConditions", cand.CandidateKey)
			}
		}
		out = append(out, i)
	}
	return out, nil
}

func (f *executionFrame) matchEventValueConds(cand compilebundle.CompiledSkillHitCandidate, firstHas bool, firstVal float64, blockedHas bool, blockedVal float64, includeBlocked bool) (bool, *model.EngineError) {
	ability := compilebundle.CompiledAbility{Params: f.skillHitAbilityParams()}
	for _, cond := range cand.EventValueConds {
		if cond.Key == model.SkillHitValueBlocked && !includeBlocked {
			continue
		}
		value, evalErr := f.run.compiled.Formulas.Eval(cond.ValueProg, f.evalContext(ability))
		if evalErr != nil {
			wrapped := engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, evalErr.Error(), cond.Path+".value", cand.CandidateKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
			if strings.HasPrefix(evalErr.Error(), "event.skill_hit.") {
				wrapped.Path = evalErr.Error()
			}
			return false, wrapped
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite eventValueConditions value", cond.Path+".value", cand.CandidateKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		var left float64
		switch cond.Key {
		case model.SkillHitValueFirstContact:
			if !firstHas {
				return false, nil
			}
			left = firstVal
		case model.SkillHitValueBlocked:
			if !blockedHas {
				return false, nil
			}
			left = blockedVal
		default:
			return false, f.run.skillHitErr(model.GenericErrUnknownRef, "unknown event value key", cond.Path+".key", cond.Key)
		}
		ok, valid := model.CompareSkillHitValue(cond.Comparator, left, value)
		if !valid {
			return false, f.run.skillHitErr(model.GenericErrUnknownRef, "unsupported comparator", cond.Path+".comparator", cond.Comparator)
		}
		if !ok {
			return false, nil
		}
	}
	return true, nil
}

func (f *executionFrame) skillHitAbilityParams() map[string]float64 {
	if f.abilityRef == "" {
		return map[string]float64{}
	}
	ref, ok := f.run.compiled.AbilityRefIndex[f.abilityRef]
	if !ok {
		return map[string]float64{}
	}
	return f.run.compiled.Abilities[ref.AbilityIndex].Params
}

func (f *executionFrame) formSkillHitUnit(plan *compilebundle.CompiledSkillHit, set []int, occurrenceID uint64, useRef string) (*frozenSkillHitContext, *model.EngineError) {
	var first *compilebundle.CompiledSkillHitCandidate
	for _, idx := range set {
		cand := plan.Candidates[idx]
		if cand.InboundBlockEligible && cand.HasBlockScope {
			c := cand
			first = &c
			break
		}
	}
	if first == nil {
		return nil, nil
	}
	unit := &frozenSkillHitContext{
		occurrenceID:        occurrenceID,
		useRef:              useRef,
		unitScope:           first.BlockScope,
		effectOccurrenceKey: first.EffectOccurrenceKey,
		resultKey:           first.ResultKey,
		candidateKey:        first.CandidateKey,
	}
	for _, idx := range set {
		cand := plan.Candidates[idx]
		if !cand.HasBlockScope || !cand.InboundBlockEligible {
			continue
		}
		if model.ScopeCovers(unit.unitScope, occurrenceID, unit.effectOccurrenceKey, unit.resultKey, unit.candidateKey, useRef, cand.BlockScope, occurrenceID, cand.EffectOccurrenceKey, cand.ResultKey, cand.CandidateKey, useRef) {
			continue
		}
		return nil, f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "incompatible spell shield units; the first non-null result cannot be expanded by a later candidate", cand.Path+".spellShieldBlockScope", cand.CandidateKey)
	}
	return unit, nil
}

func unitCoversCandidates(unit *frozenSkillHitContext, plan *compilebundle.CompiledSkillHit, set []int, occurrenceID uint64, useRef string) bool {
	if unit == nil {
		return false
	}
	for _, idx := range set {
		cand := plan.Candidates[idx]
		if !cand.HasBlockScope {
			continue
		}
		if !model.ScopeCovers(unit.unitScope, unit.occurrenceID, unit.effectOccurrenceKey, unit.resultKey, unit.candidateKey, unit.useRef, cand.BlockScope, occurrenceID, cand.EffectOccurrenceKey, cand.ResultKey, cand.CandidateKey, useRef) {
			return false
		}
	}
	return true
}

func (f *executionFrame) consumptionMatchedCandidates(plan *compilebundle.CompiledSkillHit, ability compilebundle.CompiledAbility, set []int, freeze *frozenSkillHitContext) ([]int, *model.EngineError) {
	var out []int
	for _, idx := range set {
		cand := plan.Candidates[idx]
		ok, err := f.matchEventValueConds(cand, freeze.hasFirstContact, freeze.firstContact, true, freeze.blocked, true)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, idx)
			continue
		}
		if freeze.blocked == 1 && cand.HasBlockScope && cand.InboundBlockEligible &&
			model.ScopeCovers(freeze.unitScope, freeze.occurrenceID, freeze.effectOccurrenceKey, freeze.resultKey, freeze.candidateKey, freeze.useRef, cand.BlockScope, freeze.occurrenceID, cand.EffectOccurrenceKey, cand.ResultKey, cand.CandidateKey, freeze.useRef) {
			out = append(out, idx)
		}
	}
	_ = ability
	return out, nil
}

func (f *executionFrame) activeSpellShields(ownerKey string) []status.ProviderInstance {
	c, ok := f.run.combatants[ownerKey]
	if !ok {
		return nil
	}
	id, found := f.run.compiled.Types.Registry.Lookup(model.ProviderTypeSpellShield)
	if !found {
		return nil
	}
	var out []status.ProviderInstance
	for _, inst := range status.ActiveInstances(c.providers, f.run.nowMs) {
		if int(inst.DefinitionIndex) >= len(f.run.compiled.Providers) {
			continue
		}
		if f.run.compiled.Providers[inst.DefinitionIndex].TypeSet.Contains(id) {
			out = append(out, inst)
		}
	}
	return out
}

func (s *genericRunState) refreshEmittedEventLiveSnapshot(ev *emittedEvent) {
	if s == nil || ev == nil {
		return
	}
	if src, ok := s.combatants[ev.sourceKey]; ok {
		ev.snapshot.sourceAttrs = cloneAttributeMap(src.attributes)
		ev.snapshot.sourceResources = cloneResourceMap(src.resources)
	}
	if tgt, ok := s.combatants[ev.targetKey]; ok {
		ev.snapshot.targetAttrs = cloneAttributeMap(tgt.attributes)
		ev.snapshot.targetResources = cloneResourceMap(tgt.resources)
	}
	ev.snapshot.eventType = ev.eventType
	ev.snapshot.eventSourceKey = ev.sourceKey
	ev.snapshot.eventTargetKey = ev.targetKey
}

func (s *genericRunState) dispatchSkillHitEvent(ev emittedEvent, chainDepth int) *model.EngineError {
	freeze := ev.skillHit
	if freeze == nil || freeze.plan == nil {
		return s.dispatchListeners(ev, chainDepth)
	}
	for _, idx := range freeze.matchedIndexes {
		cand := freeze.plan.Candidates[idx]
		skipWrites := freeze.blocked == 1 && cand.HasBlockScope && model.ScopeCovers(freeze.unitScope, freeze.occurrenceID, freeze.effectOccurrenceKey, freeze.resultKey, freeze.candidateKey, freeze.useRef, cand.BlockScope, freeze.occurrenceID, cand.EffectOccurrenceKey, cand.ResultKey, cand.CandidateKey, freeze.useRef)
		if err := s.executeSkillHitCandidate(ev, freeze, cand, skipWrites, chainDepth); err != nil {
			return err
		}
	}
	s.refreshEmittedEventLiveSnapshot(&ev)
	if err := s.dispatchListeners(ev, chainDepth); err != nil {
		return err
	}
	if freeze.blocked == 1 && !freeze.reusedSkillUnit {
		return s.dispatchSpellShieldBlocked(ev, freeze, chainDepth)
	}
	return nil
}

func (s *genericRunState) executeSkillHitCandidate(ev emittedEvent, freeze *frozenSkillHitContext, cand compilebundle.CompiledSkillHitCandidate, skipWrites bool, chainDepth int) *model.EngineError {
	start := cand.OperationStart
	end := start + cand.OperationCount
	if int(end) > len(s.compiled.Operations) {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "skill hit candidate operation range out of bounds", cand.Path, cand.CandidateKey)
	}
	ops := s.compiled.Operations[start:end]
	frame := s.newExecutionFrame(freeze.sourceKey, freeze.targetKey, freeze.abilityRef)
	frame.chainDepth = chainDepth
	frame.eventCtx = cloneEventSnapshot(&ev.snapshot)
	if frame.eventCtx != nil && ev.eventType == model.EventTypeSkillHit {
		frame.eventCtx.hasSkillHit = true
		frame.eventCtx.skillHit = freeze
	}
	frame.castInstanceID = ev.castInstanceID
	frame.castOrigin = ev.castOrigin
	frame.skipBlockedWrites = skipWrites
	frame.skillHitCandidateKey = cand.CandidateKey
	frame.skillHitOccurrenceID = freeze.occurrenceID
	if err := frame.executeOperations(freeze.ability, ops); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	return frame.dispatchPendingEvents()
}

func (s *genericRunState) dispatchSpellShieldBlocked(parent emittedEvent, freeze *frozenSkillHitContext, chainDepth int) *model.EngineError {
	snap := parent.snapshot
	snap.eventType = model.EventTypeSpellShieldBlocked
	snap.hasSkillHit = true
	snap.skillHit = freeze
	ev := emittedEvent{
		eventType:      model.EventTypeSpellShieldBlocked,
		ref:            model.EventTypeSpellShieldBlocked,
		sourceKey:      freeze.sourceKey,
		targetKey:      freeze.targetKey,
		types:          []string{model.EventTypeSpellShieldBlocked},
		snapshot:       snap,
		castInstanceID: parent.castInstanceID,
		castOrigin:     parent.castOrigin,
		skillHit:       freeze,
	}
	s.recordEvidence(model.EvidenceItem{
		TimeMs: s.nowMs,
		Kind:   model.EvidenceKindEmittedEvent,
		Ref:    model.EventTypeSpellShieldBlocked,
		Data:   skillHitEvidenceData(freeze),
	})
	return s.dispatchListeners(ev, chainDepth)
}

func (f *executionFrame) expireProviderFromEvent(op compilebundle.CompiledOperation) *model.EngineError {
	if f.eventCtx == nil || f.eventCtx.skillHit == nil || f.eventCtx.eventType != model.EventTypeSpellShieldBlocked {
		return f.run.skillHitErr(model.GenericErrMissingRequiredField, "providerRefFromEvent requires event/spell_shield_blocked context", f.abilityRef, "")
	}
	freeze := f.eventCtx.skillHit
	if freeze.shieldProviderRef == "" || freeze.shieldOwner == "" {
		return f.run.skillHitErr(model.GenericErrMissingRequiredField, "spell shield freeze is missing owner/providerRef", model.EventTypeSpellShieldBlocked, "")
	}
	if f.ownerCombatantKey != "" && f.ownerCombatantKey != freeze.shieldOwner {
		return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "listener owner must equal the frozen spell shield bearer", f.ownerProviderRef, f.ownerCombatantKey)
	}
	c, ok := f.run.combatants[freeze.shieldOwner]
	if !ok {
		return f.run.skillHitErr(model.GenericErrUnknownRef, "frozen spell shield owner is missing", "combatants", freeze.shieldOwner)
	}
	inst, _, found := status.FindByRef(c.providers, freeze.shieldProviderRef)
	if !found {
		return f.run.skillHitErr(model.GenericErrUnknownRef, "frozen spell shield instance is missing", "providers", freeze.shieldProviderRef)
	}
	if freeze.shieldDefinitionRef != "" && inst.DefinitionRef != freeze.shieldDefinitionRef {
		return f.run.skillHitErr(model.GenericErrUnknownRef, "frozen spell shield definitionRef mismatch", freeze.shieldProviderRef, inst.DefinitionRef)
	}
	if f.ownerProviderRef != "" && f.ownerProviderRef != freeze.shieldProviderRef {
		return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "listener providerRef must equal the frozen shield instance", f.ownerProviderRef, freeze.shieldProviderRef)
	}
	sc := f.stageFor(freeze.shieldOwner)
	sc.providerOps = append(sc.providerOps, stagedProviderMutation{
		kind:          "expire",
		providerRef:   freeze.shieldProviderRef,
		definitionRef: freeze.shieldDefinitionRef,
		targetKey:     freeze.shieldOwner,
		sourceKey:     f.sourceKey,
		strict:        true,
	})
	sc.dirty = true
	_ = op
	return nil
}

func (s *genericRunState) removeProviderInstanceStrict(targetKey, providerRef, definitionRef string, evalCtx formula.GenericEvalContext) *model.EngineError {
	c, ok := s.combatants[targetKey]
	if !ok {
		return s.skillHitErr(model.GenericErrUnknownRef, "expire_provider owner is missing", "combatants", targetKey)
	}
	inst, _, found := status.FindByRef(c.providers, providerRef)
	if !found {
		return s.skillHitErr(model.GenericErrUnknownRef, "expire_provider instance is missing", "providers", providerRef)
	}
	if definitionRef != "" && inst.DefinitionRef != definitionRef {
		return s.skillHitErr(model.GenericErrUnknownRef, "expire_provider definitionRef mismatch", providerRef, inst.DefinitionRef)
	}
	s.removeProviderInstance(targetKey, providerRef, evalCtx, model.EvidenceKindProviderRemove)
	return nil
}

func (s *genericRunState) bindDynamicProviderListeners() {
	static := map[string]bool{}
	for _, combatant := range s.compiled.Combatants {
		for _, mount := range combatant.ProviderMounts {
			static[combatant.Key+"\x00"+mount.ProviderRef] = true
		}
	}
	for _, c := range s.combatants {
		for _, inst := range c.providers {
			if static[c.key+"\x00"+inst.ProviderRef] {
				continue
			}
			s.bindProviderInstanceListeners(inst)
		}
	}
}

func (s *genericRunState) bindProviderInstanceListeners(inst status.ProviderInstance) {
	if int(inst.DefinitionIndex) >= len(s.compiled.Providers) {
		return
	}
	provider := s.compiled.Providers[inst.DefinitionIndex]
	for _, listener := range provider.Listeners {
		bound := listener
		bound.OwnerCombatantKey = inst.Owner
		bound.OwnerProviderRef = inst.ProviderRef
		s.runtimeListeners = append(s.runtimeListeners, bound)
	}
}

func (s *genericRunState) unbindProviderInstanceListeners(ownerKey, providerRef string) {
	if providerRef == "" || len(s.runtimeListeners) == 0 {
		return
	}
	out := s.runtimeListeners[:0]
	for _, listener := range s.runtimeListeners {
		if listener.OwnerProviderRef != providerRef || listener.OwnerCombatantKey != ownerKey {
			out = append(out, listener)
		}
	}
	s.runtimeListeners = out
}

func (s *genericRunState) listenerStillLive(listener compilebundle.CompiledListener) bool {
	if listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" {
		return true
	}
	c, ok := s.combatants[listener.OwnerCombatantKey]
	if !ok {
		return false
	}
	inst, _, found := status.FindByRef(c.providers, listener.OwnerProviderRef)
	if !found {
		return false
	}
	return !inst.Expired(s.nowMs)
}
