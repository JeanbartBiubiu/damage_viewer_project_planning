// generic run state 与单次 deterministic run 主循环（Slice C1）。
package runtime

import (
	"encoding/json"
	"math"
	"sort"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/scheduler"
	shieldpkg "tinygo_engine_v2/internal/shield"
	"tinygo_engine_v2/internal/status"
)

const (
	defaultConditionRecheckMs = 100
	minConditionRecheckMs     = 10
	maxConditionRecheckMs     = 1000
)

type combatantRuntime struct {
	key           string
	attributes    map[string]model.AttributeSlotDef
	resources     map[string]model.ResourceSlotDef
	cooldowns     map[string]int64
	providers     []status.ProviderInstance
	shields       []shieldpkg.Instance
	resolver      pipeline.AttributeResolver
	providerState map[string]*providerStateBag
}

type abilityStatAcc struct {
	abilityRef   string
	attemptCount int
	castCount    int
	skipCount    int
	damageDealt  *float64
	healingDone  *float64
}

type damageRecord struct {
	timeMs    int64
	sourceKey string
	targetKey string
	amount    float64
}

type genericRunState struct {
	compiled                   compilebundle.CompiledSession
	req                        model.RunRequest
	nowMs                      int64
	startMs                    int64
	durationMs                 int64
	conditionRecheckIntervalMs int64

	combatants map[string]combatantRuntime
	heap       scheduler.GenericHeap

	budget model.SafetyBudget

	abilityAttemptCount int
	abilityCastCount    int
	attemptSkippedCount int
	abilityStats        map[string]*abilityStatAcc

	sourceDamageDealt float64
	sourceDamageTaken float64
	targetDamageDealt float64
	targetDamageTaken float64
	sourceOverheal    float64
	targetOverheal    float64
	damageHistory     []damageRecord
	nextFrameID       uint64

	evidence               []model.EvidenceItem
	evidenceTruncated      bool
	truncatedEvidenceCount int
	evidenceCountsByKind   map[string]int

	series                []model.SeriesPoint
	seriesDownsampled     bool
	sampling              model.SamplingConfig
	processedEvents       int
	stopReason            model.StopReason
	stopReasonSet         bool
	entryAttemptCounts    []int
	entryConditions       []*formula.GenericProgramID
	entryIntervalPrograms []*formula.GenericProgramID

	expireCleanupPayloads  []expireCleanupPayload
	nextProviderInstanceID uint64
}

// RunGeneric 执行单次 generic deterministic run，返回 DoneResult。
func RunGeneric(compiled compilebundle.CompiledSession, req model.RunRequest) (model.DoneResult, *model.EngineError) {
	state, err := newGenericRunState(compiled, req)
	if err != nil {
		return model.DoneResult{}, err
	}
	if runErr := state.runLoop(); runErr != nil {
		return model.DoneResult{}, runErr
	}
	return state.buildDoneResult(), nil
}

func newGenericRunState(compiled compilebundle.CompiledSession, req model.RunRequest) (*genericRunState, *model.EngineError) {
	recheck := normalizeConditionRecheckInterval(req.DriverPlan.ConditionRecheckIntervalMs)

	sampling := req.Sampling
	defaults := model.DefaultSamplingConfig()
	if sampling.SampleEveryMs <= 0 {
		sampling.SampleEveryMs = defaults.SampleEveryMs
	}
	if sampling.DpsWindowMs <= 0 {
		sampling.DpsWindowMs = defaults.DpsWindowMs
	}
	if sampling.MaxSeriesPoints <= 0 {
		sampling.MaxSeriesPoints = defaults.MaxSeriesPoints
	}

	budget := model.DefaultSafetyBudget()
	compileMaxEvents := 0
	if compiled.Settings.MaxEvents > 0 {
		compileMaxEvents = compiled.Settings.MaxEvents
		budget.MaxEvents = compileMaxEvents
	}
	if compiled.Settings.MaxCommandsPerEvent > 0 {
		budget.MaxCommandsPerEvent = compiled.Settings.MaxCommandsPerEvent
	}
	if compiled.Settings.MaxChainDepth > 0 {
		budget.MaxChainDepth = compiled.Settings.MaxChainDepth
	}
	if req.SafetyBudget != nil {
		sb := req.SafetyBudget
		if sb.MaxChainDepth > 0 {
			budget.MaxChainDepth = sb.MaxChainDepth
		}
		if sb.MaxCommandsPerEvent > 0 {
			budget.MaxCommandsPerEvent = sb.MaxCommandsPerEvent
		}
		if sb.MaxEvents > 0 {
			if compileMaxEvents > 0 && sb.MaxEvents > compileMaxEvents {
				budget.MaxEvents = compileMaxEvents
			} else {
				budget.MaxEvents = sb.MaxEvents
			}
		}
	}
	validateRuntimeOptions(req.RuntimeOptions)

	state := &genericRunState{
		compiled:                   compiled,
		req:                        req,
		nowMs:                      req.InitialSnapshot.TimeMs,
		startMs:                    req.InitialSnapshot.TimeMs,
		durationMs:                 req.StopPolicy.DurationMs,
		conditionRecheckIntervalMs: recheck,
		combatants:                 materializeCombatants(req.InitialSnapshot, compiled),
		heap:                       scheduler.NewGenericHeap(64),
		budget:                     budget,
		sampling:                   sampling,
		abilityStats:               make(map[string]*abilityStatAcc),
		entryAttemptCounts:         make([]int, len(req.DriverPlan.Entries)),
		evidenceCountsByKind:       make(map[string]int),
	}

	state.seedDriverAttempts()
	state.seedSampleEvents()
	state.seedExpireCleanups()
	state.seedProviderTicks()
	if err := state.compileDriverConditions(); err != nil {
		return nil, err
	}
	return state, nil
}

