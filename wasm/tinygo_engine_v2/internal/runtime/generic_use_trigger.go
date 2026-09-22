package runtime

import (
	"math"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const maxUseTriggerLedger = 1024

const nativeHitFollowUpSuffix = "__native_hit"
const nativeBasicAttackSkillPrefix = "aa:"

func isNativeHitFollowUp(entryKey string) bool {
	return strings.HasSuffix(entryKey, nativeHitFollowUpSuffix)
}

type useTriggerKey struct {
	owner       string
	providerRef string
	groupKey    string
	scope       string
	useSource   string
	useKey      string
	target      string
}

type useTriggerRecord struct {
	key         useTriggerKey
	useSkillKey string
	reserved    bool
	committed   bool
}

func (s *genericRunState) initUseTriggerState() *model.EngineError {
	s.useTriggerLedger = map[useTriggerKey]*useTriggerRecord{}
	s.useTriggerReserving = 0
	if err := s.validateAttackStartFacts(); err != nil {
		return err
	}
	return s.restoreUseTriggerLedger(s.req.InitialSnapshot.UseTriggerLedger)
}

func (s *genericRunState) validateAttackStartFacts() *model.EngineError {
	if len(s.req.AttackStartFacts) > maxSkillHitFactsPerRun {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "attackStartFacts exceeded dedicated budget", "attackStartFacts", "")
	}
	s.attackStartFacts = map[string]model.AttackStartFact{}
	seenEntry := map[string]int{}
	seenUse := map[string]int{}
	startEntries := map[string]int{}
	for i, entry := range s.req.DriverPlan.Entries {
		ability, _, ok := s.lookupDriverAbility(entry)
		if !ok || ability.HasSkillHit || !ability.IsBasicAttack || ability.OperationCount != 0 {
			continue
		}
		startEntries[entry.EntryKey] = i
	}
	for i, fact := range s.req.AttackStartFacts {
		path := "attackStartFacts[" + itoa(uint32(i)) + "]"
		if strings.TrimSpace(fact.DriverEntryKey) == "" {
			return s.skillHitErr(model.GenericErrMissingRequiredField, "attackStartFacts.driverEntryKey is required", path+".driverEntryKey", "")
		}
		if prev, ok := seenEntry[fact.DriverEntryKey]; ok {
			return s.skillHitErr(model.GenericErrUnknownRef, "duplicate attackStartFacts.driverEntryKey", path+".driverEntryKey", fact.DriverEntryKey+" previously "+itoa(uint32(prev)))
		}
		seenEntry[fact.DriverEntryKey] = i
		entryIdx, ok := startEntries[fact.DriverEntryKey]
		if !ok {
			return s.skillHitErr(model.GenericErrUnknownRef, "attackStartFact must point to a single empty-operations basic_attack start driver", path+".driverEntryKey", fact.DriverEntryKey)
		}
		entry := s.req.DriverPlan.Entries[entryIdx]
		if entry.Repeat != nil || s.isWhileReady(entry) {
			return s.skillHitErr(model.GenericErrUnknownRef, "attack start driver cannot use Repeat or WhileReady", "driverPlan.entries["+entry.EntryKey+"]", entry.AbilityRef)
		}
		ability, _, _ := s.lookupDriverAbility(entry)
		if ability.HasSkillHit {
			return s.skillHitErr(model.GenericErrUnknownRef, "attackStartFact cannot point to resolve_skill_hit", path+".driverEntryKey", fact.DriverEntryKey)
		}
		if strings.TrimSpace(fact.UseRef) == "" {
			return s.skillHitErr(model.GenericErrMissingRequiredField, "attackStartFacts.useRef is required", path+".useRef", fact.DriverEntryKey)
		}
		use, found := s.skillUses[fact.UseRef]
		if !found {
			return s.skillHitErr(model.GenericErrUnknownRef, "attackStartFact.useRef is not a declared skill use", path+".useRef", fact.UseRef)
		}
		if prev, ok := seenUse[fact.UseRef]; ok {
			return s.skillHitErr(model.GenericErrUnknownRef, "duplicate attack start for the same use", path+".useRef", fact.UseRef+" previously "+itoa(uint32(prev)))
		}
		seenUse[fact.UseRef] = i
		if use.source != entry.Source {
			return s.skillHitErr(model.GenericErrUnknownRef, "attack start use source must equal the driver source", path+".useRef", fact.UseRef)
		}
		if strings.TrimSpace(ability.SkillKey) == "" {
			return s.skillHitErr(model.GenericErrMissingRequiredField, "attack start ability requires skillKey", "driverPlan.entries["+entry.EntryKey+"]", entry.AbilityRef)
		}
		if use.skillKey != ability.SkillKey {
			return s.skillHitErr(model.GenericErrUnknownRef, "attack start skillKey must equal skillUses.skillKey", path+".useRef", fact.UseRef)
		}
		if _, ok := s.compiled.Types.Registry.Lookup(model.EventTypeBasicAttackStart); !ok {
			return s.skillHitErr(model.GenericErrUnknownTypeKey, "attack start requires event/basic_attack_start in typeCatalog", path, model.EventTypeBasicAttackStart)
		}
		s.attackStartFacts[fact.DriverEntryKey] = fact
	}
	return s.validateAttackStartHitOrder()
}

