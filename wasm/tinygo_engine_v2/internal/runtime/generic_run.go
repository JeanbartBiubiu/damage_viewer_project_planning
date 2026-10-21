// generic run state 与单次 deterministic run 主循环（Slice C1）。
package runtime

import (
	"encoding/json"
	"math"
	"sort"
	"strconv"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
	shieldpkg "tinygo_engine_v2/internal/shield"
	"tinygo_engine_v2/internal/status"
	"tinygo_engine_v2/internal/typeset"
)

const (
	defaultConditionRecheckMs = 100
	minConditionRecheckMs     = 10
	maxConditionRecheckMs     = 1000
)

type combatantRuntime struct {
	hpMaxAnchor           float64
	resourceContributions []resourceMaxContribution
	providersShared       bool
	key                   string
	attributes            attribute.Table
	resources             map[string]model.ResourceSlotDef
	cooldowns             *genericCooldownLedger
	providers             []status.ProviderInstance
	shields               []shieldpkg.Instance
	resolver              pipeline.AttributeResolver
	damageResolver        pipeline.DamageModifierResolver
	providerState         map[string]*providerStateBag
	providerStateShared   bool
}

// 实例列表可供帧读取；State与StatusContributions在列表内始终只读。
func (c *combatantRuntime) writableProviders() []status.ProviderInstance {
	if c.providersShared {
		c.providers = append([]status.ProviderInstance(nil), c.providers...)
		c.providersShared = false
	}
	return c.providers
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
	nextHealthOrder            uint64
	resourceChangeRecords      []model.ResourceChangeRecord
	resourceChangeSummary      *model.ResourceChangeSummary
	maxResourceChangeRecords   int
	abilityTypeKeyCache        map[typeset.TypeSet][]string
	attributeMemos             [2][3]*attributeMemo
	providerDefinitionFields   []*providerStateFieldMetadata
	skillAction                *skillActionRuntime
	automaticSkills            *automaticSkillRuntime
	skillActions               []skillActionRuntime
	skillActionByUse           map[string]*skillActionRuntime
	skillTargetKilledAt        *int64
	actionDeaths               map[string]bool
	skillActionRecords         []model.SkillActionRecord
	skillUseRecords            []model.SkillUseRecord
	healingRecords             []model.DirectHealingRecord
	skillActionRecordCount     int
	skillUseRecordCount        int
	healingRecordCount         int
	maxSkillActionRecords      int
	maxSkillUseRecords         int
	maxHealingRecords          int
	sourceDirectHealing        float64
	targetDirectHealing        float64
	processInstances           []*processRuntime
	empoweredWaits             []*processRuntime
	processFacts               map[string]model.ProcessCommandFact
	processFailure             *model.EngineError
	settlingProcessDeaths      bool
	compiled                   planbundle.CompiledSession
	formulas                   formula.GenericRegistry
	req                        model.RunRequest
	nowMs                      int64
	startMs                    int64
	durationMs                 int64
	conditionRecheckIntervalMs int64

	combatants map[string]combatantRuntime
	heap       scheduler.GenericHeap

	budget                    model.SafetyBudget
	currentEventCommands      int
	basicAttackEventActive    bool
	initializationEventActive bool
	initializationPending     int
	budgetCause               model.BudgetCause
	basicAttack               *basicAttackRuntime
	ammoInstances             []*basicAttackAmmo
	attackRecords             []model.BasicAttackRecord
	mechanicRecords           []model.MechanicRecord
	mechanicRecordCount       int
	maxMechanicRecords        int
	damageRecords             []map[string]interface{}
	damageBreakdown           []model.DamageBreakdown
	damageBreakdownIndex      map[damageBreakdownKey]int
	sourceHpLoss              float64
	targetHpLoss              float64
	sourceVampHealing         float64
	targetVampHealing         float64
	damageRecordCount         int
	maxAttackRecords          int
	maxDamageRecords          int
	effectiveSampleEveryMs    int64
	nextSampleAtMs            int64

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
	nextDamageID      uint64

	evidence               []model.EvidenceItem
	evidenceTruncated      bool
	truncatedEvidenceCount int
	evidenceCountsByKind   map[string]int
	evidenceRetainedCount  int
	evidenceRetainedByKind map[string]int

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
	anchoredTickPayloads   []anchoredTickPayload
	anchoredTerminalAt     map[int64]int
	nextProviderInstanceID uint64
	usedProviderRefs       map[string]bool
	nextShieldInstanceID   uint64
	usedShieldRefs         map[string]bool

	// Cast-instance identity (Focused Will / per-cast throttle). Monotonic from 1; discarded after run.
	nextCastInstanceID            uint64
	perCastThrottle               map[perCastThrottleKey]int64
	perCastThrottleCapacity       int
	perCastThrottleOverflowWarned bool
	perCastThrottleOverflowCount  int

	// Delayed repeat continuations (run-local; discarded with the run).
	continuations      map[uint64]*triggeredContinuationPayload
	nextContinuationID uint64

	skillUses               map[string]*skillUseRuntime
	skillHitFacts           map[string]model.SkillHitFact
	skillHitGroups          map[string]*skillHitGroup
	skillHitLedger          map[string]*frozenSkillHitContext
	skillHitOccurrenceCount uint64
	runtimeListeners        []planbundle.CompiledListener
	attackStartFacts        map[string]model.AttackStartFact
	useTriggerLedger        map[useTriggerKey]*useTriggerRecord
	useTriggerReserving     int
}