func (s *genericRunState) compileDriverConditions() *model.EngineError {
	n := len(s.req.DriverPlan.Entries)
	s.entryConditions = make([]*formula.GenericProgramID, n)
	s.entryIntervalPrograms = make([]*formula.GenericProgramID, n)
	var compileErrors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		err := model.NewEngineError(model.GenericPhaseRun, code, message)
		err.Path = path
		err.Ref = ref
		err.SchemaHash = s.compiled.SchemaHash
		err.RulesHash = s.compiled.RulesHash
		err.SessionID = s.req.SessionID
		compileErrors = append(compileErrors, err)
	}
	for i, entry := range s.req.DriverPlan.Entries {
		if entry.Condition != nil {
			path := "driverPlan.entries[" + entry.EntryKey + "].condition"
			instr := formula.CompileGenericFormula(*entry.Condition, path, map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
			if len(instr) > 0 {
				key := "run:" + path
				id := formula.GenericProgramID(len(s.compiled.Formulas.Programs))
				s.compiled.Formulas.Programs = append(s.compiled.Formulas.Programs, formula.GenericProgram{Key: key, Instr: instr})
				s.entryConditions[i] = &id
			}
		}
		if entry.Repeat == nil {
			continue
		}
		repeatPath := "driverPlan.entries[" + entry.EntryKey + "].repeat"
		hasFixed := entry.Repeat.IntervalMs > 0
		hasFormula := entry.Repeat.IntervalFormula != nil
		switch {
		case hasFixed && hasFormula:
			addError(model.GenericErrFormulaTypeError, repeatPath, "repeat must have exactly one of intervalMs or intervalFormula", entry.AbilityRef)
		case !hasFixed && !hasFormula:
			addError(model.GenericErrMissingRequiredField, repeatPath, "repeat requires intervalMs or intervalFormula", entry.AbilityRef)
		case hasFormula:
			path := repeatPath + ".intervalFormula"
			instr := formula.CompileGenericFormula(*entry.Repeat.IntervalFormula, path, map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
			if len(instr) == 0 {
				continue
			}
			key := "run:" + path
			id := formula.GenericProgramID(len(s.compiled.Formulas.Programs))
			s.compiled.Formulas.Programs = append(s.compiled.Formulas.Programs, formula.GenericProgram{Key: key, Instr: instr})
			s.entryIntervalPrograms[i] = &id
		}
	}
	if len(compileErrors) > 0 {
		return engineErrorPtr(model.GenericPhaseRun, compileErrors[0].Code, compileErrors[0].Message, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	return nil
}

func normalizeConditionRecheckInterval(raw int64) int64 {
	if raw <= 0 {
		return defaultConditionRecheckMs
	}
	if raw < minConditionRecheckMs {
		return minConditionRecheckMs
	}
	if raw > maxConditionRecheckMs {
		return maxConditionRecheckMs
	}
	return raw
}

func materializeCombatants(snapshot model.Snapshot, compiled compilebundle.CompiledSession) map[string]combatantRuntime {
	out := make(map[string]combatantRuntime, len(snapshot.Combatants))
	for _, c := range snapshot.Combatants {
		attrs := c.Attributes
		if attrs == nil {
			attrs = map[string]model.AttributeSlotDef{}
		}
		resources := c.Resources
		if resources == nil {
			resources = map[string]model.ResourceSlotDef{}
		}
		providers, resolver := materializeProviders(c.Providers, c.Key, compiled)
		shields := materializeShields(c.Shields, c.Key)
		out[c.Key] = combatantRuntime{
			key:           c.Key,
			attributes:    cloneAttributeMap(attrs),
			resources:     cloneResourceMap(resources),
			cooldowns:     materializeCooldowns(c.Cooldowns),
			providers:     providers,
			shields:       shields,
			resolver:      resolver,
			providerState: materializeProviderState(c.ProviderState),
		}
	}
	// Cross-combatant provider modifiers (e.g. opponent.attr.*) then rule modifiers.
	remountAllProviderModifiers(out, compiled)
	for key, c := range out {
		resolver := c.resolver
		mountRuleModifiers(&resolver, key, compiled)
		c.resolver = resolver
		out[key] = c
	}
	// Resolve with same-combatant eval first, then cross-combatant context.
	for key, c := range out {
		evalCtx := formula.GenericEvalContext{
			SourceAttrs: c.attributes,
			TargetAttrs: c.attributes,
		}
		c.attributes = c.resolver.ResolveAttributesWithProviderContext(
			c.attributes, evalCtx, compiled.Formulas,
			func(ownerKey, providerRef string) formula.GenericEvalContext {
				bagOwner := ownerKey
				if bagOwner == "" {
					bagOwner = key
				}
				owner, ok := out[bagOwner]
				if !ok {
					return providerFormulaContextFromBag(nil, providerTargetActiveKey(key, ownerKey, ""))
				}
				bag := owner.providerState[providerRef]
				if bag != nil {
					bag.bindFieldDefs(compiledStateFieldsForProvider(compiled, bagOwner, providerRef, owner.providers))
				}
				return providerFormulaContextFromBag(bag, providerTargetActiveKey(key, ownerKey, ""))
			},
		)
		out[key] = c
	}
	// Re-resolve with cross-combatant eval context after both sides exist.
	sourceAttrs := map[string]model.AttributeSlotDef{}
	targetAttrs := map[string]model.AttributeSlotDef{}
	if src, ok := out[model.SelectorSource]; ok {
		sourceAttrs = src.attributes
	}
	if tgt, ok := out[model.SelectorTarget]; ok {
		targetAttrs = tgt.attributes
	}
	for key, c := range out {
		evalCtx := formula.GenericEvalContext{
			SourceAttrs: sourceAttrs,
			TargetAttrs: targetAttrs,
		}
		// Same-combatant cast-proxy default remains target (historical materialize semantics).
		castProxy := model.SelectorTarget
		c.attributes = c.resolver.ResolveAttributesWithProviderContext(
			c.attributes, evalCtx, compiled.Formulas,
			func(ownerKey, providerRef string) formula.GenericEvalContext {
				bagOwner := ownerKey
				if bagOwner == "" {
					bagOwner = key
				}
				owner, ok := out[bagOwner]
				if !ok {
					return providerFormulaContextFromBag(nil, providerTargetActiveKey(key, ownerKey, castProxy))
				}
				bag := owner.providerState[providerRef]
				if bag != nil {
					bag.bindFieldDefs(compiledStateFieldsForProvider(compiled, bagOwner, providerRef, owner.providers))
				}
				return providerFormulaContextFromBag(bag, providerTargetActiveKey(key, ownerKey, castProxy))
			},
		)
		out[key] = c
	}
	return out
}

func mountRuleModifiers(resolver *pipeline.AttributeResolver, combatantKey string, compiled compilebundle.CompiledSession) {
	for _, mod := range compiled.RuleModifiers {
		if mod.Kind != "attribute" && mod.Kind != "" {
			continue
		}
		selector := pipeline.ModifierTargetCombatantSelector(mod.Target)
		switch selector {
		case "":
			// Bare attribute key: apply to both combatants is too broad; skip unless path is explicit.
			// Provider-mounted bare keys remain supported via MountProviderModifiers.
			continue
		case model.SelectorSource:
			if combatantKey != model.SelectorSource {
				continue
			}
		case model.SelectorTarget:
			if combatantKey != model.SelectorTarget {
				continue
			}
		case model.SelectorSelf, model.SelectorOpponent:
			// Rule-level self/opponent has no entry context; treat as source/target aliases.
			if selector == model.SelectorSelf && combatantKey != model.SelectorSource {
				continue
			}
			if selector == model.SelectorOpponent && combatantKey != model.SelectorTarget {
				continue
			}
		default:
			if combatantKey != selector {
				continue
			}
		}
		resolver.MountCompiledModifier("rules", mod)
	}
}

func cloneAttributeMap(src map[string]model.AttributeSlotDef) map[string]model.AttributeSlotDef {
	dst := make(map[string]model.AttributeSlotDef, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func cloneResourceMap(src map[string]model.ResourceSlotDef) map[string]model.ResourceSlotDef {
	dst := make(map[string]model.ResourceSlotDef, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func (s *genericRunState) combatantHp(key string) float64 {
	c, ok := s.combatants[key]
	if !ok {
		return 0
	}
	if slot, ok := c.attributes["hp"]; ok {
		return slot.Current
	}
	return 0
}

func (s *genericRunState) combatantHasHp(key string) bool {
	c, ok := s.combatants[key]
	if !ok {
		return false
	}
	_, ok = c.attributes["hp"]
	return ok
}

func (s *genericRunState) seedDriverAttempts() {
	for i, entry := range s.req.DriverPlan.Entries {
		s.enqueueAttempt(entry.FirstAtMs, i, 0)
		// Fixed interval: pre-schedule future attempts. Dynamic (intervalFormula): seed first only.
		if entry.Repeat != nil && entry.Repeat.IntervalMs > 0 {
			maxAttempts := entry.Repeat.MaxAttempts
			if maxAttempts <= 0 {
				maxAttempts = s.estimateRepeatAttempts(entry)
			}
			for n := 1; n < maxAttempts; n++ {
				at := entry.FirstAtMs + int64(n)*entry.Repeat.IntervalMs
				if at > s.startMs+s.durationMs {
					break
				}
				s.enqueueAttempt(at, i, n)
			}
		}
	}
}

func (s *genericRunState) estimateRepeatAttempts(entry model.DriverEntry) int {
	if entry.Repeat == nil || entry.Repeat.IntervalMs <= 0 {
		return 1
	}
	span := s.durationMs
	if span <= 0 {
		return 1
	}
	firstOffset := entry.FirstAtMs - s.startMs
	if firstOffset < 0 {
		firstOffset = 0
	}
	remaining := span - firstOffset
	if remaining < 0 {
		return 1
	}
	count := int(remaining/entry.Repeat.IntervalMs) + 1
	if count > s.budget.MaxEvents {
		count = s.budget.MaxEvents
	}
	return count
}

func (s *genericRunState) seedSampleEvents() {
	every := int64(s.sampling.SampleEveryMs)
	if every <= 0 {
		return
	}
	end := s.startMs + s.durationMs
	for t := s.startMs; t <= end; t += every {
		_ = s.heap.Push(scheduler.GenericEvent{
			TimeMs:   t,
			Category: scheduler.GenericCategorySample,
			Kind:     scheduler.GenericEventSample,
		})
	}
}

func (s *genericRunState) enqueueAttempt(timeMs int64, entryIndex, attemptIndex int) {
	entry := s.req.DriverPlan.Entries[entryIndex]
	_ = s.heap.Push(scheduler.GenericEvent{
		TimeMs:           timeMs,
		Category:         scheduler.GenericCategoryAbilityAttempt,
		Priority:         int16(entry.Priority),
		Kind:             scheduler.GenericEventAbilityAttempt,
		DriverEntryIndex: entryIndex,
		AttemptIndex:     attemptIndex,
	})
}

func (s *genericRunState) runLoop() *model.EngineError {
	for {
		if s.processedEvents >= s.budget.MaxEvents {
			s.setStopReason(model.StopReasonBudgetExceeded)
			break
		}
		ev, ok := s.heap.Pop()
		if !ok {
			if s.nowMs >= s.startMs+s.durationMs {
				s.setStopReason(model.StopReasonDurationReached)
			} else if s.req.StopPolicy.StopWhenNoEventsOrDefault() {
				s.setStopReason(model.StopReasonNoEvents)
			} else {
				s.setStopReason(model.StopReasonDurationReached)
			}
			break
		}
		if ev.TimeMs > s.startMs+s.durationMs {
			s.setStopReason(model.StopReasonDurationReached)
			break
		}
		s.nowMs = ev.TimeMs
		s.processedEvents++
		switch ev.Kind {
		case scheduler.GenericEventExpireCleanup:
			s.handleExpireCleanup(ev)
		case scheduler.GenericEventProviderTick:
			if err := s.handleProviderTick(ev); err != nil {
				return err
			}
		case scheduler.GenericEventAbilityAttempt:
			if err := s.handleAbilityAttempt(ev); err != nil {
				return err
			}
		case scheduler.GenericEventSample:
			s.handleSample()
		}
		if s.stopReasonSet {
			break
		}
	}
	s.finalizeStopReason()
	return nil
}

func stopReasonPriority(reason model.StopReason) int {
	switch reason {
	case model.StopReasonBudgetExceeded:
		return 5
	case model.StopReasonBothDead:
		return 4
	case model.StopReasonSourceDead, model.StopReasonTargetDead:
		return 3
	case model.StopReasonDurationReached:
		return 2
	case model.StopReasonNoEvents:
		return 1
	default:
		return 0
	}
}

func (s *genericRunState) setStopReason(reason model.StopReason) {
	if s.stopReasonSet && stopReasonPriority(reason) <= stopReasonPriority(s.stopReason) {
		return
	}
	s.stopReason = reason
	s.stopReasonSet = true
}

func (s *genericRunState) finalizeStopReason() {
	var best model.StopReason
	bestPriority := -1
	consider := func(reason model.StopReason) {
		p := stopReasonPriority(reason)
		if p > bestPriority {
			bestPriority = p
			best = reason
		}
	}
	if s.processedEvents >= s.budget.MaxEvents {
		consider(model.StopReasonBudgetExceeded)
	}
	sourceDead := s.combatantHasHp(model.SelectorSource) && s.combatantHp(model.SelectorSource) <= 0
	targetDead := s.combatantHasHp(model.SelectorTarget) && s.combatantHp(model.SelectorTarget) <= 0
	if sourceDead && targetDead {
		consider(model.StopReasonBothDead)
	} else if sourceDead {
		consider(model.StopReasonSourceDead)
	} else if targetDead && s.req.StopPolicy.StopOnTargetDeathOrDefault() {
		consider(model.StopReasonTargetDead)
	}
	if s.nowMs >= s.startMs+s.durationMs {
		consider(model.StopReasonDurationReached)
	}
	if s.stopReasonSet && s.stopReason == model.StopReasonNoEvents {
		consider(model.StopReasonNoEvents)
	}
	if bestPriority >= 0 {
		s.stopReason = best
		s.stopReasonSet = true
	} else if !s.stopReasonSet {
		s.stopReason = model.StopReasonDurationReached
		s.stopReasonSet = true
	}
}

func (s *genericRunState) statFor(abilityRef string) *abilityStatAcc {
	if acc, ok := s.abilityStats[abilityRef]; ok {
		return acc
	}
	acc := &abilityStatAcc{abilityRef: abilityRef}
	s.abilityStats[abilityRef] = acc
	return acc
}

func (s *genericRunState) handleAbilityAttempt(ev scheduler.GenericEvent) *model.EngineError {
	entry := s.req.DriverPlan.Entries[ev.DriverEntryIndex]
	s.abilityAttemptCount++
	s.entryAttemptCounts[ev.DriverEntryIndex]++

	sourceKey, _ := s.resolveCombatantKey(entry.Source, entry.Source, entry.Target)
	targetKey, _ := s.resolveCombatantKey(entry.Target, entry.Source, entry.Target)
	statRef := normalizeAbilityRef(entry.AbilityRef, sourceKey, targetKey)
	acc := s.statFor(statRef)
	acc.attemptCount++

	gate := s.checkAttemptGate(entry, ev.DriverEntryIndex)
	if gate.skipped {
		s.attemptSkippedCount++
		acc.skipCount++
		s.recordAttemptSkipped(entry, gate.reason, gate.readyAtMs)
		if s.isWhileReady(entry) {
			nextAt := s.nextWhileReadyTime(entry, gate)
			if nextAt > s.nowMs {
				s.enqueueAttempt(nextAt, ev.DriverEntryIndex, ev.AttemptIndex+1)
			}
			// whileReady owns reschedule; do not also schedule dynamic interval.
			return nil
		}
		return s.scheduleDynamicRepeatNext(entry, ev.DriverEntryIndex, ev.AttemptIndex)
	}
	if err := s.executeAbilityCast(entry); err != nil {
		return err
	}
	return s.scheduleDynamicRepeatNext(entry, ev.DriverEntryIndex, ev.AttemptIndex)
}

// scheduleDynamicRepeatNext 在 dynamic DriverRepeat 每次 attempt 处理后按最新 attrs/resources 排下一发。
func (s *genericRunState) scheduleDynamicRepeatNext(entry model.DriverEntry, entryIndex, attemptIndex int) *model.EngineError {
	if entry.Repeat == nil || entry.Repeat.IntervalFormula == nil {
		return nil
	}
	if entryIndex < 0 || entryIndex >= len(s.entryIntervalPrograms) || s.entryIntervalPrograms[entryIndex] == nil {
		return nil
	}
	nextAttempt := attemptIndex + 1
	if entry.Repeat.MaxAttempts > 0 && nextAttempt >= entry.Repeat.MaxAttempts {
		return nil
	}

	sourceKey, _ := s.resolveCombatantKey(entry.Source, entry.Source, entry.Target)
	targetKey, _ := s.resolveCombatantKey(entry.Target, entry.Source, entry.Target)
	src := s.combatants[sourceKey]
	tgt := s.combatants[targetKey]
	evalCtx := formula.GenericEvalContext{
		SourceAttrs:     src.attributes,
		TargetAttrs:     tgt.attributes,
		SourceResources: src.resources,
		TargetResources: tgt.resources,
	}
	path := "driverPlan.entries[" + entry.EntryKey + "].repeat.intervalFormula"
	raw, evalErr := s.compiled.Formulas.Eval(*s.entryIntervalPrograms[entryIndex], evalCtx)
	if evalErr != nil {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "intervalFormula eval failed: "+evalErr.Error(), s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	if math.IsNaN(raw) || math.IsInf(raw, 0) || raw <= 0 {
		err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "intervalFormula must evaluate to a finite value > 0")
		err.Path = path
		err.Ref = entry.AbilityRef
		err.SchemaHash = s.compiled.SchemaHash
		err.RulesHash = s.compiled.RulesHash
		err.SessionID = s.req.SessionID
		return &err
	}
	intervalMs := int64(math.Round(raw))
	if intervalMs < 1 {
		intervalMs = 1
	}
	nextAt := s.nowMs + intervalMs
	if nextAt > s.startMs+s.durationMs {
		return nil
	}
	s.enqueueAttempt(nextAt, entryIndex, nextAttempt)
	return nil
}

func (s *genericRunState) isWhileReady(entry model.DriverEntry) bool {
	switch v := entry.WhileReady.(type) {
	case bool:
		return v
	case nil:
		return false
	default:
		return true
	}
}

func (s *genericRunState) recordAttemptSkipped(entry model.DriverEntry, reason model.AttemptSkipReason, readyAtMs int64) {
	data := map[string]interface{}{
		"entryKey":   entry.EntryKey,
		"source":     entry.Source,
		"target":     entry.Target,
		"skipReason": string(reason),
	}
	if readyAtMs > 0 {
		data["readyAtMs"] = readyAtMs
	}
	item := model.EvidenceItem{
		TimeMs:  s.nowMs,
		Kind:    model.EvidenceKindAttemptSkipped,
		Ref:     entry.AbilityRef,
		Path:    "driverPlan.entries[" + entry.EntryKey + "]",
		Message: string(reason),
		Data:    data,
	}
	s.recordEvidence(item)
}

func (s *genericRunState) recordEvidence(item model.EvidenceItem) {
	kind := string(item.Kind)
	s.evidenceCountsByKind[kind]++
	if len(s.evidence) >= s.budget.MaxEvidenceItems {
		s.evidenceTruncated = true
		s.truncatedEvidenceCount++
		return
	}
	s.evidence = append(s.evidence, item)
}

func (s *genericRunState) handleSample() {
	point := s.buildSeriesPoint(s.nowMs)
	s.series = append(s.series, point)
}

func (s *genericRunState) buildSeriesPoint(timeMs int64) model.SeriesPoint {
	windowMs := int64(s.sampling.DpsWindowMs)
	sourceHp := s.combatantHp(model.SelectorSource)
	targetHp := s.combatantHp(model.SelectorTarget)
	var sourceCumDps, targetCumDps, sourceWinDps, targetWinDps float64
	if timeMs > 0 {
		secs := float64(timeMs) / 1000
		sourceCumDps = s.sourceDamageDealt / secs
		targetCumDps = s.targetDamageDealt / secs
		effectiveWindow := windowMs
		if timeMs < effectiveWindow {
			effectiveWindow = timeMs
		}
		if effectiveWindow > 0 {
			windowSecs := float64(effectiveWindow) / 1000
			sourceWinDps = s.damageInWindow(model.SelectorSource, true, timeMs-effectiveWindow, timeMs) / windowSecs
			targetWinDps = s.damageInWindow(model.SelectorTarget, true, timeMs-effectiveWindow, timeMs) / windowSecs
		}
	}
	return model.SeriesPoint{
		TimeMs:              timeMs,
		SourceHp:            sourceHp,
		TargetHp:            targetHp,
		SourceDamageDealt:   s.sourceDamageDealt,
		TargetDamageDealt:   s.targetDamageDealt,
		SourceCumulativeDps: sourceCumDps,
		TargetCumulativeDps: targetCumDps,
		SourceWindowDps:     sourceWinDps,
		TargetWindowDps:     targetWinDps,
	}
}

func (s *genericRunState) damageInWindow(combatantKey string, asDealer bool, fromMs, toMs int64) float64 {
	var total float64
	for _, rec := range s.damageHistory {
		if rec.timeMs < fromMs || rec.timeMs > toMs {
			continue
		}
		if asDealer {
			if rec.sourceKey == combatantKey {
				total += rec.amount
			}
		} else if rec.targetKey == combatantKey {
			total += rec.amount
		}
	}
	return total
}

func (s *genericRunState) buildDoneResult() model.DoneResult {
	finalSnapshot := s.buildFinalSnapshot()

	rawSeriesCount := len(s.series)
	series, downsampled := s.finalizeSeries()
	if series == nil {
		series = []model.SeriesPoint{}
	}
	droppedSeriesPoints := 0
	if downsampled && rawSeriesCount > len(series) {
		droppedSeriesPoints = rawSeriesCount - len(series)
	}

	abilityStats := make([]model.AbilityStat, 0, len(s.abilityStats))
	for _, acc := range s.abilityStats {
		stat := model.AbilityStat{
			AbilityRef:   acc.abilityRef,
			AttemptCount: acc.attemptCount,
			CastCount:    acc.castCount,
			SkipCount:    acc.skipCount,
			DamageDealt:  acc.damageDealt,
			HealingDone:  acc.healingDone,
		}
		abilityStats = append(abilityStats, stat)
	}
	sort.Slice(abilityStats, func(i, j int) bool {
		return abilityStats[i].AbilityRef < abilityStats[j].AbilityRef
	})

	requestedPoints := 0
	if s.sampling.SampleEveryMs > 0 {
		end := s.startMs + s.durationMs
		for t := s.startMs; t <= end; t += int64(s.sampling.SampleEveryMs) {
			requestedPoints++
		}
	}

	s.appendTerminalEvidence(downsampled, requestedPoints, len(series))

	countsByKind := map[string]int{}
	for kind, count := range s.evidenceCountsByKind {
		countsByKind[kind] = count
	}

	evidenceItems := s.evidence
	if evidenceItems == nil {
		evidenceItems = []model.EvidenceItem{}
	}

	warnings, warningCount := s.buildWarnings(downsampled, droppedSeriesPoints)

	return model.DoneResult{
		OK: true,
		Summary: model.RunSummary{
			DurationMs:          s.nowMs - s.startMs,
			StopReason:          s.stopReason,
			SourceFinalHp:       s.combatantHp(model.SelectorSource),
			TargetFinalHp:       s.combatantHp(model.SelectorTarget),
			SourceDamageDealt:   s.sourceDamageDealt,
			SourceDamageTaken:   s.sourceDamageTaken,
			TargetDamageDealt:   s.targetDamageDealt,
			TargetDamageTaken:   s.targetDamageTaken,
			SourceOverheal:      s.sourceOverheal,
			TargetOverheal:      s.targetOverheal,
			AbilityAttemptCount: s.abilityAttemptCount,
			AbilityCastCount:    s.abilityCastCount,
			AttemptSkippedCount: s.attemptSkippedCount,
			WarningCount:        warningCount,
			EvidenceTruncated:   s.evidenceTruncated,
			SeriesDownsampled:   downsampled,
			AbilityStats:        abilityStats,
		},
		FinalSnapshot: finalSnapshot,
		Series:        series,
		Warnings:      warnings,
		Evidence: model.EvidenceCollection{
			Items:                  evidenceItems,
			Truncated:              s.evidenceTruncated,
			TruncatedEvidenceCount: s.truncatedEvidenceCount,
			CountsByKind:           countsByKind,
		},
		SeriesSamplingEvidence: model.SeriesSamplingEvidence{
			RequestedSampleEveryMs: s.sampling.SampleEveryMs,
			EffectiveSampleEveryMs: s.sampling.SampleEveryMs,
			RequestedPointCount:    requestedPoints,
			FinalPointCount:        len(series),
			MaxSeriesPoints:        s.sampling.MaxSeriesPoints,
			Downsampled:            downsampled,
			Method:                 "uniform_time",
		},
	}
}

func (s *genericRunState) buildFinalSnapshot() model.Snapshot {
	snapshot := cloneSnapshot(s.req.InitialSnapshot)
	snapshot.TimeMs = s.nowMs
	snapshot.SchemaHash = s.compiled.SchemaHash
	snapshot.RulesHash = s.compiled.RulesHash
	for i, c := range snapshot.Combatants {
		rt, ok := s.combatants[c.Key]
		if !ok {
			continue
		}
		snapshot.Combatants[i].Attributes = cloneAttributeMap(rt.attributes)
		snapshot.Combatants[i].Resources = cloneResourceMap(rt.resources)
		snapshot.Combatants[i].Cooldowns = cooldownsToSnapshot(rt.cooldowns, s.nowMs)
		snapshot.Combatants[i].Providers = providersToSnapshot(rt.providers)
		snapshot.Combatants[i].Shields = shieldsToSnapshot(rt.shields)
		snapshot.Combatants[i].ProviderState = providerStateToSnapshot(rt.providerState)
		if snapshot.Combatants[i].AbilityState == nil {
			snapshot.Combatants[i].AbilityState = map[string]interface{}{}
		}
		if snapshot.Combatants[i].ProviderState == nil {
			snapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		if snapshot.Combatants[i].Vars == nil {
			snapshot.Combatants[i].Vars = map[string]interface{}{}
		}
	}
	return snapshot
}

func (s *genericRunState) appendTerminalEvidence(downsampled bool, requestedPoints, finalPointCount int) {
	if downsampled {
		s.recordEvidence(model.EvidenceItem{
			TimeMs: s.nowMs,
			Kind:   model.EvidenceKindDownsampled,
			Data: map[string]interface{}{
				"requestedPointCount": requestedPoints,
				"finalPointCount":     finalPointCount,
				"maxSeriesPoints":     s.sampling.MaxSeriesPoints,
				"method":              "uniform_time",
			},
		})
	}
	if s.stopReason == model.StopReasonBudgetExceeded {
		s.recordEvidence(model.EvidenceItem{
			TimeMs: s.nowMs,
			Kind:   model.EvidenceKindBudgetExceeded,
			Data: map[string]interface{}{
				"processedEvents": s.processedEvents,
				"maxEvents":       s.budget.MaxEvents,
			},
		})
	}
}

func (s *genericRunState) truncatedEvidenceKinds() []string {
	keptByKind := make(map[string]int)
	for _, item := range s.evidence {
		keptByKind[string(item.Kind)]++
	}
	var kinds []string
	for kind, total := range s.evidenceCountsByKind {
		if total > keptByKind[kind] {
			kinds = append(kinds, kind)
		}
	}
	sort.Strings(kinds)
	return kinds
}

func (s *genericRunState) buildWarnings(seriesDownsampled bool, droppedSeriesPoints int) ([]model.WarningItem, int) {
	var candidates []model.WarningItem

	if s.evidenceTruncated {
		candidates = append(candidates, model.WarningItem{
			Code:         string(model.WarningCodeEvidenceTruncated),
			Message:      "evidence items truncated by safety budget",
			Severity:     model.WarningSeverityWarning,
			EvidenceRefs: s.truncatedEvidenceKinds(),
			Count:        s.truncatedEvidenceCount,
		})
	}
	if seriesDownsampled && droppedSeriesPoints > 0 {
		candidates = append(candidates, model.WarningItem{
			Code:         string(model.WarningCodeSeriesDownsampled),
			Message:      "series points downsampled by maxSeriesPoints",
			Severity:     model.WarningSeverityWarning,
			EvidenceRefs: []string{string(model.EvidenceKindDownsampled)},
			Count:        droppedSeriesPoints,
		})
	}
	if s.stopReason == model.StopReasonBudgetExceeded {
		candidates = append(candidates, model.WarningItem{
			Code:         string(model.WarningCodeBudgetExceeded),
			Message:      "run stopped because event budget was exceeded",
			Severity:     model.WarningSeverityWarning,
			EvidenceRefs: []string{string(model.EvidenceKindBudgetExceeded)},
			Count:        1,
		})
	}

	totalProduced := len(candidates)
	maxWarnings := s.budget.MaxWarnings
	if maxWarnings <= 0 {
		maxWarnings = model.DefaultSafetyBudget().MaxWarnings
	}
	warnings := candidates
	if len(warnings) > maxWarnings {
		warnings = warnings[:maxWarnings]
	}
	if warnings == nil {
		warnings = []model.WarningItem{}
	}
	return warnings, totalProduced
}

func cooldownsToSnapshot(cooldowns map[string]int64, nowMs int64) map[string]interface{} {
	if len(cooldowns) == 0 {
		return map[string]interface{}{}
	}
	out := make(map[string]interface{}, len(cooldowns))
	for key, readyAt := range cooldowns {
		remaining := readyAt - nowMs
		if remaining < 0 {
			remaining = 0
		}
		out[key] = map[string]interface{}{
			"readyAtMs":   readyAt,
			"remainingMs": remaining,
		}
	}
	return out
}

func cloneSnapshot(src model.Snapshot) model.Snapshot {
	dst := src
	dst.Combatants = make([]model.CombatantSnapshot, len(src.Combatants))
	for i, c := range src.Combatants {
		dst.Combatants[i] = c
		if c.Attributes != nil {
			dst.Combatants[i].Attributes = cloneAttributeMap(c.Attributes)
		}
		if c.Resources != nil {
			dst.Combatants[i].Resources = cloneResourceMap(c.Resources)
		}
	}
	return dst
}

func (s *genericRunState) finalizeSeries() ([]model.SeriesPoint, bool) {
	points := s.series
	if len(points) <= s.sampling.MaxSeriesPoints {
		return points, false
	}
	step := float64(len(points)) / float64(s.sampling.MaxSeriesPoints)
	if step < 1 {
		step = 1
	}
	out := make([]model.SeriesPoint, 0, s.sampling.MaxSeriesPoints)
	for i := 0; i < s.sampling.MaxSeriesPoints; i++ {
		idx := int(float64(i) * step)
		if idx >= len(points) {
			idx = len(points) - 1
		}
		out = append(out, points[idx])
	}
	return out, true
}

func validateGenericRunRequest(compiled compilebundle.CompiledSession, req model.RunRequest) *model.EngineError {
	if req.SessionID == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "sessionId is required", compiled.SchemaHash, compiled.RulesHash, "")
	}
	if req.InitialSnapshot.SchemaHash == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "initialSnapshot.schemaHash is required", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if req.InitialSnapshot.SchemaHash != compiled.SchemaHash {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrHashMismatch, "initialSnapshot.schemaHash mismatch", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if req.InitialSnapshot.RulesHash == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "initialSnapshot.rulesHash is required", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if req.InitialSnapshot.RulesHash != compiled.RulesHash {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrHashMismatch, "initialSnapshot.rulesHash mismatch", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	return nil
}

func engineErrorPtr(phase model.GenericErrorPhase, code model.GenericErrCode, message, schemaHash, rulesHash, sessionID string) *model.EngineError {
	err := model.NewEngineError(phase, code, message)
	err.SchemaHash = schemaHash
	err.RulesHash = rulesHash
	err.SessionID = sessionID
	return &err
}

func validateRuntimeOptions(raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	var probe interface{}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return
	}
	if _, ok := probe.(map[string]interface{}); !ok {
		// P0: non-object runtimeOptions are ignored.
	}
}