func (s *genericRunState) validateAttackStartHitOrder() *model.EngineError {
	type order struct {
		timeMs   int64
		priority int16
		index    int
		entryKey string
	}
	startsByUse := map[string]order{}
	for entryKey, fact := range s.attackStartFacts {
		entry := s.driverEntryByKey(entryKey)
		startsByUse[fact.UseRef] = order{timeMs: entry.FirstAtMs, priority: int16(entry.Priority), index: s.driverIndexByKey(entryKey), entryKey: entryKey}
	}
	for entryKey, fact := range s.skillHitFacts {
		if fact.UseRef == nil || *fact.UseRef == "" {
			continue
		}
		start, ok := startsByUse[*fact.UseRef]
		if !ok {
			continue
		}
		hitEntry := s.driverEntryByKey(entryKey)
		hit := order{timeMs: hitEntry.FirstAtMs, priority: int16(hitEntry.Priority), index: s.driverIndexByKey(entryKey), entryKey: entryKey}
		if !attackStartBeforeHit(start, hit) {
			return s.skillHitErr(model.GenericErrUnknownRef, "attack start must precede the corresponding hit in heap order", "attackStartFacts", start.entryKey+" vs "+hit.entryKey)
		}
	}
	return nil
}

func attackStartBeforeHit(start, hit struct {
	timeMs   int64
	priority int16
	index    int
	entryKey string
}) bool {
	if start.timeMs != hit.timeMs {
		return start.timeMs < hit.timeMs
	}
	if start.priority != hit.priority {
		return start.priority < hit.priority
	}
	return start.index < hit.index
}

func (s *genericRunState) driverIndexByKey(entryKey string) int {
	for i, entry := range s.req.DriverPlan.Entries {
		if entry.EntryKey == entryKey {
			return i
		}
	}
	return math.MaxInt32
}

func (s *genericRunState) restoreUseTriggerLedger(rows []model.UseTriggerLedgerEntry) *model.EngineError {
	if len(rows) > maxUseTriggerLedger {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "useTriggerLedger exceeded dedicated budget", "initialSnapshot.useTriggerLedger", "")
	}
	mounted := s.mountedOncePerUseGroups()
	seen := map[useTriggerKey]int{}
	for i, row := range rows {
		path := "initialSnapshot.useTriggerLedger[" + itoa(uint32(i)) + "]"
		if err := s.validateRestoredLedgerRow(row, path, mounted); err != nil {
			return err
		}
		key := ledgerKeyFromEntry(row)
		if prev, ok := seen[key]; ok {
			return s.skillHitErr(model.GenericErrUnknownRef, "duplicate useTriggerLedger key", path, "previously "+itoa(uint32(prev)))
		}
		seen[key] = i
		s.useTriggerLedger[key] = &useTriggerRecord{key: key, useSkillKey: row.UseSkillKey, committed: true}
	}
	return nil
}

func (s *genericRunState) mountedOncePerUseGroups() map[string]compilebundle.CompiledListener {
	out := map[string]compilebundle.CompiledListener{}
	for _, listener := range s.compiled.Listeners {
		if !listener.HasOncePerUse || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" {
			continue
		}
		if !s.listenerStillLive(listener) {
			continue
		}
		id := listener.OwnerCombatantKey + "\x00" + listener.OwnerProviderRef + "\x00" + listener.OncePerUseGroup + "\x00" + listener.OncePerUseScope
		out[id] = listener
	}
	return out
}