// RunGeneric 执行单次 generic deterministic run，返回 DoneResult。
func RunGeneric(compiled planbundle.CompiledSession, req model.RunRequest) (model.DoneResult, *model.EngineError) {
	state, err := newGenericRunState(compiled, req)
	if err != nil {
		return model.DoneResult{}, err
	}
	if runErr := state.runLoop(); runErr != nil {
		return model.DoneResult{}, runErr
	}
	// A quiet observation endpoint may be later than the last combat event. Read
	// finite time-dependent modifiers once at that actual endpoint for the final view.
	if compiled.HasProviderElapsedReads && state.budgetCause == "" {
		state.refreshProviderAwareAttributes(model.SelectorSource, model.SelectorTarget)
		if state.processFailure != nil {
			return model.DoneResult{}, state.processFailure
		}
	}
	done := state.buildDoneResult()
	if state.processFailure != nil {
		return model.DoneResult{}, state.processFailure
	}
	return done, nil
}

func newGenericRunState(compiled planbundle.CompiledSession, req model.RunRequest) (*genericRunState, *model.EngineError) {
	if req.OutputMode != "" && req.OutputMode != model.RunOutputDetailed && req.OutputMode != model.RunOutputSummary {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "outputMode must be detailed or summary", "outputMode", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if (req.DriverPlan.BasicAttack != nil || len(req.DriverPlan.SkillActions) > 0 || req.DriverPlan.AutomaticSkills != nil) && len(compiled.RuleModifiers) != 0 {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "continuous basic attack does not admit unselected global modifiers", "rules.modifiers", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	recheck := normalizeConditionRecheckInterval(req.DriverPlan.ConditionRecheckIntervalMs)

	sampling := req.Sampling
	if sampling.SampleEveryMs < 0 || sampling.DpsWindowMs < 0 || sampling.MaxSeriesPoints < 0 || sampling.MaxSeriesPoints == 1 || sampling.MaxSeriesPoints > 5000 {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "invalid sampling interval or point limit", "sampling", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
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
		if sb.MaxProcessInstances < 0 || sb.MaxProcessInstances > 100000 {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "maxProcessInstances must be a positive integer at most 100000", "safetyBudget.maxProcessInstances", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
		}
		if sb.MaxBasicAttacks < 0 || sb.MaxBasicAttacks > 4096 {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "maxBasicAttacks must be at most 4096", "safetyBudget.maxBasicAttacks", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
		}
		if sb.MaxBasicAttacks > 0 {
			budget.MaxBasicAttacks = sb.MaxBasicAttacks
		}
		if (req.DriverPlan.BasicAttack != nil || len(req.DriverPlan.SkillActions) > 0 || req.DriverPlan.AutomaticSkills != nil) && ((sb.MaxEvents > compiled.Settings.MaxEvents && compiled.Settings.MaxEvents > 0) || (sb.MaxCommandsPerEvent > compiled.Settings.MaxCommandsPerEvent && compiled.Settings.MaxCommandsPerEvent > 0) || (sb.MaxChainDepth > compiled.Settings.MaxChainDepth && compiled.Settings.MaxChainDepth > 0)) {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "run safety budget exceeds compiled limits", "safetyBudget", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
		}
		if sb.MaxProcessInstances > 0 {
			budget.MaxProcessInstances = sb.MaxProcessInstances
		}
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

	formulas := *compiled.Formulas.CloneForRun()
	combatants, err := materializeCombatants(req.InitialSnapshot, compiled, formulas, req.SessionID)
	if err != nil {
		return nil, err
	}
	usedProviderRefs := map[string]bool{}
	usedShieldRefs := map[string]bool{}
	for _, c := range combatants {
		for _, inst := range c.providers {
			usedProviderRefs[inst.ProviderRef] = true
		}
		for _, sh := range c.shields {
			if sh.ShieldRef != "" {
				usedShieldRefs[sh.ShieldRef] = true
			}
		}
	}

	state := &genericRunState{
		compiled:                   compiled,
		formulas:                   formulas,
		req:                        req,
		nowMs:                      req.InitialSnapshot.TimeMs,
		startMs:                    req.InitialSnapshot.TimeMs,
		durationMs:                 req.StopPolicy.DurationMs,
		conditionRecheckIntervalMs: recheck,
		combatants:                 combatants,
		usedProviderRefs:           usedProviderRefs,
		usedShieldRefs:             usedShieldRefs,
		heap:                       scheduler.NewGenericHeap(64),
		budget:                     budget,
		sampling:                   sampling,
		abilityStats:               make(map[string]*abilityStatAcc),
		entryAttemptCounts:         make([]int, len(req.DriverPlan.Entries)),
		evidenceCountsByKind:       make(map[string]int),
		perCastThrottle:            make(map[perCastThrottleKey]int64),
		perCastThrottleCapacity:    perCastThrottleCapacity(budget.MaxEvents),
		continuations:              make(map[uint64]*triggeredContinuationPayload),
	}
	if err := state.initResourceMaxState(); err != nil {
		return nil, err
	}
	if err := validateFixedEquipmentHealth(compiled, state.combatants, req.SessionID); err != nil {
		return nil, err
	}

	state.heap.SetLimit(compiled.Settings.MaxQueueEvents)
	state.maxAttackRecords, state.maxDamageRecords = 1000, 2000
	state.attackRecords = []model.BasicAttackRecord{}
	state.mechanicRecords = []model.MechanicRecord{}
	state.damageRecords = []map[string]interface{}{}
	state.damageBreakdown = []model.DamageBreakdown{}
	state.damageBreakdownIndex = map[damageBreakdownKey]int{}
	if req.RecordBudget != nil {
		if req.RecordBudget.MaxMechanicRecords != nil {
			state.maxMechanicRecords = *req.RecordBudget.MaxMechanicRecords
		}
		if req.RecordBudget.MaxAttackRecords != nil {
			state.maxAttackRecords = *req.RecordBudget.MaxAttackRecords
		}
		if req.RecordBudget.MaxDamageRecords != nil {
			state.maxDamageRecords = *req.RecordBudget.MaxDamageRecords
		}
	}
	if state.maxAttackRecords < 0 || state.maxAttackRecords > 4096 || state.maxDamageRecords < 0 || state.maxDamageRecords > 10000 || state.maxMechanicRecords < 0 || state.maxMechanicRecords > 10000 {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "invalid record retention budget", "recordBudget", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if err := state.initSamplingCursor(); err != nil {
		return nil, err
	}
	if err := state.compileDriverConditions(); err != nil {
		return nil, err
	}
	if err := state.initStateOnExpireSources(); err != nil {
		return nil, err
	}
	if err := state.initSkillHitState(); err != nil {
		return nil, err
	}
	if err := state.restoreProviderStateTimers(req.InitialSnapshot); err != nil {
		return nil, err
	}
	if err := state.initUseTriggerState(); err != nil {
		return nil, err
	}
	if err := state.initProcessState(); err != nil {
		return nil, err
	}
	if err := state.initSkillAction(); err != nil {
		return nil, err
	}
	if err := state.initAutomaticSkills(); err != nil {
		return nil, err
	}
	if err := state.initBasicAttack(); err != nil {
		return nil, err
	}
	state.initPlannedAmmo()
	if err := state.seedSourceInitialization(); err != nil {
		return nil, err
	}
	// Fresh-scene admission above still compares the authored equipped maximum
	// with Resolved. Only after all admission checks may runtime HP reads switch
	// to Current; half-health scenes must pass the same untouched input checks.
	if compiled.HasResourceMax {
		for key, c := range state.combatants {
			c.attributes = syncHPResolved(c.attributes)
			state.combatants[key] = c
		}
	}
	state.seedDriverAttempts()
	state.seedSkillAction()
	state.queueAutomaticSkills(state.startMs)
	state.seedExpireCleanups()
	state.seedProviderTicks()
	if len(state.ammoInstances) > 0 {
		state.pushCombatEvent(scheduler.GenericEvent{TimeMs: state.startMs, Category: scheduler.GenericCategoryAmmoRecovery, Kind: scheduler.GenericEventAmmoAdmission, DriverEntryIndex: -1})
	}
	if state.basicAttack != nil {
		if state.basicAttack.ammo != nil && state.hasSkillPlan() && len(state.ammoInstances) == 0 {
			state.pushCombatEvent(scheduler.GenericEvent{TimeMs: state.startMs, Category: scheduler.GenericCategoryAmmoRecovery, Kind: scheduler.GenericEventAmmoAdmission, DriverEntryIndex: -1})
		}
		state.pushCombatEvent(scheduler.GenericEvent{TimeMs: state.startMs, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventBasicAttack, DriverEntryIndex: -1})
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
		refs := s.formulas.DeclaredReferences()
		skill := ""
		source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
		target, _ := s.resolveDriverCombatantKey(entry.Target, source)
		if ref, ok := s.compiled.AbilityRefIndex[normalizeAbilityRef(entry.AbilityRef, source, target)]; ok {
			skill = s.compiled.Abilities[ref.AbilityIndex].SkillKey
		}
		if entry.Condition != nil {
			path := "driverPlan.entries[" + entry.EntryKey + "].condition"
			instr := formula.CompileGenericFormula(*entry.Condition, path, refs, map[string]bool{}, addError)
			if !s.formulas.ValidDeclaredScope(instr, skill) {
				addError(model.GenericErrUnknownRef, path, "driver common formula requires its actual ability skill", entry.AbilityRef)
				continue
			}
			for _, in := range s.formulas.InstructionDependencies(instr, nil) {
				if in.ReadKind == formula.ReadAuthoredRuntimeParameter || in.ReadKind == formula.ReadAuthoredAbilityParameter || in.ReadKind == formula.ReadUseChargeDuration || in.ReadKind == formula.ReadProcessStartState {
					addError(model.GenericErrFormulaTypeError, path, "runtime parameters unavailable in driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProcessActualCost {
					addError(model.GenericErrFormulaTypeError, path, "process actual costs are unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadUseAmmoBefore {
					addError(model.GenericErrFormulaTypeError, path, "use.ammo.before is unavailable before native attack admission", "use.ammo.before")
				}
			}
			if len(instr) > 0 {
				key := "run:" + path
				id, err := s.formulas.Register(formula.GenericProgram{Key: key, Instr: instr})
				if err != nil {
					addError(model.GenericErrFormulaTypeError, path, err.Error(), key)
				} else {
					s.entryConditions[i] = &id
				}
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
			instr := formula.CompileGenericFormula(*entry.Repeat.IntervalFormula, path, refs, map[string]bool{}, addError)
			if !s.formulas.ValidDeclaredScope(instr, skill) {
				addError(model.GenericErrUnknownRef, path, "driver common formula requires its actual ability skill", entry.AbilityRef)
				continue
			}
			for _, in := range s.formulas.InstructionDependencies(instr, nil) {
				if in.ReadKind == formula.ReadAuthoredRuntimeParameter || in.ReadKind == formula.ReadAuthoredAbilityParameter || in.ReadKind == formula.ReadUseChargeDuration || in.ReadKind == formula.ReadProcessStartState {
					addError(model.GenericErrFormulaTypeError, path, "runtime parameters unavailable in driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProcessActualCost {
					addError(model.GenericErrFormulaTypeError, path, "process actual costs are unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadUseAmmoBefore {
					addError(model.GenericErrFormulaTypeError, path, "use.ammo.before is unavailable in a driver repeat", "use.ammo.before")
				}
			}
			if len(instr) == 0 {
				continue
			}
			key := "run:" + path
			id, err := s.formulas.Register(formula.GenericProgram{Key: key, Instr: instr})
			if err != nil {
				addError(model.GenericErrFormulaTypeError, path, err.Error(), key)
			} else {
				s.entryIntervalPrograms[i] = &id
			}
		}
	}
	if len(compileErrors) > 0 {
		return &compileErrors[0]
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

func materializeCombatants(snapshot model.Snapshot, compiled planbundle.CompiledSession, formulas formula.GenericRegistry, sessionID string) (map[string]combatantRuntime, *model.EngineError) {
	if err := validateShieldLifecycleSnapshot(snapshot, compiled, sessionID); err != nil {
		return nil, err
	}
	if err := validateProviderElapsedSnapshot(snapshot, compiled, sessionID); err != nil {
		return nil, err
	}
	out := make(map[string]combatantRuntime, len(snapshot.Combatants))
	layout := compiled.AttributeLayout
	var additional []string
	for _, c := range snapshot.Combatants {
		for key := range c.Attributes {
			additional = append(additional, key)
		}
	}
	if layout == nil {
		layout = attribute.NewLayout(additional)
	} else {
		layout = layout.Extend(additional)
	}
	combatantKeys := make(map[string]bool, len(snapshot.Combatants))
	for _, c := range snapshot.Combatants {
		combatantKeys[c.Key] = true
	}
	for i, c := range snapshot.Combatants {
		attrs := c.Attributes
		resources := c.Resources
		if resources == nil {
			resources = map[string]model.ResourceSlotDef{}
		}
		path := "initialSnapshot.combatants[" + itoa(uint32(i)) + "]"
		providers, resolver, err := materializeProviders(c.Providers, c.Key, compiled, combatantKeys, path, compiled.SchemaHash, compiled.RulesHash, sessionID)
		if err != nil {
			return nil, err
		}
		shields := materializeShields(c.Shields, c.Key)
		out[c.Key] = combatantRuntime{
			key:           c.Key,
			attributes:    attribute.FromMap(attrs, layout),
			resources:     cloneResourceMap(resources),
			cooldowns:     materializeCooldowns(c.Cooldowns, c.Key),
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
		damageResolver := c.damageResolver
		mountRuleModifiers(&resolver, &damageResolver, key, compiled)
		c.resolver = resolver
		c.damageResolver = damageResolver
		out[key] = c
	}
	// Resolve with same-combatant eval first, then cross-combatant context.
	for key, c := range out {
		evalCtx := formula.GenericEvalContext{
			SourceAttrs: c.attributes,
			TargetAttrs: c.attributes,
		}
		var resolveErr error
		c.attributes, resolveErr = c.resolver.ResolveAttributesWithProviderContext(
			c.attributes, evalCtx, formulas,
			func(ownerKey, providerRef string) pipeline.ProviderFormulaContext {
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
				ctx := providerFormulaContextFromBag(bag, providerTargetActiveKey(key, ownerKey, ""))
				if compiled.HasProviderElapsedReads {
					ctx = withProviderElapsed(ctx, owner.providers, providerRef, snapshot.TimeMs, compiled.Providers)
				}
				return ctx
			},
		)
		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}
		out[key] = c
	}
	// Re-resolve with cross-combatant eval context after both sides exist.
	sourceAttrs := attribute.Table{}
	targetAttrs := attribute.Table{}
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
		var resolveErr error
		c.attributes, resolveErr = c.resolver.ResolveAttributesWithProviderContext(
			c.attributes, evalCtx, formulas,
			func(ownerKey, providerRef string) pipeline.ProviderFormulaContext {
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
				ctx := providerFormulaContextFromBag(bag, providerTargetActiveKey(key, ownerKey, castProxy))
				if compiled.HasProviderElapsedReads {
					ctx = withProviderElapsed(ctx, owner.providers, providerRef, snapshot.TimeMs, compiled.Providers)
				}
				return ctx
			},
		)
		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}
		out[key] = c
	}
	for _, key := range []string{"source", "target"} {
		actor, exists := out[key]
		if !exists {
			continue
		}
		resolved, resolveErr := resolveDerivedAttributes(compiled, formulas, key, actor.attributes, actor.resolver, out["source"].attributes, out["target"].attributes, nil)
		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}
		actor.attributes = resolved
		out[key] = actor
	}
	return out, nil
}

func mountRuleModifiers(resolver *pipeline.AttributeResolver, damageResolver *pipeline.DamageModifierResolver, combatantKey string, compiled planbundle.CompiledSession) {
	for _, mod := range compiled.RuleModifiers {
		if mod.Kind == "pipeline" {
			mountRulePipelineModifier(damageResolver, combatantKey, mod)
			continue
		}
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

// mountRulePipelineModifier mounts rules pipeline modifiers by stage ownership:
// command=crit + outgoing_pre_mitigation → source;
// incoming_crit_part_post_mitigation + incoming_post_mitigation → target.
func mountRulePipelineModifier(damageResolver *pipeline.DamageModifierResolver, combatantKey string, mod planbundle.CompiledModifier) {
	if damageResolver == nil {
		return
	}
	switch mod.Command {
	case "crit":
		switch mod.Stage {
		case "crit_chance_pre_settlement", "crit_multiplier_forced_branch", "crit_multiplier_natural_branch":
			if combatantKey != model.SelectorSource {
				return
			}
		default:
			return
		}
	case "damage":
		switch mod.Stage {
		case "outgoing_pre_mitigation":
			if combatantKey != model.SelectorSource {
				return
			}
		case "incoming_crit_part_post_mitigation", "incoming_post_mitigation":
			if combatantKey != model.SelectorTarget {
				return
			}
		default:
			return
		}
	case "heal":
	default:
		return
	}
	damageResolver.MountCompiledModifierOwned("", "rules", mod)
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
	if slot, ok := c.attributes.LookupIndex(c.attributes.Layout().HPIndex()); ok {
		return slot.Current
	}
	return 0
}

func (s *genericRunState) combatantHasHp(key string) bool {
	c, ok := s.combatants[key]
	if !ok {
		return false
	}
	_, ok = c.attributes.LookupIndex(c.attributes.Layout().HPIndex())
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

func (s *genericRunState) enqueueAttempt(timeMs int64, entryIndex, attemptIndex int) {
	entry := s.req.DriverPlan.Entries[entryIndex]
	s.pushCombatEvent(scheduler.GenericEvent{
		TimeMs:           timeMs,
		Category:         scheduler.GenericCategoryAbilityAttempt,
		Priority:         int16(entry.Priority),
		Kind:             scheduler.GenericEventAbilityAttempt,
		DriverEntryIndex: entryIndex,
		AttemptIndex:     attemptIndex,
	})
}

func (s *genericRunState) runLoop() *model.EngineError {
	end := s.startMs + s.durationMs
	for {
		if s.processFailure != nil {
			if !s.automatedRun() || s.processFailure.BudgetCause == "" {
				return s.processFailure
			}
			s.setStopReason(model.StopReasonBudgetExceeded)
			break
		}
		next, hasNext := s.heap.PeekTime()
		if s.hasSkillPlan() && (s.actionDeaths[model.SelectorSource] || s.actionDeaths[model.SelectorTarget] || s.combatantHp(model.SelectorSource) <= 0 || s.combatantHp(model.SelectorTarget) <= 0) {
			s.finalizeStopReason()
			break
		}
		if len(s.skillActions) > 0 && (!hasNext || next > end) {
			s.flushSamplesBefore(end)
			s.nowMs = end
			s.setStopReason(model.StopReasonDurationReached)
			break
		}
		// A known cooldown beyond the window finishes observation without a combat event.
		if s.basicAttack != nil && !s.basicAttack.unfinishedTail && s.basicAttack.windowSettled && (!hasNext || next > end) {
			s.flushSamplesBefore(end)
			s.nowMs = end
			s.setStopReason(model.StopReasonDurationReached)
			break
		}
		if s.processedEvents >= s.budget.MaxEvents {
			s.budgetError(model.BudgetCauseMaxEvents, "event budget exceeded")
			s.setStopReason(model.StopReasonBudgetExceeded)
			break
		}
		ev, ok := s.heap.Pop()
		if !ok {
			if s.nowMs >= end {
				s.setStopReason(model.StopReasonDurationReached)
			} else if s.req.StopPolicy.StopWhenNoEventsOrDefault() {
				s.setStopReason(model.StopReasonNoEvents)
			} else {
				s.flushSamplesBefore(end)
				s.nowMs = end
				s.setStopReason(model.StopReasonDurationReached)
			}
			break
		}
		if ev.TimeMs > end {
			s.flushSamplesBefore(end)
			s.nowMs = end
			s.setStopReason(model.StopReasonDurationReached)
			break
		}
		if s.compiled.HasStateOnExpire && s.currentStateOnExpire(ev) {
			var selectionErr *model.EngineError
			ev, selectionErr = s.selectCombatBeforeStateOnExpire(ev)
			if selectionErr != nil {
				return selectionErr
			}
		}
		// Only terminal anchored callbacks settle before a same-time process
		// timer. The selected event still uses this ordinary budget/stop path.
		if ev.Kind == scheduler.GenericEventProcessTimer && len(s.anchoredTerminalAt) != 0 {
			var selectionErr *model.EngineError
			ev, selectionErr = s.selectAnchoredTerminalBeforeProcessTimer(ev)
			if selectionErr != nil {
				return selectionErr
			}
		}
		s.flushSamplesBefore(ev.TimeMs)
		s.nowMs = ev.TimeMs
		s.processedEvents++
		if s.hasSkillPlan() || s.currentStateOnExpire(ev) {
			s.currentEventCommands = 0
		}
		var err *model.EngineError
		switch ev.Kind {
		case scheduler.GenericEventSourceInitialized:
			err = s.handleSourceInitialized(ev)
		case scheduler.GenericEventProcessTimer:
			err = s.handleProcessTimer(ev)
		case scheduler.GenericEventAnchoredTick:
			err = s.handleAnchoredTick(ev)
		case scheduler.GenericEventExpireCleanup:
			s.handleExpireCleanup(ev)
		case scheduler.GenericEventProviderTick:
			err = s.handleProviderTick(ev)
		case scheduler.GenericEventAbilityAttempt:
			err = s.handleAbilityAttempt(ev)
		case scheduler.GenericEventSkillAction:
			err = s.handleSkillAction(ev.SkillActionIndex)
		case scheduler.GenericEventAutomaticSkill:
			err = s.handleAutomaticSkills(ev)
		case scheduler.GenericEventTriggeredContinuation:
			err = s.handleTriggeredContinuation(ev)
		case scheduler.GenericEventBasicAttack:
			if s.basicAttackEventCurrent(ev) {
				err = s.handleBasicAttack()
			}
		case scheduler.GenericEventAmmoRecovery:
			err = s.handleAmmoRecovery(ev)
		case scheduler.GenericEventAmmoAdmission:
			err = s.initializeDrivenAmmo()
		}
		if err == nil {
			err = s.processFailure
		}
		if err != nil {
			if !s.automatedRun() || err.BudgetCause == "" {
				return err
			}
			s.setStopReason(model.StopReasonBudgetExceeded)
			break
		}
		if s.basicAttack != nil && (s.combatantHp(s.basicAttack.plan.Source) <= 0 || s.combatantHp(s.basicAttack.plan.Target) <= 0) {
			s.publishBasicAttackWait()
			s.finalizeStopReason()
		}
		next, hasNext = s.heap.PeekTime()
		if !hasNext || next > s.nowMs {
			s.flushSamplesThrough(s.nowMs)
		}
		if s.stopReasonSet {
			break
		}
	}
	if s.compiled.HasResourceMax {
		s.settleLiveResourceExpiry()
		if s.processFailure != nil && s.processFailure.BudgetCause == "" {
			return s.processFailure
		}
	}
	s.finalizeStopReason()
	s.publishBasicAttackWait()
	if s.stopReason == model.StopReasonBudgetExceeded && s.budgetCause == "" {
		s.budgetCause = model.BudgetCauseMaxEvents
	}
	s.flushSamplesThrough(s.nowMs)
	s.appendFinalSample()
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
	if s.budgetCause != "" || (s.stopReasonSet && s.stopReason == model.StopReasonBudgetExceeded) {
		consider(model.StopReasonBudgetExceeded)
	}
	sourceDead := s.actionDeaths[model.SelectorSource] || s.combatantHasHp(model.SelectorSource) && s.combatantHp(model.SelectorSource) <= 0
	targetDead := s.actionDeaths[model.SelectorTarget] || s.combatantHasHp(model.SelectorTarget) && s.combatantHp(model.SelectorTarget) <= 0
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
	waitOwner, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	waitTarget, _ := s.resolveDriverCombatantKey(entry.Target, waitOwner)
	waitOwner = genericAbilityCooldownOwner(waitOwner, normalizeAbilityRef(entry.AbilityRef, waitOwner, waitTarget))
	waitKey := whileReadyCooldownWaitKey(waitOwner, entry.EntryKey)
	if ev.CooldownWaitVersion != 0 {
		c := s.combatants[waitOwner]
		if !c.cooldowns.waitCurrent(waitKey, ev.TimeMs, ev.CooldownWaitVersion) {
			return nil
		}
	}
	if s.isWhileReady(entry) {
		c := s.combatants[waitOwner]
		c.cooldowns = c.cooldowns.clone()
		c.cooldowns.cancelWait(waitKey)
		s.combatants[waitOwner] = c
	}
	if !isNativeHitFollowUp(entry.EntryKey) {
		s.abilityAttemptCount++
		s.entryAttemptCounts[ev.DriverEntryIndex]++
	}

	sourceKey, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	targetKey, _ := s.resolveDriverCombatantKey(entry.Target, sourceKey)
	statRef := normalizeAbilityRef(entry.AbilityRef, sourceKey, targetKey)
	acc := s.statFor(statRef)
	if !isNativeHitFollowUp(entry.EntryKey) {
		acc.attemptCount++
	}

	if ability, _, ok := s.lookupDriverAbility(entry); ok && ability.ProcessControl != nil {
		return s.handleProcessCommand(entry, ev.DriverEntryIndex, ability, statRef)
	}
	gate := s.checkAttemptGate(entry, ev.DriverEntryIndex)
	if gate.err != nil {
		return gate.err
	}
	if gate.skipped {
		s.attemptSkippedCount++
		acc.skipCount++
		s.recordAttemptSkipped(entry, gate.reason, gate.readyAtMs)
		if s.isWhileReady(entry) {
			nextAt := s.nextWhileReadyTime(entry, gate)
			if nextAt > s.nowMs {
				if gate.reason == model.AttemptSkipCooldownNotReady {
					s.enqueueCooldownAttempt(nextAt, ev.DriverEntryIndex, ev.AttemptIndex+1, genericAbilityCooldownOwner(sourceKey, statRef), statRef)
				} else {
					s.enqueueAttempt(nextAt, ev.DriverEntryIndex, ev.AttemptIndex+1)
				}
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

	sourceKey, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	targetKey, _ := s.resolveDriverCombatantKey(entry.Target, sourceKey)
	src := s.combatants[sourceKey]
	tgt := s.combatants[targetKey]
	evalCtx := formula.GenericEvalContext{
		SourceAttrs:     src.attributes,
		TargetAttrs:     tgt.attributes,
		SourceResources: src.resources,
		TargetResources: tgt.resources,
	}
	path := "driverPlan.entries[" + entry.EntryKey + "].repeat.intervalFormula"
	raw, evalErr := s.formulas.EvalContext(*s.entryIntervalPrograms[entryIndex], &evalCtx)
	if evalErr != nil {
		return s.evalFormulaError(*s.entryIntervalPrograms[entryIndex], evalErr, entry.AbilityRef)
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
	s.recordEvidenceLazy(model.EvidenceKindAttemptSkipped, func() model.EvidenceItem {
		data := map[string]interface{}{
			"entryKey":   entry.EntryKey,
			"source":     entry.Source,
			"target":     entry.Target,
			"skipReason": string(reason),
		}
		if readyAtMs > 0 {
			data["readyAtMs"] = readyAtMs
		}
		return model.EvidenceItem{
			TimeMs:  s.nowMs,
			Kind:    model.EvidenceKindAttemptSkipped,
			Ref:     entry.AbilityRef,
			Path:    "driverPlan.entries[" + entry.EntryKey + "]",
			Message: string(reason),
			Data:    data,
		}
	})
}

func (s *genericRunState) recordEvidence(item model.EvidenceItem) {
	if s.evidenceCountsByKind == nil {
		s.evidenceCountsByKind = map[string]int{}
	}
	kind := string(item.Kind)
	s.evidenceCountsByKind[kind]++
	if s.evidenceRetainedCount >= s.budget.MaxEvidenceItems {
		s.evidenceTruncated = true
		s.truncatedEvidenceCount++
		return
	}
	s.evidenceRetainedCount++
	if s.detailedOutput() {
		s.evidence = append(s.evidence, item)
	} else {
		if s.evidenceRetainedByKind == nil {
			s.evidenceRetainedByKind = map[string]int{}
		}
		s.evidenceRetainedByKind[kind]++
	}
}

func (s *genericRunState) handleSample() {
	point := s.buildSeriesPoint(s.nowMs)
	s.series = append(s.series, point)
}

func (s *genericRunState) buildSeriesPoint(timeMs int64) model.SeriesPoint {
	if s.compiled.HasResourceMax && timeMs == s.nowMs {
		s.settleLiveResourceExpiry()
	}
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
	s.refreshActionContributions()
	finalSnapshot := s.buildFinalSnapshot()
	if s.processFailure != nil {
		return model.DoneResult{}
	}

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
	method := "disabled"
	if !s.sampling.Disabled {
		method = "uniform_time"
		span := s.nowMs - s.startMs
		requestedPoints = int(span/int64(s.sampling.SampleEveryMs)) + 1
		if span%int64(s.sampling.SampleEveryMs) != 0 {
			requestedPoints++
		}
		downsampled = s.effectiveSampleEveryMs > int64(s.sampling.SampleEveryMs)
		droppedSeriesPoints = requestedPoints - len(series)
	}
	var basicSummary *model.BasicAttackSummary
	var sourceVampHealing, targetVampHealing *float64
	var actionSummary *model.SkillActionSummary
	var useSummary *model.SkillUseSummary
	var sourceDirectHealing, targetDirectHealing *float64
	if len(s.skillActions) > 0 {
		actions, uses := s.skillSummaries()
		actionSummary, useSummary = &actions, &uses
	}
	automaticSummary, automaticRecords, automaticRecording, automaticUses := s.automaticSkillResults()
	if automaticUses != nil {
		useSummary = automaticUses
	}
	if s.automatedRun() {
		sourceDirectHealing, targetDirectHealing = &s.sourceDirectHealing, &s.targetDirectHealing
		sourceVampHealing, targetVampHealing = &s.sourceVampHealing, &s.targetVampHealing
	}
	if s.basicAttack != nil {
		basicSummary = &s.basicAttack.summary
		sourceVampHealing, targetVampHealing = &s.sourceVampHealing, &s.targetVampHealing
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
		ResourceChangeRecords:   s.resourceRecordsOutput(),
		ResourceChangeSummary:   s.resourceSummaryOutput(),
		AutomaticSkillSummary:   automaticSummary,
		AutomaticSkillRecords:   automaticRecords,
		AutomaticSkillRecording: automaticRecording,
		OutputMode:              s.resultOutputMode(),
		SkillActionRecords:      s.skillActionRecords,
		SkillUseRecords:         s.skillUseRecords,
		HealingRecords:          s.healingRecords,
		OK:                      true,
		AttackRecords:           s.attackRecords,
		DamageRecords:           s.damageRecords,
		MechanicRecords:         s.mechanicRecords,
		Recording:               s.resourceRecordingSummary(s.skillRecordingSummary(s.recordingSummary())),
		Summary: model.RunSummary{
			SkillActions:        actionSummary,
			SkillUses:           useSummary,
			SourceDirectHealing: sourceDirectHealing,
			TargetDirectHealing: targetDirectHealing,
			BasicAttack:         basicSummary,
			Execution:           s.executionSummary(),
			SourceHpLoss:        s.sourceHpLoss,
			TargetHpLoss:        s.targetHpLoss,
			SourceVampHealing:   sourceVampHealing,
			TargetVampHealing:   targetVampHealing,
			DamageBreakdown:     s.damageBreakdown,
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
			EffectiveSampleEveryMs: int(s.effectiveSampleEveryMs),
			RequestedPointCount:    requestedPoints,
			FinalPointCount:        len(series),
			MaxSeriesPoints:        s.sampling.MaxSeriesPoints,
			Downsampled:            downsampled,
			Method:                 method,
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
		snapshot.Combatants[i].Attributes = rt.attributes.ToMap()
		snapshot.Combatants[i].Resources = cloneResourceMap(rt.resources)
		snapshot.Combatants[i].Cooldowns = cooldownsToSnapshot(rt.cooldowns, s.nowMs)
		snapshot.Combatants[i].Providers = providersToSnapshot(rt.providers)
		if err := s.observeMomentStatusContributions(rt.providers, snapshot.Combatants[i].Providers); err != nil {
			s.processFailure = err
			return model.Snapshot{}
		}
		snapshot.Combatants[i].Shields = shieldsToSnapshot(rt.shields)
		snapshot.Combatants[i].ProviderState = providerStateToSnapshot(rt.providerState, rt.cooldowns, rt.key, s.nowMs)
		snapshot.Combatants[i].EffectiveStatuses = s.buildEffectiveStatuses(snapshot.Combatants[i].Providers)
		if snapshot.Combatants[i].EffectiveStatuses == nil {
			snapshot.Combatants[i].EffectiveStatuses = []model.EffectiveStatusSnapshot{}
		}
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
	if !s.automatedRun() || s.budgetCause == "" {
		s.lazyExpireAllProviderState()
	}
	for i, c := range snapshot.Combatants {
		rt, ok := s.combatants[c.Key]
		if !ok {
			continue
		}
		snapshot.Combatants[i].ProviderState = providerStateToSnapshot(rt.providerState, rt.cooldowns, rt.key, s.nowMs)
	}
	snapshot.UseTriggerLedger = s.snapshotUseTriggerLedger()
	snapshot.ProcessInstances = s.snapshotProcesses()
	if snapshot.UseTriggerLedger == nil {
		snapshot.UseTriggerLedger = []model.UseTriggerLedgerEntry{}
	}
	return snapshot
}

func (s *genericRunState) appendTerminalEvidence(downsampled bool, requestedPoints, finalPointCount int) {
	if downsampled {
		s.recordEvidenceLazy(model.EvidenceKindDownsampled, func() model.EvidenceItem {
			return model.EvidenceItem{
				TimeMs: s.nowMs,
				Kind:   model.EvidenceKindDownsampled,
				Data: map[string]interface{}{
					"requestedPointCount": requestedPoints,
					"finalPointCount":     finalPointCount,
					"maxSeriesPoints":     s.sampling.MaxSeriesPoints,
					"method":              "uniform_time",
				},
			}
		})
	}
	if s.stopReason == model.StopReasonBudgetExceeded {
		s.recordEvidenceLazy(model.EvidenceKindBudgetExceeded, func() model.EvidenceItem {
			return model.EvidenceItem{
				TimeMs: s.nowMs,
				Kind:   model.EvidenceKindBudgetExceeded,
				Data: map[string]interface{}{
					"processedEvents": s.processedEvents,
					"maxEvents":       s.budget.MaxEvents,
				},
			}
		})
	}
}

func (s *genericRunState) truncatedEvidenceKinds() []string {
	keptByKind := s.evidenceRetainedByKind
	if s.detailedOutput() {
		keptByKind = make(map[string]int)
		for _, item := range s.evidence {
			keptByKind[string(item.Kind)]++
		}
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
	if len(s.continuations) > 0 {
		pendingCopies := 0
		for _, payload := range s.continuations {
			if payload == nil {
				continue
			}
			times := payload.req.repeatCount
			if times <= 0 {
				times = 1
			}
			pendingCopies += times * len(payload.damages)
		}
		candidates = append(candidates, model.WarningItem{
			Code:     "pending_continuations_not_in_snapshot",
			Message:  "finalSnapshot omits " + strconv.Itoa(pendingCopies) + " pending delayed damage copies across " + strconv.Itoa(len(s.continuations)) + " continuations; restoring it will not replay them",
			Severity: model.WarningSeverityWarning,
			Refs:     []string{"finalSnapshot"},
			Count:    pendingCopies,
		})
	}

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
	if w := s.perCastThrottleOverflowWarning(); w != nil {
		candidates = append(candidates, *w)
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

func cooldownsToSnapshot(cooldowns *genericCooldownLedger, nowMs int64) map[string]interface{} {
	return cooldowns.snapshot(nowMs)
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
	if src.UseTriggerLedger != nil {
		dst.UseTriggerLedger = append([]model.UseTriggerLedgerEntry(nil), src.UseTriggerLedger...)
	} else {
		dst.UseTriggerLedger = []model.UseTriggerLedgerEntry{}
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

func validateGenericRunRequest(compiled planbundle.CompiledSession, req model.RunRequest) *model.EngineError {
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

func engineErrorPtrAt(phase model.GenericErrorPhase, code model.GenericErrCode, message, path, ref, schemaHash, rulesHash, sessionID string) *model.EngineError {
	err := engineErrorPtr(phase, code, message, schemaHash, rulesHash, sessionID)
	err.Path = path
	err.Ref = ref
	return err
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