func (s *genericRunState) validateRestoredLedgerRow(row model.UseTriggerLedgerEntry, path string, mounted map[string]compilebundle.CompiledListener) *model.EngineError {
	if strings.TrimSpace(row.Owner) == "" || strings.TrimSpace(row.ProviderRef) == "" || strings.TrimSpace(row.GroupKey) == "" ||
		strings.TrimSpace(row.Scope) == "" || strings.TrimSpace(row.UseSource) == "" || strings.TrimSpace(row.UseSkillKey) == "" || strings.TrimSpace(row.UseKey) == "" {
		return s.skillHitErr(model.GenericErrMissingRequiredField, "useTriggerLedger fields must be complete", path, row.UseKey)
	}
	if _, ok := model.ValidOncePerUseScope[row.Scope]; !ok {
		return s.skillHitErr(model.GenericErrUnknownRef, "useTriggerLedger.scope must be provider or provider_target", path+".scope", row.Scope)
	}
	if !s.combatantExists(row.UseSource) {
		return s.skillHitErr(model.GenericErrUnknownRef, "useTriggerLedger.useSource is not a snapshot actor", path+".useSource", row.UseSource)
	}
	if row.Target != nil && !s.combatantExists(*row.Target) {
		return s.skillHitErr(model.GenericErrUnknownRef, "useTriggerLedger.target is not a snapshot actor", path+".target", *row.Target)
	}
	if row.Scope == model.OncePerUseScopeProviderTarget && (row.Target == nil || strings.TrimSpace(*row.Target) == "") {
		return s.skillHitErr(model.GenericErrMissingRequiredField, "provider_target ledger rows require target", path+".target", row.UseKey)
	}
	if row.Scope == model.OncePerUseScopeProvider && row.Target != nil {
		return s.skillHitErr(model.GenericErrUnknownRef, "provider-scope ledger rows cannot carry a target", path+".target", row.UseKey)
	}
	mountID := row.Owner + "\x00" + row.ProviderRef + "\x00" + row.GroupKey + "\x00" + row.Scope
	if _, ok := mounted[mountID]; !ok {
		return s.skillHitErr(model.GenericErrUnknownRef, "useTriggerLedger must match a currently mounted oncePerUse listener group", path, row.GroupKey)
	}
	if use, ok := s.skillUses[row.UseKey]; ok {
		if use.source != row.UseSource || use.skillKey != row.UseSkillKey {
			return s.skillHitErr(model.GenericErrUnknownRef, "reused useTriggerLedger useKey must match skillUses source and skillKey", path+".useKey", row.UseKey)
		}
	}
	return nil
}

func ledgerKeyFromEntry(row model.UseTriggerLedgerEntry) useTriggerKey {
	key := useTriggerKey{
		owner:       row.Owner,
		providerRef: row.ProviderRef,
		groupKey:    row.GroupKey,
		scope:       row.Scope,
		useSource:   row.UseSource,
		useKey:      row.UseKey,
	}
	if row.Scope == model.OncePerUseScopeProviderTarget && row.Target != nil {
		key.target = *row.Target
	}
	return key
}

func (s *genericRunState) oncePerUseKey(listener compilebundle.CompiledListener, ev emittedEvent) (useTriggerKey, *model.EngineError) {
	if !ev.hasUse || strings.TrimSpace(ev.useKey) == "" {
		return useTriggerKey{}, s.skillHitErr(model.GenericErrMissingRequiredField, "oncePerUse requires a real use fact on the triggering event", "listeners["+listener.ListenerKey+"].oncePerUse", listener.OncePerUseGroup)
	}
	if !model.IsRealUseEvent(ev.eventType) {
		return useTriggerKey{}, s.skillHitErr(model.GenericErrUnknownRef, "oncePerUse only accepts skill_hit, basic_attack_hit or basic_attack_start", "listeners["+listener.ListenerKey+"].oncePerUse", ev.eventType)
	}
	key := useTriggerKey{
		owner:       listener.OwnerCombatantKey,
		providerRef: listener.OwnerProviderRef,
		groupKey:    listener.OncePerUseGroup,
		scope:       listener.OncePerUseScope,
		useSource:   ev.useSource,
		useKey:      ev.useKey,
	}
	if listener.OncePerUseScope == model.OncePerUseScopeProviderTarget {
		key.target = ev.targetKey
	}
	return key, nil
}

func (s *genericRunState) reserveOncePerUse(listener compilebundle.CompiledListener, ev emittedEvent) (reserved bool, skip bool, err *model.EngineError) {
	if !listener.HasOncePerUse {
		return false, false, nil
	}
	if listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" {
		return false, false, s.skillHitErr(model.GenericErrUnknownRef, "oncePerUse requires a mounted provider listener", listener.ListenerKey, listener.OncePerUseGroup)
	}
	key, err := s.oncePerUseKey(listener, ev)
	if err != nil {
		return false, false, err
	}
	if rec, ok := s.useTriggerLedger[key]; ok && (rec.committed || rec.reserved) {
		return false, true, nil
	}
	if len(s.useTriggerLedger) >= maxUseTriggerLedger {
		return false, false, s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "useTriggerLedger exceeded dedicated budget", "useTriggerLedger", listener.OncePerUseGroup)
	}
	s.useTriggerLedger[key] = &useTriggerRecord{key: key, useSkillKey: ev.useSkillKey, reserved: true}
	s.useTriggerReserving++
	return true, false, nil
}

func (s *genericRunState) commitOncePerUse(listener compilebundle.CompiledListener, ev emittedEvent) {
	if !listener.HasOncePerUse {
		return
	}
	key, err := s.oncePerUseKey(listener, ev)
	if err != nil {
		return
	}
	if rec, ok := s.useTriggerLedger[key]; ok {
		rec.reserved = false
		rec.committed = true
	}
	if s.useTriggerReserving > 0 {
		s.useTriggerReserving--
	}
}

func (s *genericRunState) snapshotUseTriggerLedger() []model.UseTriggerLedgerEntry {
	out := make([]model.UseTriggerLedgerEntry, 0, len(s.useTriggerLedger))
	for _, rec := range s.useTriggerLedger {
		if rec == nil || !rec.committed {
			continue
		}
		entry := model.UseTriggerLedgerEntry{
			Owner:       rec.key.owner,
			ProviderRef: rec.key.providerRef,
			GroupKey:    rec.key.groupKey,
			Scope:       rec.key.scope,
			UseSource:   rec.key.useSource,
			UseSkillKey: rec.useSkillKey,
			UseKey:      rec.key.useKey,
		}
		if rec.key.scope == model.OncePerUseScopeProviderTarget {
			target := rec.key.target
			entry.Target = &target
		}
		out = append(out, entry)
	}
	sortUseTriggerLedger(out)
	return out
}

func sortUseTriggerLedger(rows []model.UseTriggerLedgerEntry) {
	for i := 0; i < len(rows); i++ {
		for j := i + 1; j < len(rows); j++ {
			if useTriggerLedgerLess(rows[j], rows[i]) {
				rows[i], rows[j] = rows[j], rows[i]
			}
		}
	}
}

func useTriggerLedgerLess(a, b model.UseTriggerLedgerEntry) bool {
	if a.Owner != b.Owner {
		return a.Owner < b.Owner
	}
	if a.ProviderRef != b.ProviderRef {
		return a.ProviderRef < b.ProviderRef
	}
	if a.GroupKey != b.GroupKey {
		return a.GroupKey < b.GroupKey
	}
	if a.Scope != b.Scope {
		return a.Scope < b.Scope
	}
	if a.UseSource != b.UseSource {
		return a.UseSource < b.UseSource
	}
	if a.UseKey != b.UseKey {
		return a.UseKey < b.UseKey
	}
	if a.UseSkillKey != b.UseSkillKey {
		return a.UseSkillKey < b.UseSkillKey
	}
	at, bt := "", ""
	if a.Target != nil {
		at = *a.Target
	}
	if b.Target != nil {
		bt = *b.Target
	}
	return at < bt
}

func (s *genericRunState) lazyExpireAllProviderState() {
	for key, c := range s.combatants {
		for _, bag := range c.providerState {
			if bag == nil {
				continue
			}
			bag.lazyExpireProviderState(s.nowMs)
			bag.lazyExpireProviderTargetState(s.nowMs)
		}
		s.combatants[key] = c
	}
}

func addDuration(nowMs, durationMs int64) (int64, bool) {
	if durationMs <= 0 {
		return 0, false
	}
	if nowMs > 0 && durationMs > math.MaxInt64-nowMs {
		return 0, false
	}
	if nowMs < 0 && durationMs < math.MinInt64-nowMs {
		return 0, false
	}
	return nowMs + durationMs, true
}

func (s *genericRunState) evalListenerCondition(listener compilebundle.CompiledListener, ev emittedEvent) (bool, *model.EngineError) {
	sourceKey, targetKey := s.listenerFrameCombatants(ev, listener)
	ability := compilebundle.CompiledAbility{Params: map[string]float64{}}
	if listener.SourceAbilityIndex >= 0 && listener.SourceAbilityIndex < len(s.compiled.Abilities) {
		ability = s.compiled.Abilities[listener.SourceAbilityIndex]
	}
	frame := s.newExecutionFrame(sourceKey, targetKey, "listener:"+listener.ListenerKey)
	frame.ownerCombatantKey = listener.OwnerCombatantKey
	frame.ownerProviderRef = listener.OwnerProviderRef
	frame.eventCtx = cloneEventSnapshot(&ev.snapshot)
	if frame.eventCtx != nil {
		if frame.eventCtx.castInstanceID == 0 {
			frame.eventCtx.castInstanceID = ev.castInstanceID
		}
		if frame.eventCtx.castOrigin == "" {
			frame.eventCtx.castOrigin = ev.castOrigin
		}
	}
	ctx := frame.evalContext(ability)
	ctx.StrictReads = true
	value, err := s.compiled.Formulas.Eval(listener.ConditionProgram, ctx)
	if err != nil {
		out := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
		out.Path = "listeners[" + listener.ListenerKey + "].condition"
		out.Ref = listener.ListenerKey
		return false, out
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return false, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "listener.condition result must be finite", "listeners["+listener.ListenerKey+"].condition", listener.ListenerKey, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	return value != 0, nil
}
