package runtime

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/attribute"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

const (
	dpsStatusOK      = "ok"
	dpsStatusBlocked = "blocked"

	dpsTriggerOnBasicAttackHit          = "on_basic_attack_hit"
	dpsTriggerEveryNBasicAttack         = "every_n_basic_attack_hit"
	dpsTriggerStackOnHit                = "stack_on_hit"
	dpsTriggerStatAlwaysOn              = "stat_modifier_always_on"
	dpsTriggerPreEnabledModifier        = "pre_enabled_state_modifier"
	dpsTriggerNextBasicAttackAfterState = "next_basic_attack_after_state"
	dpsTriggerEnergizedChargeAndConsume = "energized_charge_and_consume"

	dpsChargeReadyPolicyNextBasicAttackAfterThreshold = "next_basic_attack_after_threshold_reached"
	dpsProcScopeRealBasicAttackOnly                   = "real_basic_attack_only"

	dpsEffectEnergizedChargeCheck   = "energized_charge_check"
	dpsEffectEnergizedChargeConsume = "energized_charge_consume"
	dpsEffectEnergizedChargeGain    = "energized_charge_gain"

	dpsOpDamage                     = "damage"
	dpsEffectNextAttackStateConsume = "next_attack_state_consume"
	dpsOpApplyDot                   = "apply_dot"
	dpsOpAddStack                   = "add_stack"
	dpsOpTriggerDamageAtStacks      = "trigger_damage_at_stacks"
	dpsOpStatModifier               = "stat_modifier"
	dpsOpDamageModifier             = "damage_modifier"
	dpsOpPhantomHitOnHitRepeat      = "phantom_hit_on_hit_repeat"
	dpsRepeatScopeCopyableOnHit     = "copyable_on_hit"

	dpsEventOnBasicAttackHit = "on_basic_attack_hit"
	dpsEventOnSpellHit       = "on_spell_hit"
	dpsEventOnHit            = "on_hit"
	dpsEventOnDamageDealt    = "on_damage_dealt"
	dpsEventOnDamageTaken    = "on_damage_taken"
	dpsEventDotTick          = "dot_tick"

	dpsValuePhaseIncoming = "incoming"

	dpsRoleAttacker = "attacker"
	dpsRoleTarget   = "target"
)

type dpsCombatEventContext struct {
	Event string

	TimeMs     int64
	SourceRole string
	TargetRole string

	ActionID       string
	ActionTypes    []string
	EffectTypes    []string
	EffectTags     []string
	SourceType     string
	SourceCategory string
	SourceID       string

	DamageType     string
	RawDamage      float64
	FinalDamage    float64
	TargetHPBefore float64
	TargetHPAfter  float64

	IsBasicAttack  bool
	IsSpell        bool
	IsOnHit        bool
	IsDotTick      bool
	IsPhantomHit   bool
	HasCritContext bool
	ProcScope      string
}

type dpsDamageApplication struct {
	Applied        bool
	RawDamage      float64
	FinalDamage    float64
	TargetHPBefore float64
	TargetHPAfter  float64
}

type dpsLinkedPassiveEntry struct {
	originalIndex int
	passive       model.DPSPassiveEffectV2
}

type dpsIncomingDamageModifierEntry struct {
	originalIndex  int
	operationIndex int
	passive        model.DPSPassiveEffectV2
	op             model.DPSPassiveOperationV2
}

type dpsBasicAttackSchedule struct {
	ref         model.DPSBasicAttackActionRefV2
	actionIndex uint16
	nextAtMs    int64
}

type activeDPSDot struct {
	Key            string
	SourceCategory string
	SourceID       string
	SourceType     string
	TriggerID      string
	Operation      model.DPSPassiveOperationV2
	Stacks         int
	NextTickAtMs   int64
	ExpireAtMs     int64
}

type dpsCurveState struct {
	bundle                 compilebundle.CompiledBundle
	runCtx                 *RunContext
	attackerIdx            uint8
	targetIdx              uint8
	rules                  model.DPSimulationRulesV2
	curve                  model.DPSCurveRunSpecV2
	result                 *model.DPSCurveResultV2
	attacker               model.DPSActorSnapshotV2
	target                 model.DPSActorSnapshotV2
	attackerTemplateID     string
	baseAttrs              map[string]float64
	attrs                  map[string]float64
	attributeViews         map[string]model.AttributeSnapshotV2
	targetBaseAttrs        map[string]float64
	targetAttrs            map[string]float64
	targetHP               float64
	targetMaxHP            float64
	attackStartTargetHP    float64
	armor                  float64
	magicResist            float64
	schedules              []dpsBasicAttackSchedule
	passives               []model.DPSPassiveEffectV2
	stacks                 map[string]int
	stackExpiry            map[string]int64
	hitCounts              map[string]int
	statModifierTriggers   map[string]bool
	dots                   []activeDPSDot
	phantomDepth           int
	consumedScenarioStates map[string]bool
	energizedCharge        map[string]float64
	energizedReady         map[string]bool
}

func runSingleAttackerDPS(bundle compilebundle.CompiledBundle, input model.SingleAttackerDPSInputV2) model.SingleAttackerDPSOutputV2 {
	rules := normalizeDPSRules(input.SimulationRules)
	output := model.SingleAttackerDPSOutputV2{
		CaseID:          input.CaseID,
		VersionCode:     input.VersionCode,
		WasmSha256:      input.WasmSha256,
		SimulationRules: rules,
		TargetSnapshot:  input.TargetSnapshot,
		CurveResults:    make([]model.DPSCurveResultV2, 0, len(input.Curves)),
	}
	for _, curve := range input.Curves {
		output.CurveResults = append(output.CurveResults, runSingleAttackerDPSCurve(bundle, rules, curve))
	}
	return output
}

func normalizeDPSRules(input model.DPSimulationRulesV2) model.DPSimulationRulesV2 {
	rules := input
	if rules.SampleBy == "" {
		rules.SampleBy = "none"
	}
	if rules.AttackSpeedCap <= 0 {
		rules.AttackSpeedCap = 3.0
	}
	if rules.EventWindowPolicy == "" {
		rules.EventWindowPolicy = "timeMs < durationMs"
	}
	if rules.DotTickIntervalMs <= 0 {
		rules.DotTickIntervalMs = 1000
	}
	if rules.CritPolicy == "" {
		rules.CritPolicy = "expected"
	}
	if rules.MaxEvents <= 0 {
		rules.MaxEvents = 10000
	}
	if rules.AutoAttackPlan.TargetRole == "" {
		rules.AutoAttackPlan.TargetRole = "target"
	}
	if rules.AutoAttackPlan.StartAtMs == 0 && rules.FirstAttackAtMs != 0 {
		rules.AutoAttackPlan.StartAtMs = rules.FirstAttackAtMs
	}
	if rules.FirstAttackAtMs == 0 {
		rules.FirstAttackAtMs = rules.AutoAttackPlan.StartAtMs
	}
	return rules
}

func runSingleAttackerDPSCurve(
	bundle compilebundle.CompiledBundle,
	rules model.DPSimulationRulesV2,
	curve model.DPSCurveRunSpecV2,
) model.DPSCurveResultV2 {
	result := model.DPSCurveResultV2{
		CurveID:                 curve.CurveID,
		Status:                  dpsStatusOK,
		Selection:               curve.Selection,
		ResolvedSnapshot:        curve.ResolvedSnapshot,
		DurationMs:              rules.DurationMs,
		StopReason:              "duration_elapsed",
		AttackTimeline:          make([]model.DPSAttackEventV2, 0),
		AttackIntervalTimeline:  make([]model.DPSAttackIntervalV2, 0),
		DamageTimeline:          make([]model.DPSDamageEventV2, 0),
		AttackerDamageTimeline:  make([]model.DPSAttackerDamageEventV2, 0),
		AttackerDamageBySource:  map[string]float64{},
		TargetHPTimeline:        make([]model.DPSTargetHPEventV2, 0),
		EffectTimeline:          make([]model.DPSEffectEventV2, 0),
		DamageByType:            map[string]float64{},
		DamageBySource:          map[string]float64{},
		SkillPassiveTriggers:    make([]model.DPSPassiveTriggerV2, 0),
		ItemPassiveTriggers:     make([]model.DPSPassiveTriggerV2, 0),
		ExternalPassiveTriggers: make([]model.DPSPassiveTriggerV2, 0),
		EffectBreakdown:         make([]model.DPSEffectBreakdownV2, 0),
		CritPolicy:              rules.CritPolicy,
		Seed:                    rules.Seed,
		BlockedReasons:          make([]string, 0),
	}

	equipmentReasons := validateDPSEquipment(curve)
	resolvedSnapshot := curve.ResolvedSnapshot
	if len(equipmentReasons) == 0 {
		resolvedSnapshot = applyEquipmentStatsToResolvedSnapshot(resolvedSnapshot)
		curve.ResolvedSnapshot = resolvedSnapshot
		result.ResolvedSnapshot = resolvedSnapshot
	}
	attacker := resolvedSnapshot.AttackerSnapshot
	target := resolvedSnapshot.TargetSnapshot

	blockedReasons := validateDPSCurve(bundle, rules, curve, attacker, target)
	blockedReasons = append(equipmentReasons, blockedReasons...)
	if len(blockedReasons) > 0 {
		result.Status = dpsStatusBlocked
		result.StopReason = "blocked"
		result.BlockedReasons = blockedReasons
		return result
	}

	state := newDPSCurveState(bundle, rules, curve, &result, attacker, target)
	if result.Status == dpsStatusBlocked {
		return result
	}
	state.applyInitialStatModifiers()
	if result.Status == dpsStatusBlocked {
		return result
	}
	state.initEnergizedCharge()
	if result.Status == dpsStatusBlocked {
		return result
	}
	state.initBasicAttackSchedules()
	state.TargetHPTimelineAppend(0)
	result.FinalTimeMs = rules.DurationMs

	for {
		nextDotAtMs, hasDot := state.nextDotTick()
		nextAttackAtMs, hasAttack := state.nextBasicAttackAtMs()
		if !hasDot && !hasAttack {
			break
		}
		if hasDot && (!hasAttack || nextDotAtMs <= nextAttackAtMs) {
			state.processDotTick(nextDotAtMs)
			if state.shouldStopAfterEvent(nextDotAtMs) {
				break
			}
			continue
		}

		state.processBasicAttacksAt(nextAttackAtMs)
		if state.shouldStopAfterEvent(nextAttackAtMs) {
			break
		}
	}

	if result.StopReason == "duration_elapsed" {
		result.FinalTimeMs = rules.DurationMs
	}
	if rules.DurationMs > 0 {
		result.TimeWindowDps = result.TotalDamage / (float64(rules.DurationMs) / 1000)
	}
	return result
}

func newDPSCurveState(
	bundle compilebundle.CompiledBundle,
	rules model.DPSimulationRulesV2,
	curve model.DPSCurveRunSpecV2,
	result *model.DPSCurveResultV2,
	attacker model.DPSActorSnapshotV2,
	target model.DPSActorSnapshotV2,
) *dpsCurveState {
	targetMaxHP := target.MaxHP
	if targetMaxHP <= 0 {
		targetMaxHP = readFirstPositiveAttr(target.Attributes, "hp", "health", "max_hp", "max_health")
	}
	targetHP := target.CurrentHP
	if targetHP <= 0 {
		targetHP = targetMaxHP
	}
	attackerTemplateID := nonEmpty(attacker.TemplateID, "dps_attacker")
	runCtx, attackerIdx, targetIdx, err := newDPSRunContext(bundle, rules, attacker, target)
	if err != nil {
		result.Status = dpsStatusBlocked
		result.StopReason = "blocked"
		result.BlockedReasons = append(result.BlockedReasons, err.Error())
		return &dpsCurveState{result: result}
	}
	return &dpsCurveState{
		bundle:                 bundle,
		runCtx:                 runCtx,
		attackerIdx:            attackerIdx,
		targetIdx:              targetIdx,
		rules:                  rules,
		curve:                  curve,
		result:                 result,
		attacker:               attacker,
		target:                 target,
		attackerTemplateID:     attackerTemplateID,
		baseAttrs:              copyDPSFloatMap(attacker.Attributes),
		attrs:                  copyDPSFloatMap(attacker.Attributes),
		attributeViews:         copyDPSAttributeViews(attacker.AttributeViews),
		targetBaseAttrs:        copyDPSFloatMap(target.Attributes),
		targetAttrs:            copyDPSFloatMap(target.Attributes),
		targetHP:               targetHP,
		targetMaxHP:            targetMaxHP,
		armor:                  readFirstFiniteAttr(target.Attributes, "armor", "armour"),
		magicResist:            readFirstFiniteAttr(target.Attributes, "magic_resist", "mr", "spellblock", "spell_block"),
		schedules:              make([]dpsBasicAttackSchedule, 0),
		passives:               enabledDPSPassives(curve),
		stacks:                 map[string]int{},
		stackExpiry:            map[string]int64{},
		hitCounts:              map[string]int{},
		statModifierTriggers:   map[string]bool{},
		dots:                   make([]activeDPSDot, 0),
		consumedScenarioStates: map[string]bool{},
		energizedCharge:        map[string]float64{},
		energizedReady:         map[string]bool{},
	}
}

func errorFromPayload(p *model.ErrorPayload) error {
	if p == nil {
		return nil
	}
	msg := p.Message
	if msg == "" {
		msg = string(p.Code)
	}
	if len(p.Details) > 0 {
		return fmt.Errorf("%s: %s", msg, strings.Join(p.Details, "; "))
	}
	return errors.New(msg)
}

func newDPSRunContext(
	bundle compilebundle.CompiledBundle,
	rules model.DPSimulationRulesV2,
	attacker model.DPSActorSnapshotV2,
	target model.DPSActorSnapshotV2,
) (*RunContext, uint8, uint8, error) {
	attackerTemplateID := nonEmpty(attacker.TemplateID, "dps_attacker")
	targetTemplateID := nonEmpty(target.TemplateID, "target_dummy_fighter")
	input := model.EngineRunInput{
		Seed:          rules.Seed,
		Self:          model.CombatantRunInit{ActorID: nonEmpty(attacker.ActorID, "attacker"), TemplateID: attackerTemplateID, StatusIDs: attacker.StatusIDs},
		Enemy:         model.CombatantRunInit{ActorID: nonEmpty(target.ActorID, "target"), TemplateID: targetTemplateID},
		StopCondition: model.StopCondition{MaxEvents: rules.MaxEvents},
	}
	outbox := abi.NewOutbox(abi.DefaultOutboxCapacity)
	ctx, errPayload := NewRunContext(bundle, input, &outbox)
	if errPayload != nil {
		return nil, 0, 0, errorFromPayload(errPayload)
	}
	applyDPSAttributesToStore(&ctx.Actors[0].Attrs, bundle.AttrIndex, attacker.Attributes)
	attackerHP := attacker.CurrentHP
	if attackerHP <= 0 {
		attackerHP = attacker.MaxHP
	}
	if attackerHP <= 0 {
		attackerHP = ctx.Actors[0].MaxHP
	}
	ctx.Actors[0].HP = attackerHP
	targetHP := target.CurrentHP
	if targetHP <= 0 {
		targetHP = target.MaxHP
	}
	if targetHP <= 0 {
		targetHP = ctx.Actors[1].MaxHP
	}
	ctx.Actors[1].HP = targetHP
	ctx.Done = false
	return ctx, 0, 1, nil
}

func (state *dpsCurveState) initBasicAttackSchedules() {
	startAt := state.rules.AutoAttackPlan.StartAtMs
	if startAt < 0 {
		startAt = 0
	}
	for _, ref := range state.curve.ResolvedSnapshot.BasicAttackActions {
		actionIndex, ok := state.bundle.ActionIndex[ref.ActionID]
		if !ok {
			continue
		}
		state.schedules = append(state.schedules, dpsBasicAttackSchedule{
			ref:         ref,
			actionIndex: actionIndex,
			nextAtMs:    startAt,
		})
	}
}

func (state *dpsCurveState) nextBasicAttackAtMs() (int64, bool) {
	var next int64
	found := false
	for _, sched := range state.schedules {
		if sched.nextAtMs < 0 || sched.nextAtMs >= state.rules.DurationMs {
			continue
		}
		if !found || sched.nextAtMs < next {
			next = sched.nextAtMs
			found = true
		}
	}
	return next, found
}

func (state *dpsCurveState) processBasicAttacksAt(timeMs int64) {
	for i := range state.schedules {
		if state.schedules[i].nextAtMs != timeMs {
			continue
		}
		state.processBasicAttack(i, timeMs)
		if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
			for j := i + 1; j < len(state.schedules); j++ {
				if state.schedules[j].nextAtMs == timeMs {
					state.schedules[j].nextAtMs = -1
				}
			}
			return
		}
	}
}

func (state *dpsCurveState) syncRunContextFromDPSState(timeMs int64) {
	if state.runCtx == nil {
		return
	}
	state.runCtx.NowMs = timeMs
	applyDPSAttributesToStore(&state.runCtx.Actors[state.attackerIdx].Attrs, state.bundle.AttrIndex, state.attrs)
	state.runCtx.Actors[state.attackerIdx].HP = state.runCtx.Actors[state.attackerIdx].MaxHP
	state.runCtx.Actors[state.targetIdx].HP = state.targetHP
	state.runCtx.Done = false
}

func (state *dpsCurveState) setDPSActionReadyAt(actionIndex uint16, readyAtMs int64) {
	if state.runCtx == nil {
		return
	}
	if int(actionIndex) >= len(state.runCtx.Actors[state.attackerIdx].ActionState) {
		return
	}
	state.runCtx.Actors[state.attackerIdx].ActionState[actionIndex].ReadyAtMs = readyAtMs
}

func (state *dpsCurveState) syncRunContextHPFromDPS() {
	if state.runCtx == nil {
		return
	}
	state.runCtx.Actors[state.targetIdx].HP = state.targetHP
}

func applyEquipmentStatsToResolvedSnapshot(snapshot model.DPSResolvedSnapshotV2) model.DPSResolvedSnapshotV2 {
	if len(snapshot.EquipmentStats) == 0 {
		return snapshot
	}
	attrs := copyDPSFloatMap(snapshot.AttackerSnapshot.Attributes)
	views := copyDPSAttributeViews(snapshot.AttackerSnapshot.AttributeViews)
	for attrKey, value := range snapshot.EquipmentStats {
		attrKey = strings.TrimSpace(attrKey)
		if attrKey == "" {
			continue
		}
		attrs[attrKey] += value
		if view, ok := views[attrKey]; ok {
			view.Resolved += value
			view.Current += value
			view.Max += value
			views[attrKey] = view
		}
	}
	snapshot.AttackerSnapshot.Attributes = attrs
	if len(views) > 0 {
		snapshot.AttackerSnapshot.AttributeViews = views
	}
	return snapshot
}

func (state *dpsCurveState) TargetHPTimelineAppend(timeMs int64) {
	state.result.TargetHPTimeline = append(state.result.TargetHPTimeline, model.DPSTargetHPEventV2{
		TimeMs: timeMs, CurrentHP: state.targetHP, MaxHP: state.targetMaxHP,
	})
}

func (state *dpsCurveState) processBasicAttack(schedIdx int, timeMs int64) {
	if state.runCtx == nil || schedIdx < 0 || schedIdx >= len(state.schedules) {
		return
	}
	sched := &state.schedules[schedIdx]
	actionID := sched.ref.ActionID
	damageSource := nonEmpty(sched.ref.SkillID, actionID)

	state.expireStacks(timeMs)
	state.refreshActiveStatModifiers(timeMs)
	if state.result.Status == dpsStatusBlocked {
		sched.nextAtMs = -1
		return
	}
	state.attackStartTargetHP = state.targetHP
	state.result.ProcessedEvents++
	state.updateQueuePeak()

	state.syncRunContextFromDPSState(timeMs)
	targetHPBefore := state.targetHP
	castResult := state.runCtx.PerformCastAt(timeMs, state.attackerIdx, state.targetIdx, sched.actionIndex)
	state.runCtx.Actors[state.targetIdx].HP = targetHPBefore

	if !castResult.Accepted {
		reason := "basic_attack_cast_blocked"
		if blocked := strings.TrimSpace(castResult.BlockedReason); blocked != "" {
			reason += ":" + blocked
		}
		state.block(reason)
		sched.nextAtMs = -1
		return
	}

	state.result.AttackCount++
	state.result.AttackTimeline = append(state.result.AttackTimeline, model.DPSAttackEventV2{
		TimeMs:        timeMs,
		ActionID:      actionID,
		SourceActorID: nonEmpty(state.attacker.ActorID, "self"),
		TargetActorID: nonEmpty(state.target.ActorID, "target"),
	})

	actionDamageProcessed := false
	var combatCtx dpsCombatEventContext
	hasCombatCtx := false
	compiledAction := state.bundle.Actions[sched.actionIndex]
	for effectIndex, effect := range castResult.Effects {
		if effect.Kind != string(model.EffectTypeDealDamage) || !effect.HasRawAmount {
			continue
		}
		actionDamageProcessed = true
		damageType := effect.DamageType
		if damageType == "" {
			damageType = "physical"
		}
		damageAmount := effect.RawAmount
		if effectIndex < len(compiledAction.Effects) {
			compiledEffect := compiledAction.Effects[effectIndex]
			if compiledEffect.CritPolicy != "" {
				critResult, code := state.runCtx.resolveEffectCrit(compiledEffect, state.attackerIdx)
				if code != model.ErrOK {
					state.block("basic_attack_crit_unresolved:" + actionID)
					sched.nextAtMs = -1
					return
				}
				damageAmount = effect.RawAmount * critResult.Scalar
			}
		}
		actionTypes := classifierTypeList(sched.ref.Classifier)
		if len(actionTypes) == 0 {
			actionTypes = typeKeysFromCompiledAction(state.bundle, compiledAction)
		}
		preDamageCtx := dpsCombatEventContext{
			Event:          dpsEventOnDamageTaken,
			TimeMs:         timeMs,
			SourceRole:     dpsRoleAttacker,
			TargetRole:     dpsRoleTarget,
			ActionID:       actionID,
			ActionTypes:    actionTypes,
			EffectTypes:    []string{string(model.EffectTypeDealDamage)},
			SourceType:     "basic_attack",
			SourceCategory: "basic_attack",
			SourceID:       damageSource,
			DamageType:     damageType,
			RawDamage:      damageAmount,
			TargetHPBefore: targetHPBefore,
			IsBasicAttack:  true,
			IsOnHit:        true,
			HasCritContext: false,
			ProcScope:      dpsProcScopeRealBasicAttackOnly,
		}
		modifiedAmount, ok := state.applyIncomingDamageModifiers(preDamageCtx, damageAmount)
		if !ok {
			sched.nextAtMs = -1
			return
		}
		app := state.applyDamage(timeMs, damageSource, damageType, modifiedAmount)
		if app.Applied {
			combatCtx = state.buildBasicAttackCombatContext(timeMs, *sched, compiledAction, damageType, app)
			hasCombatCtx = true
		}
	}
	state.syncRunContextHPFromDPS()
	if actionDamageProcessed && hasCombatCtx {
		state.processAttackPassives(combatCtx)
	}

	if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
		sched.nextAtMs = -1
		return
	}

	state.syncRunContextFromDPSState(timeMs)
	cooldownMs, ok := state.runCtx.actionCooldownMs(state.attackerIdx, sched.actionIndex)
	if !ok || cooldownMs <= 0 {
		state.block("invalid_basic_attack_cooldown:" + actionID)
		sched.nextAtMs = -1
		return
	}
	nextAtMs := timeMs + cooldownMs
	sched.nextAtMs = nextAtMs
	state.setDPSActionReadyAt(sched.actionIndex, nextAtMs)

	rawAttackSpeed := readFirstPositiveAttr(state.attrs, "attack_speed", "attackSpeed", "as", "attacks_per_second")
	effectiveAttackSpeed := math.Min(rawAttackSpeed, state.rules.AttackSpeedCap)
	overflowAttackSpeed := math.Max(0, rawAttackSpeed-state.rules.AttackSpeedCap)
	intervalMs := cooldownMs
	if intervalMs < 1 {
		intervalMs = 1
	}
	state.result.AttackIntervalTimeline = append(state.result.AttackIntervalTimeline, model.DPSAttackIntervalV2{
		TimeMs:               timeMs,
		RawAttackSpeed:       rawAttackSpeed,
		EffectiveAttackSpeed: effectiveAttackSpeed,
		OverflowAttackSpeed:  overflowAttackSpeed,
		AttackIntervalMs:     intervalMs,
		NextAttackAtMs:       nextAtMs,
		Source:               basicAttackCooldownIntervalSource(state.bundle, sched.actionIndex),
	})

	if state.result.Status == dpsStatusBlocked {
		sched.nextAtMs = -1
		return
	}
	if state.result.ProcessedEvents >= state.rules.MaxEvents {
		state.result.FinalTimeMs = timeMs
		state.result.StopReason = "event_limit"
		for i := range state.schedules {
			state.schedules[i].nextAtMs = -1
		}
	}
}

func basicAttackCooldownIntervalSource(bundle compilebundle.CompiledBundle, actionIndex uint16) string {
	if int(actionIndex) >= len(bundle.Actions) {
		return "action.cooldown"
	}
	action := bundle.Actions[actionIndex]
	if action.HasCooldownFormula && int(action.CooldownFormula) < len(bundle.Formulas.Programs) {
		if formulaID := strings.TrimSpace(bundle.Formulas.Programs[action.CooldownFormula].ID); formulaID != "" {
			return formulaID
		}
	}
	if action.CooldownMs > 0 {
		return "action.cooldown"
	}
	return "action.cooldown"
}

func (state *dpsCurveState) processAttackPassives(ctx dpsCombatEventContext) {
	onHitCtx := ctx
	onHitCtx.Event = dpsEventOnBasicAttackHit
	refreshStackStatModifiers := state.dispatchDPSLinkedEffects(onHitCtx)
	if refreshStackStatModifiers && state.result.Status != dpsStatusBlocked && state.targetHP > 0 {
		state.refreshActiveStatModifiers(ctx.TimeMs)
	}
	if state.result.Status != dpsStatusBlocked && state.targetHP > 0 {
		dealtCtx := ctx
		dealtCtx.Event = dpsEventOnDamageDealt
		if state.dispatchDPSLinkedEffects(dealtCtx) && state.targetHP > 0 {
			state.refreshActiveStatModifiers(ctx.TimeMs)
		}
	}
	if state.result.Status != dpsStatusBlocked && state.targetHP > 0 {
		takenCtx := ctx
		takenCtx.Event = dpsEventOnDamageTaken
		if state.dispatchDPSLinkedEffects(takenCtx) && state.targetHP > 0 {
			state.refreshActiveStatModifiers(ctx.TimeMs)
		}
	}
	if state.result.Status != dpsStatusBlocked && state.targetHP > 0 {
		state.processPhantomHits(onHitCtx)
	}
}

func (state *dpsCurveState) buildBasicAttackCombatContext(
	timeMs int64,
	sched dpsBasicAttackSchedule,
	action compilebundle.CompiledAction,
	damageType string,
	app dpsDamageApplication,
) dpsCombatEventContext {
	actionTypes := classifierTypeList(sched.ref.Classifier)
	if len(actionTypes) == 0 {
		actionTypes = typeKeysFromCompiledAction(state.bundle, action)
	}
	return dpsCombatEventContext{
		Event:          dpsEventOnBasicAttackHit,
		TimeMs:         timeMs,
		SourceRole:     dpsRoleAttacker,
		TargetRole:     dpsRoleTarget,
		ActionID:       sched.ref.ActionID,
		ActionTypes:    actionTypes,
		EffectTypes:    []string{string(model.EffectTypeDealDamage)},
		SourceType:     "basic_attack",
		SourceCategory: "basic_attack",
		SourceID:       nonEmpty(sched.ref.SkillID, sched.ref.ActionID),
		DamageType:     damageType,
		RawDamage:      app.RawDamage,
		FinalDamage:    app.FinalDamage,
		TargetHPBefore: app.TargetHPBefore,
		TargetHPAfter:  app.TargetHPAfter,
		IsBasicAttack:  true,
		IsOnHit:        true,
		ProcScope:      dpsProcScopeRealBasicAttackOnly,
	}
}

func classifierTypeList(classifier model.ClassifierV2) []string {
	if len(classifier.Types) == 0 && len(classifier.Tags) == 0 {
		return nil
	}
	types := make([]string, 0, len(classifier.Types)+len(classifier.Tags))
	types = append(types, classifier.Types...)
	types = append(types, classifier.Tags...)
	return types
}

func typeKeysFromCompiledAction(bundle compilebundle.CompiledBundle, action compilebundle.CompiledAction) []string {
	keys := make([]string, 0)
	for i, key := range bundle.Types.Keys {
		if action.TypeSet.Contains(typeset.TypeID(i)) {
			keys = append(keys, key)
		}
	}
	return keys
}

func (state *dpsCurveState) collectDPSLinkedPassiveEntries(ctx dpsCombatEventContext) []dpsLinkedPassiveEntry {
	entries := make([]dpsLinkedPassiveEntry, 0, len(state.passives))
	for index, passive := range state.passives {
		if !state.linkedPassiveMatchesEvent(ctx, passive) {
			continue
		}
		entries = append(entries, dpsLinkedPassiveEntry{originalIndex: index, passive: passive})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		left := resolvedDPSPassivePriority(entries[i].passive)
		right := resolvedDPSPassivePriority(entries[j].passive)
		if left != right {
			return left < right
		}
		return entries[i].originalIndex < entries[j].originalIndex
	})
	return entries
}

func (state *dpsCurveState) dispatchDPSLinkedEffects(ctx dpsCombatEventContext) bool {
	entries := state.collectDPSLinkedPassiveEntries(ctx)

	refreshStackStatModifiers := false
	for _, entry := range entries {
		passive := entry.passive
		if ctx.Event == dpsEventOnDamageTaken && passiveOnlyDamageModifierOperations(passive) {
			continue
		}
		triggerKind := resolvedDPSTriggerKind(passive)
		if triggerKind == dpsTriggerStatAlwaysOn || triggerKind == dpsTriggerPreEnabledModifier {
			continue
		}
		if triggerKind == dpsTriggerEnergizedChargeAndConsume {
			if state.passiveActiveAt(passive, ctx.TimeMs) {
				if state.processEnergizedChargePassive(ctx.TimeMs, passive) && passiveHasPerStackStatModifier(passive) {
					refreshStackStatModifiers = true
				}
			}
			continue
		}
		if triggerKind == dpsTriggerNextBasicAttackAfterState {
			if !state.nextAttackStateReady(passive, ctx.TimeMs) {
				continue
			}
		} else if !state.passiveActiveAt(passive, ctx.TimeMs) {
			continue
		}
		if triggerKind == dpsTriggerEveryNBasicAttack {
			key := passiveRuntimeKey(passive)
			state.hitCounts[key]++
			everyN := passive.EveryN
			if everyN <= 0 {
				everyN = 1
			}
			if state.hitCounts[key]%everyN != 0 {
				continue
			}
		}
		state.recordPassiveTrigger(ctx.TimeMs, passive)
		for _, op := range passive.Operations {
			if op.Kind == dpsOpPhantomHitOnHitRepeat || op.Kind == dpsOpDamageModifier {
				continue
			}
			if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
				return refreshStackStatModifiers
			}
			state.applyPassiveOperation(ctx.TimeMs, passive, op)
		}
		if triggerKind == dpsTriggerNextBasicAttackAfterState {
			state.consumeScenarioState(ctx.TimeMs, passive.RequiresScenarioStateID)
		}
		if passiveHasPerStackStatModifier(passive) {
			refreshStackStatModifiers = true
		}
	}
	return refreshStackStatModifiers
}

func passiveOnlyDamageModifierOperations(passive model.DPSPassiveEffectV2) bool {
	if len(passive.Operations) == 0 {
		return false
	}
	for _, op := range passive.Operations {
		if op.Kind != dpsOpDamageModifier {
			return false
		}
	}
	return true
}

func (state *dpsCurveState) collectIncomingDamageModifierEntries(ctx dpsCombatEventContext) []dpsIncomingDamageModifierEntry {
	entries := make([]dpsIncomingDamageModifierEntry, 0)
	for index, passive := range state.passives {
		if !state.linkedPassiveMatchesEvent(ctx, passive) {
			continue
		}
		triggerKind := resolvedDPSTriggerKind(passive)
		if triggerKind == dpsTriggerStatAlwaysOn || triggerKind == dpsTriggerPreEnabledModifier {
			continue
		}
		if triggerKind == dpsTriggerEnergizedChargeAndConsume || triggerKind == dpsTriggerNextBasicAttackAfterState {
			continue
		}
		if !state.passiveActiveAt(passive, ctx.TimeMs) {
			continue
		}
		if triggerKind == dpsTriggerEveryNBasicAttack {
			key := passiveRuntimeKey(passive)
			everyN := passive.EveryN
			if everyN <= 0 {
				everyN = 1
			}
			if state.hitCounts[key]%everyN != 0 {
				continue
			}
		}
		for opIndex, op := range passive.Operations {
			if op.Kind != dpsOpDamageModifier {
				continue
			}
			entries = append(entries, dpsIncomingDamageModifierEntry{
				originalIndex:  index,
				operationIndex: opIndex,
				passive:        passive,
				op:             op,
			})
		}
	}
	sort.SliceStable(entries, func(i, j int) bool {
		leftPriority := resolvedDPSPassivePriority(entries[i].passive)
		rightPriority := resolvedDPSPassivePriority(entries[j].passive)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		if entries[i].originalIndex != entries[j].originalIndex {
			return entries[i].originalIndex < entries[j].originalIndex
		}
		return entries[i].operationIndex < entries[j].operationIndex
	})
	return entries
}

func (state *dpsCurveState) applyIncomingDamageModifiers(ctx dpsCombatEventContext, amount float64) (float64, bool) {
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		state.block("incoming damage modifier requires valid raw amount")
		return 0, false
	}
	entries := state.collectIncomingDamageModifierEntries(ctx)
	current := amount
	triggered := map[string]bool{}
	for _, entry := range entries {
		passive := entry.passive
		op := entry.op
		valuePhase := strings.TrimSpace(op.ValuePhase)
		if valuePhase == "" {
			valuePhase = dpsValuePhaseIncoming
		}
		if valuePhase != dpsValuePhaseIncoming {
			state.block("passive damage_modifier only supports valuePhase incoming")
			return 0, false
		}
		modifierMode := strings.TrimSpace(op.ModifierMode)
		if modifierMode == "" {
			modifierMode = "percent"
		}
		if modifierMode != "percent" {
			state.block("passive damage_modifier only supports modifierMode percent")
			return 0, false
		}
		targetRole := resolvedDPSOperationTargetRole(op, dpsOpDamageModifier)
		if targetRole != dpsRoleTarget {
			state.block("passive damage_modifier only supports targetRole target")
			return 0, false
		}
		if op.CritOnly && !ctx.HasCritContext {
			state.block("passive damage_modifier critOnly requires crit context")
			return 0, false
		}
		raw := current
		modified := current * (1 + op.Value)
		if modified < 0 || math.IsNaN(modified) || math.IsInf(modified, 0) {
			state.block("passive damage_modifier resolved invalid amount")
			return 0, false
		}
		runtimeKey := passiveRuntimeKey(passive)
		if !triggered[runtimeKey] {
			state.recordPassiveTrigger(ctx.TimeMs, passive)
			triggered[runtimeKey] = true
		}
		state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
			TimeMs:  ctx.TimeMs,
			Source:  passiveDamageSource(passive, op),
			Kind:    dpsOpDamageModifier,
			Amount:  modified - raw,
			Message: incomingDamageModifierBreakdownMessage(valuePhase, raw, modified, op.Value),
		})
		current = modified
	}
	return current, true
}

func incomingDamageModifierBreakdownMessage(valuePhase string, raw float64, modified float64, value float64) string {
	return "valuePhase=" + valuePhase +
		" raw=" + floatToString(raw) +
		" modified=" + floatToString(modified) +
		" value=" + floatToString(value)
}

func dpsPassiveEventMatchesContext(passiveEvent string, ctx dpsCombatEventContext) bool {
	if passiveEvent == ctx.Event {
		return true
	}
	if passiveEvent == dpsEventOnHit && ctx.IsOnHit && ctx.Event == dpsEventOnBasicAttackHit {
		return true
	}
	return false
}

func (state *dpsCurveState) linkedPassiveMatchesEvent(ctx dpsCombatEventContext, passive model.DPSPassiveEffectV2) bool {
	ownerRole := resolvedDPSOwnerRole(passive)
	event := resolvedDPSTriggerEvent(passive)
	if !dpsPassiveEventMatchesContext(event, ctx) {
		return false
	}
	switch ctx.Event {
	case dpsEventOnBasicAttackHit, dpsEventOnHit, dpsEventOnSpellHit:
		if ownerRole != dpsRoleAttacker {
			return false
		}
	case dpsEventOnDamageDealt:
		if ownerRole != ctx.SourceRole {
			return false
		}
	case dpsEventOnDamageTaken:
		if ownerRole != ctx.TargetRole {
			return false
		}
	}
	return state.linkedPassiveMatchesMatcher(ctx, passive)
}

func (state *dpsCurveState) linkedPassiveMatchesMatcher(ctx dpsCombatEventContext, passive model.DPSPassiveEffectV2) bool {
	matcher := passive.Trigger.Matcher
	if len(matcher.DamageTypes) > 0 && !stringInList(matcher.DamageTypes, ctx.DamageType) {
		return false
	}
	if !dpsTypeMatcherEmpty(matcher.ActionTypes) && !matchDPSTypeMatcher(matcher.ActionTypes, ctx.ActionTypes) {
		return false
	}
	if !dpsTypeMatcherEmpty(matcher.EffectTypes) && !matchDPSTypeMatcher(matcher.EffectTypes, ctx.EffectTypes) {
		return false
	}
	if !dpsTypeMatcherEmpty(matcher.EffectTags) && !matchDPSTypeMatcher(matcher.EffectTags, ctx.EffectTags) {
		return false
	}
	if len(matcher.SourceTypes) > 0 && !stringInList(matcher.SourceTypes, ctx.SourceType) {
		return false
	}
	if len(matcher.SourceCategories) > 0 && !stringInList(matcher.SourceCategories, ctx.SourceCategory) {
		return false
	}
	procScope := ctx.ProcScope
	if procScope == "" {
		procScope = dpsProcScopeRealBasicAttackOnly
	}
	if len(matcher.ProcScopes) > 0 && !stringInList(matcher.ProcScopes, procScope) {
		return false
	}
	if matcher.IncludePhantom && !ctx.IsPhantomHit {
		return false
	}
	if matcher.ExcludePhantom && ctx.IsPhantomHit {
		return false
	}
	return true
}

func resolvedDPSOwnerRole(passive model.DPSPassiveEffectV2) string {
	role := strings.TrimSpace(passive.OwnerRole)
	if role == "" {
		return dpsRoleAttacker
	}
	return role
}

func resolvedDPSPassivePriority(passive model.DPSPassiveEffectV2) int {
	return passive.Priority
}

func resolvedDPSTriggerKind(passive model.DPSPassiveEffectV2) string {
	triggerKind := strings.TrimSpace(passive.TriggerKind)
	if triggerKind == "" {
		return dpsTriggerOnBasicAttackHit
	}
	return triggerKind
}

func resolvedDPSTriggerEvent(passive model.DPSPassiveEffectV2) string {
	if event := strings.TrimSpace(passive.Trigger.Event); event != "" {
		return event
	}
	switch resolvedDPSTriggerKind(passive) {
	case dpsTriggerOnBasicAttackHit, dpsTriggerEveryNBasicAttack, dpsTriggerStackOnHit, dpsTriggerNextBasicAttackAfterState, dpsTriggerEnergizedChargeAndConsume:
		return dpsEventOnBasicAttackHit
	case dpsTriggerStatAlwaysOn:
		return dpsTriggerStatAlwaysOn
	case dpsTriggerPreEnabledModifier:
		return dpsTriggerPreEnabledModifier
	default:
		return resolvedDPSTriggerKind(passive)
	}
}

func dpsTypeMatcherEmpty(matcher model.TypeMatcherV2) bool {
	return len(matcher.Any) == 0 && len(matcher.All) == 0 && len(matcher.None) == 0
}

func matchDPSTypeMatcher(matcher model.TypeMatcherV2, types []string) bool {
	set := normalizeStringSet(types)
	if len(matcher.Any) > 0 {
		found := false
		for _, candidate := range matcher.Any {
			if set[strings.TrimSpace(candidate)] {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	for _, candidate := range matcher.All {
		if !set[strings.TrimSpace(candidate)] {
			return false
		}
	}
	for _, candidate := range matcher.None {
		if set[strings.TrimSpace(candidate)] {
			return false
		}
	}
	return true
}

func stringInList(values []string, target string) bool {
	target = strings.TrimSpace(target)
	for _, value := range values {
		if strings.TrimSpace(value) == target {
			return true
		}
	}
	return false
}

func (state *dpsCurveState) processPhantomHits(ctx dpsCombatEventContext) {
	if state.phantomDepth > 0 {
		return
	}
	timeMs := ctx.TimeMs
	for _, entry := range state.collectDPSLinkedPassiveEntries(ctx) {
		passive := entry.passive
		if !state.passiveActiveAt(passive, timeMs) {
			continue
		}
		triggerKind := resolvedDPSTriggerKind(passive)
		if triggerKind == dpsTriggerStatAlwaysOn || triggerKind == dpsTriggerPreEnabledModifier {
			continue
		}
		if triggerKind == dpsTriggerEnergizedChargeAndConsume {
			continue
		}
		if triggerKind == dpsTriggerNextBasicAttackAfterState {
			continue
		}
		if triggerKind == dpsTriggerEveryNBasicAttack {
			key := passiveRuntimeKey(passive)
			everyN := passive.EveryN
			if everyN <= 0 {
				everyN = 1
			}
			if state.hitCounts[key]%everyN != 0 {
				continue
			}
		}
		for _, op := range passive.Operations {
			if op.Kind != dpsOpPhantomHitOnHitRepeat {
				continue
			}
			if !state.phantomHitShouldFire(passive, op) {
				continue
			}
			state.phantomDepth++
			state.applyPhantomHit(timeMs, passive, op)
			state.phantomDepth--
			if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
				return
			}
		}
	}
}

func (state *dpsCurveState) phantomHitShouldFire(passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) bool {
	if op.StackKey == "" {
		return false
	}
	triggerStacks := op.TriggerStacks
	if triggerStacks <= 0 {
		return false
	}
	return state.stacks[stackRuntimeKey(passive, op.StackKey)] >= triggerStacks
}

func (state *dpsCurveState) applyPhantomHit(timeMs int64, passive model.DPSPassiveEffectV2, phantomOp model.DPSPassiveOperationV2) {
	repeatTag := strings.TrimSpace(phantomOp.RepeatTag)
	state.recordPhantomPassiveTrigger(timeMs, passive, repeatTag)
	for _, op := range passive.Operations {
		if op.Kind != dpsOpDamage || !op.PhantomHitCopyable {
			continue
		}
		if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
			return
		}
		state.copyPhantomPassiveDamage(timeMs, passive, op, repeatTag)
	}
}

func (state *dpsCurveState) copyPhantomPassiveDamage(
	timeMs int64,
	passive model.DPSPassiveEffectV2,
	op model.DPSPassiveOperationV2,
	repeatTag string,
) {
	stacks := 0
	if op.StackKey != "" {
		stacks = state.stacks[stackRuntimeKey(passive, op.StackKey)]
	}
	amount, attrEvidence, ok := state.resolveOperationAmount(op, stacks)
	if !ok {
		return
	}
	source := passiveDamageSource(passive, op)
	if !state.applyDamage(timeMs, source, op.DamageType, amount).Applied {
		return
	}
	last := len(state.result.DamageTimeline) - 1
	if last >= 0 {
		state.result.DamageTimeline[last].PhantomHit = true
		state.result.DamageTimeline[last].RepeatTag = repeatTag
	}
	message := passiveDamageBreakdownMessage(op, attrEvidence)
	if repeatTag != "" {
		message = "repeatTag=" + repeatTag + " " + message
	}
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:     timeMs,
		Source:     source,
		Kind:       dpsOpDamage,
		Amount:     amount,
		Message:    message,
		PhantomHit: true,
		RepeatTag:  repeatTag,
	})
}

func resolvedDPSOperationTargetRole(op model.DPSPassiveOperationV2, kind string) string {
	role := strings.TrimSpace(op.TargetRole)
	if role == "" {
		switch kind {
		case dpsOpDamage, dpsOpApplyDot, dpsOpTriggerDamageAtStacks, dpsOpDamageModifier:
			return dpsRoleTarget
		default:
			return dpsRoleAttacker
		}
	}
	return role
}

func (state *dpsCurveState) applyPassiveOperation(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	switch op.Kind {
	case dpsOpDamage:
		stacks := 0
		if op.StackKey != "" {
			stacks = state.stacks[stackRuntimeKey(passive, op.StackKey)]
		}
		amount, attrEvidence, ok := state.resolveOperationAmount(op, stacks)
		if !ok {
			return
		}
		source := passiveDamageSource(passive, op)
		switch resolvedDPSOperationTargetRole(op, dpsOpDamage) {
		case dpsRoleAttacker:
			if state.applyAttackerDamage(timeMs, source, op.DamageType, amount) {
				state.recordPassiveDamageBreakdown(timeMs, passive, op, amount, dpsOpDamage, attrEvidence)
			}
		default:
			if state.applyDamage(timeMs, source, op.DamageType, amount).Applied {
				state.recordPassiveDamageBreakdown(timeMs, passive, op, amount, dpsOpDamage, attrEvidence)
			}
		}
	case dpsOpApplyDot:
		state.applyDot(timeMs, passive, op)
	case dpsOpAddStack:
		state.addStack(timeMs, passive, op)
	case dpsOpTriggerDamageAtStacks:
		state.triggerDamageAtStacks(timeMs, passive, op)
	case dpsOpStatModifier:
		if op.PerStack {
			return
		}
		state.applyStatModifier(timeMs, passive, op, true)
	}
}

func (state *dpsCurveState) applyInitialStatModifiers() {
	state.refreshActiveStatModifiers(0)
}

func (state *dpsCurveState) syncTargetResistancesFromAttrs() {
	state.armor = readFirstFiniteAttr(state.targetAttrs, "armor", "armour")
	state.magicResist = readFirstFiniteAttr(state.targetAttrs, "magic_resist", "mr", "spellblock", "spell_block")
}

func (state *dpsCurveState) refreshActiveStatModifiers(timeMs int64) {
	state.attrs = copyDPSFloatMap(state.baseAttrs)
	state.targetAttrs = copyDPSFloatMap(state.targetBaseAttrs)
	for _, passive := range state.passives {
		if !state.passiveActiveAt(passive, timeMs) {
			continue
		}
		isInitialModifier := passive.TriggerKind == dpsTriggerStatAlwaysOn || passive.TriggerKind == dpsTriggerPreEnabledModifier
		if isInitialModifier {
			triggerKey := "stat_modifier:" + passiveRuntimeKey(passive)
			record := !state.statModifierTriggers[triggerKey]
			if record {
				state.recordPassiveTrigger(timeMs, passive)
				state.statModifierTriggers[triggerKey] = true
			}
			for _, op := range passive.Operations {
				if op.Kind == dpsOpStatModifier && !op.PerStack {
					state.applyStatModifier(timeMs, passive, op, record)
				}
			}
		}
		for _, op := range passive.Operations {
			if op.Kind != dpsOpStatModifier || !op.PerStack {
				continue
			}
			stacks := state.stacks[stackRuntimeKey(passive, op.StackKey)]
			if stacks <= 0 {
				continue
			}
			state.applyStatModifier(timeMs, passive, op, true)
		}
	}
	state.syncTargetResistancesFromAttrs()
}

func (state *dpsCurveState) applyStatModifier(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2, record bool) {
	if op.AttrKey == "" {
		state.block("passive stat_modifier operation requires attrKey")
		return
	}
	targetRole := resolvedDPSOperationTargetRole(op, dpsOpStatModifier)
	attrMap := state.attrs
	if targetRole == dpsRoleTarget {
		attrMap = state.targetAttrs
	}
	current, ok := attrMap[op.AttrKey]
	if !ok || math.IsNaN(current) || math.IsInf(current, 0) {
		state.block("passive stat_modifier operation requires existing attr " + op.AttrKey)
		return
	}
	stacks := 1
	value := op.Value
	if op.PerStack {
		if op.StackKey == "" {
			state.block("passive perStack stat_modifier operation requires stackKey")
			return
		}
		stacks = state.stacks[stackRuntimeKey(passive, op.StackKey)]
		if stacks <= 0 {
			return
		}
		value *= float64(stacks)
	}
	switch op.ModifierMode {
	case "", "flat":
		attrMap[op.AttrKey] = current + value
	case "percent":
		attrMap[op.AttrKey] = current * (1 + value)
	case "override", "override_base", "override_current", "override_max":
		attrMap[op.AttrKey] = value
	default:
		state.block("unsupported passive stat modifier mode " + op.ModifierMode)
		return
	}
	if targetRole == dpsRoleTarget {
		state.syncTargetResistancesFromAttrs()
	}
	if !record {
		return
	}
	state.result.EffectTimeline = append(state.result.EffectTimeline, model.DPSEffectEventV2{
		TimeMs: timeMs, SourceID: nonEmpty(passive.SourceID, passiveID(passive)), Kind: dpsOpStatModifier,
	})
	amount := state.attrs[op.AttrKey]
	if targetRole == dpsRoleTarget {
		amount = state.targetAttrs[op.AttrKey]
	}
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    dpsOpStatModifier,
		Amount:  amount,
		Message: statModifierBreakdownMessage(op, stacks, targetRole),
	})
}

func (state *dpsCurveState) addStack(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	if op.StackKey == "" {
		state.block("passive add_stack operation requires stackKey")
		return
	}
	if op.RefreshMode != "" && op.RefreshMode != "refresh" {
		state.block("passive add_stack operation has unsupported refreshMode " + op.RefreshMode)
		return
	}
	key := stackRuntimeKey(passive, op.StackKey)
	before := state.stacks[key]
	current := before + 1
	if op.MaxStacks > 0 && current > op.MaxStacks {
		current = op.MaxStacks
	}
	state.stacks[key] = current
	expireAt := int64(0)
	if op.DurationMs > 0 {
		expireAt = timeMs + op.DurationMs
		state.stackExpiry[key] = expireAt
	}
	state.result.EffectTimeline = append(state.result.EffectTimeline, model.DPSEffectEventV2{
		TimeMs: timeMs, SourceID: nonEmpty(passive.SourceID, passiveID(passive)), Kind: dpsOpAddStack,
	})
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    dpsOpAddStack,
		Amount:  float64(current),
		Message: stackBreakdownMessage(op.StackKey, before, current, op.MaxStacks, expireAt),
	})
}

func (state *dpsCurveState) triggerDamageAtStacks(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	if op.StackKey == "" {
		state.block("passive trigger_damage_at_stacks operation requires stackKey")
		return
	}
	triggerStacks := op.TriggerStacks
	if triggerStacks <= 0 {
		triggerStacks = op.MaxStacks
	}
	key := stackRuntimeKey(passive, op.StackKey)
	if triggerStacks <= 0 || state.stacks[key] < triggerStacks {
		return
	}
	amount, attrEvidence, ok := state.resolveOperationAmount(op, state.stacks[key])
	if !ok {
		return
	}
	if !state.applyDamage(timeMs, passiveDamageSource(passive, op), op.DamageType, amount).Applied {
		return
	}
	state.recordPassiveDamageBreakdown(timeMs, passive, op, amount, dpsOpTriggerDamageAtStacks, attrEvidence)
	if op.ResetStacks {
		delete(state.stacks, key)
		delete(state.stackExpiry, key)
	}
}

func (state *dpsCurveState) applyDot(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	tickIntervalMs := state.rules.DotTickIntervalMs
	if op.TickIntervalMs != 0 && op.TickIntervalMs != tickIntervalMs {
		state.block("passive apply_dot operation does not support tickIntervalMs override")
		return
	}
	if op.RefreshMode != "" && op.RefreshMode != "refresh" {
		state.block("passive apply_dot operation has unsupported refreshMode " + op.RefreshMode)
		return
	}
	if op.DurationMs <= 0 || tickIntervalMs <= 0 {
		state.block("passive apply_dot operation requires durationMs and tickIntervalMs")
		return
	}
	stacks := 0
	if op.StackKey != "" {
		stacks = state.stacks[stackRuntimeKey(passive, op.StackKey)]
	}
	key := nonEmpty(op.Source, passiveRuntimeKey(passive)) + ":" + stackRuntimeKey(passive, op.StackKey)
	if op.RefreshMode == "" || op.RefreshMode == "refresh" {
		state.removeDot(key)
	}
	state.dots = append(state.dots, activeDPSDot{
		Key:            key,
		SourceCategory: passive.SourceCategory,
		SourceID:       passive.SourceID,
		SourceType:     passive.SourceType,
		TriggerID:      passive.TriggerID,
		Operation:      op,
		Stacks:         stacks,
		NextTickAtMs:   timeMs + tickIntervalMs,
		ExpireAtMs:     timeMs + op.DurationMs,
	})
	state.result.EffectTimeline = append(state.result.EffectTimeline, model.DPSEffectEventV2{
		TimeMs: timeMs, SourceID: nonEmpty(passive.SourceID, passiveID(passive)), Kind: dpsOpApplyDot,
	})
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    dpsOpApplyDot,
		Amount:  float64(stacks),
		Message: key,
	})
	state.updateQueuePeak()
}

func (state *dpsCurveState) processDotTick(timeMs int64) {
	state.expireStacks(timeMs)
	state.refreshActiveStatModifiers(timeMs)
	if state.result.Status == dpsStatusBlocked {
		return
	}
	for i := range state.dots {
		dot := &state.dots[i]
		if dot.NextTickAtMs != timeMs || dot.NextTickAtMs > dot.ExpireAtMs {
			continue
		}
		state.result.ProcessedEvents++
		state.updateQueuePeak()
		amount, _, ok := state.resolveOperationAmount(dot.Operation, dot.Stacks)
		if !ok {
			return
		}
		source := dot.Operation.Source
		if source == "" {
			source = dot.SourceID
		}
		if state.applyDamage(timeMs, source, dot.Operation.DamageType, amount).Applied {
			state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
				TimeMs:  timeMs,
				Source:  source,
				Kind:    "dot_tick",
				Amount:  amount,
				Message: dot.Key,
			})
		}
		dot.NextTickAtMs += dotInterval(dot.Operation, state.rules)
		break
	}
	state.compactDots()
}

func (state *dpsCurveState) recordPassiveDamageBreakdown(
	timeMs int64,
	passive model.DPSPassiveEffectV2,
	op model.DPSPassiveOperationV2,
	amount float64,
	kind string,
	attrEvidence *dpsAttackerAttrEvidence,
) {
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    kind,
		Amount:  amount,
		Message: passiveDamageBreakdownMessage(op, attrEvidence),
	})
}

type dpsAttackerAttrEvidence struct {
	attrKey      string
	readKind     model.AttributeReadKind
	attrValue    float64
	ratio        float64
	contribution float64
}

func normalizeAttackerAttrRead(kind model.AttributeReadKind) model.AttributeReadKind {
	switch kind {
	case "", model.AttrReadResolved, "total":
		return model.AttrReadResolved
	default:
		return kind
	}
}

func (state *dpsCurveState) readAttackerAttrValue(attrKey string, readKind model.AttributeReadKind) (float64, bool) {
	attrKey = strings.TrimSpace(attrKey)
	if attrKey == "" {
		state.block("passive damage formula requires attackerAttr")
		return 0, false
	}
	kind := normalizeAttackerAttrRead(readKind)
	switch kind {
	case model.AttrReadResolved:
		value, ok := state.attrs[attrKey]
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
			state.block("passive damage formula requires attacker attr " + attrKey)
			return 0, false
		}
		return value, true
	case model.AttrReadBase, model.AttrReadCurrent, model.AttrReadMax:
		view, ok := state.attributeViews[attrKey]
		if !ok {
			state.block("passive damage formula requires attacker attr view " + attrKey + " for read " + string(kind))
			return 0, false
		}
		var value float64
		switch kind {
		case model.AttrReadBase:
			value = view.Base
		case model.AttrReadCurrent:
			value = view.Current
		case model.AttrReadMax:
			value = view.Max
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			state.block("passive damage formula requires valid attacker attr view " + attrKey + " for read " + string(kind))
			return 0, false
		}
		return value, true
	default:
		state.block("unsupported passive damage attackerAttrRead " + string(kind))
		return 0, false
	}
}

func passiveDamageBreakdownMessage(op model.DPSPassiveOperationV2, attrEvidence *dpsAttackerAttrEvidence) string {
	message := op.DamageType
	if attrEvidence == nil {
		return message
	}
	return message + " attackerAttr=" + attrEvidence.attrKey +
		" attackerAttrRead=" + string(attrEvidence.readKind) +
		" attrValue=" + floatToString(attrEvidence.attrValue) +
		" attackerAttrRatio=" + floatToString(attrEvidence.ratio) +
		" contribution=" + floatToString(attrEvidence.contribution)
}

func (state *dpsCurveState) resolveOperationAmount(op model.DPSPassiveOperationV2, stacks int) (float64, *dpsAttackerAttrEvidence, bool) {
	amount := op.Amount
	if op.TargetCurrentHPRatio != 0 {
		hpForCurrent := state.targetHP
		switch op.TargetCurrentHPBasis {
		case "", "current":
		case "attack_start":
			hpForCurrent = state.attackStartTargetHP
		default:
			state.block("unsupported target current hp basis " + op.TargetCurrentHPBasis)
			return 0, nil, false
		}
		if hpForCurrent < 0 {
			hpForCurrent = 0
		}
		amount += hpForCurrent * op.TargetCurrentHPRatio
	}
	if op.TargetMaxHPRatio != 0 {
		if state.targetMaxHP <= 0 {
			state.block("passive damage formula requires target max hp")
			return 0, nil, false
		}
		amount += state.targetMaxHP * op.TargetMaxHPRatio
	}
	if op.TargetMissingHPRatio != 0 {
		if state.targetMaxHP <= 0 {
			state.block("passive damage formula requires target max hp")
			return 0, nil, false
		}
		hpForMissing := state.targetHP
		switch op.TargetMissingHPBasis {
		case "", "current":
		case "attack_start":
			hpForMissing = state.attackStartTargetHP
		default:
			state.block("unsupported target missing hp basis " + op.TargetMissingHPBasis)
			return 0, nil, false
		}
		missingHP := state.targetMaxHP - hpForMissing
		if missingHP < 0 {
			missingHP = 0
		}
		amount += missingHP * op.TargetMissingHPRatio
	}
	if op.TargetMissingHPAmp != 0 {
		if state.targetMaxHP <= 0 {
			state.block("passive damage amp requires target max hp")
			return 0, nil, false
		}
		hpForMissing := state.targetHP
		switch op.TargetMissingHPBasis {
		case "", "current":
		case "attack_start":
			hpForMissing = state.attackStartTargetHP
		default:
			state.block("unsupported target missing hp basis " + op.TargetMissingHPBasis)
			return 0, nil, false
		}
		missingRatio := (state.targetMaxHP - hpForMissing) / state.targetMaxHP
		if missingRatio < 0 {
			missingRatio = 0
		}
		if missingRatio > 1 {
			missingRatio = 1
		}
		amount *= 1 + missingRatio*op.TargetMissingHPAmp
	}
	var attrEvidence *dpsAttackerAttrEvidence
	if op.AttackerAttrRatio != 0 {
		attrValue, ok := state.readAttackerAttrValue(op.AttackerAttr, op.AttackerAttrRead)
		if !ok {
			return 0, nil, false
		}
		contribution := attrValue * op.AttackerAttrRatio
		amount += contribution
		attrEvidence = &dpsAttackerAttrEvidence{
			attrKey:      op.AttackerAttr,
			readKind:     normalizeAttackerAttrRead(op.AttackerAttrRead),
			attrValue:    attrValue,
			ratio:        op.AttackerAttrRatio,
			contribution: contribution,
		}
	}
	if op.AmountPerStack != 0 {
		amount += float64(stacks) * op.AmountPerStack
	}
	if op.HasMinAmount && amount < op.MinAmount {
		amount = op.MinAmount
	}
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		state.block("passive damage formula resolved invalid amount")
		return 0, nil, false
	}
	return amount, attrEvidence, true
}

func (state *dpsCurveState) applyDamage(timeMs int64, source string, damageType string, rawAmount float64) dpsDamageApplication {
	result := dpsDamageApplication{RawDamage: rawAmount}
	resistance := 0.0
	switch damageType {
	case "physical":
		resistance = state.armor
	case "magic":
		resistance = state.magicResist
	case "true":
	default:
		state.block("unsupported damage type " + damageType)
		return result
	}
	resistance = state.effectiveResistance(damageType, resistance)
	mitigatedDamage, code := mitigateDamageByResistance(rawAmount, resistance, damageType)
	if code != model.ErrOK {
		state.block("damage could not be resolved")
		return result
	}
	hpBefore := state.targetHP
	hpAfter, finalDamage, code := applyDamageToHP(state.targetHP, mitigatedDamage)
	if code != model.ErrOK {
		state.block("damage could not be applied")
		return result
	}
	state.targetHP = hpAfter
	state.result.TotalDamage += finalDamage
	state.result.DamageByType[damageType] += finalDamage
	state.result.DamageBySource[source] += finalDamage
	state.result.DamageTimeline = append(state.result.DamageTimeline, model.DPSDamageEventV2{
		TimeMs:         timeMs,
		Source:         source,
		DamageType:     damageType,
		RawDamage:      rawAmount,
		FinalDamage:    finalDamage,
		TargetHPBefore: hpBefore,
		TargetHPAfter:  state.targetHP,
	})
	state.TargetHPTimelineAppend(timeMs)
	if state.targetHP <= 0 {
		state.markKilled(timeMs)
	}
	result.Applied = true
	result.FinalDamage = finalDamage
	result.TargetHPBefore = hpBefore
	result.TargetHPAfter = state.targetHP
	return result
}

func (state *dpsCurveState) applyAttackerDamage(timeMs int64, source string, damageType string, rawAmount float64) bool {
	if rawAmount < 0 || math.IsNaN(rawAmount) || math.IsInf(rawAmount, 0) {
		state.block("passive retaliation damage resolved invalid amount")
		return false
	}
	if !supportedDPSDamageType(damageType) {
		state.block("unsupported retaliation damage type " + damageType)
		return false
	}
	finalDamage := rawAmount
	state.result.AttackerDamageTimeline = append(state.result.AttackerDamageTimeline, model.DPSAttackerDamageEventV2{
		TimeMs:      timeMs,
		Source:      source,
		DamageType:  damageType,
		RawDamage:   rawAmount,
		FinalDamage: finalDamage,
	})
	if state.result.AttackerDamageBySource == nil {
		state.result.AttackerDamageBySource = map[string]float64{}
	}
	state.result.AttackerDamageBySource[source] += finalDamage
	return true
}

func (state *dpsCurveState) effectiveResistance(damageType string, resistance float64) float64 {
	switch damageType {
	case "physical":
		return applyPositiveResistancePenetration(
			resistance,
			readFirstFiniteAttr(state.attrs, "armor_pen_percent", "physical_pen_percent"),
			readFirstFiniteAttr(state.attrs, "armor_pen_flat", "physical_pen", "lethality"),
		)
	case "magic":
		return applyPositiveResistancePenetration(
			resistance,
			readFirstFiniteAttr(state.attrs, "magic_pen_percent"),
			readFirstFiniteAttr(state.attrs, "magic_pen_flat", "magic_pen"),
		)
	default:
		return resistance
	}
}

func applyPositiveResistancePenetration(resistance float64, percentPen float64, flatPen float64) float64 {
	if resistance <= 0 {
		return resistance
	}
	effective := resistance * (1 - clampFloat(percentPen, 0, 1))
	if flatPen > 0 {
		effective -= flatPen
	}
	if effective < 0 {
		return 0
	}
	return effective
}

func (state *dpsCurveState) markKilled(timeMs int64) {
	killTimeMs := timeMs
	state.result.KillTimeMs = &killTimeMs
	if killTimeMs > 0 {
		killDPS := state.result.TotalDamage / (float64(killTimeMs) / 1000)
		state.result.KillDps = &killDPS
	}
	if state.rules.DurationMs > timeMs {
		state.result.TargetHPTimeline = append(state.result.TargetHPTimeline, model.DPSTargetHPEventV2{
			TimeMs: state.rules.DurationMs, CurrentHP: 0, MaxHP: state.targetMaxHP,
		})
	}
	state.result.FinalTimeMs = state.rules.DurationMs
	state.result.StopReason = "target_dead"
}

func (state *dpsCurveState) block(reason string) {
	state.result.Status = dpsStatusBlocked
	state.result.StopReason = "blocked"
	state.result.BlockedReasons = append(state.result.BlockedReasons, reason)
	state.result.DamageTimeline = nil
	state.result.AttackerDamageTimeline = nil
	state.result.AttackerDamageBySource = map[string]float64{}
	state.result.AttackTimeline = nil
	state.result.AttackIntervalTimeline = nil
	state.result.TargetHPTimeline = nil
	state.result.EffectTimeline = nil
	state.result.TotalDamage = 0
	state.result.TimeWindowDps = 0
	state.result.KillDps = nil
	state.result.KillTimeMs = nil
	state.result.DamageByType = map[string]float64{}
	state.result.DamageBySource = map[string]float64{}
	state.result.SkillPassiveTriggers = nil
	state.result.ItemPassiveTriggers = nil
	state.result.ExternalPassiveTriggers = nil
	state.result.EffectBreakdown = nil
}

func (state *dpsCurveState) shouldStopAfterEvent(timeMs int64) bool {
	if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
		return true
	}
	if state.result.ProcessedEvents >= state.rules.MaxEvents {
		state.result.FinalTimeMs = timeMs
		state.result.StopReason = "event_limit"
		return true
	}
	return false
}

func (state *dpsCurveState) updateQueuePeak() {
	peak := 1 + len(state.dots)
	if peak > state.result.QueuePeak {
		state.result.QueuePeak = peak
	}
}

func (state *dpsCurveState) recordPassiveTrigger(timeMs int64, passive model.DPSPassiveEffectV2) {
	state.appendPassiveTrigger(timeMs, passive, false, "")
}

func (state *dpsCurveState) recordPhantomPassiveTrigger(timeMs int64, passive model.DPSPassiveEffectV2, repeatTag string) {
	state.appendPassiveTrigger(timeMs, passive, true, repeatTag)
}

func (state *dpsCurveState) appendPassiveTrigger(timeMs int64, passive model.DPSPassiveEffectV2, phantomHit bool, repeatTag string) {
	trigger := model.DPSPassiveTriggerV2{
		TimeMs:             timeMs,
		ProcSourceCategory: passive.SourceCategory,
		SourceID:           nonEmpty(passive.SourceID, passiveID(passive)),
		SourceType:         passive.SourceType,
		TriggerID:          passive.TriggerID,
		PhantomHit:         phantomHit,
		RepeatTag:          repeatTag,
	}
	switch passive.SourceCategory {
	case "item_passive":
		state.result.ItemPassiveTriggers = append(state.result.ItemPassiveTriggers, trigger)
	case "external_passive":
		state.result.ExternalPassiveTriggers = append(state.result.ExternalPassiveTriggers, trigger)
	default:
		state.result.SkillPassiveTriggers = append(state.result.SkillPassiveTriggers, trigger)
	}
}

func (state *dpsCurveState) passiveActiveAt(passive model.DPSPassiveEffectV2, timeMs int64) bool {
	if passive.RequiresScenarioStateID == "" {
		return true
	}
	return state.scenarioStateActiveAt(passive.RequiresScenarioStateID, timeMs)
}

func (state *dpsCurveState) scenarioStateActiveAt(stateID string, timeMs int64) bool {
	if stateID == "" {
		return false
	}
	for _, scenario := range state.curve.ResolvedSnapshot.ScenarioStates {
		if scenario.StateID != stateID {
			continue
		}
		if scenario.StartTimeMs > timeMs {
			return false
		}
		if scenario.DurationMs > 0 && timeMs >= scenario.StartTimeMs+scenario.DurationMs {
			return false
		}
		return true
	}
	return false
}

func (state *dpsCurveState) nextAttackStateReady(passive model.DPSPassiveEffectV2, timeMs int64) bool {
	if passive.TriggerKind != dpsTriggerNextBasicAttackAfterState {
		return false
	}
	stateID := strings.TrimSpace(passive.RequiresScenarioStateID)
	if stateID == "" {
		return false
	}
	return state.scenarioStateActiveAt(stateID, timeMs) && !state.consumedScenarioStates[stateID]
}

func (state *dpsCurveState) initEnergizedCharge() {
	for _, passive := range state.passives {
		if passive.TriggerKind != dpsTriggerEnergizedChargeAndConsume {
			continue
		}
		chargeKey := strings.TrimSpace(passive.ChargeKey)
		if chargeKey == "" {
			continue
		}
		if _, exists := state.energizedCharge[chargeKey]; exists {
			continue
		}
		cap := effectiveDPSChargeCap(passive)
		initial := 0.0
		for _, scenario := range state.curve.ResolvedSnapshot.ScenarioStates {
			if scenario.StateID != chargeKey || scenario.Activation != "assumed_charge_before_start" {
				continue
			}
			initial = float64(scenario.Stacks)
			break
		}
		initial = clampDPSCharge(initial, cap)
		state.energizedCharge[chargeKey] = initial
		if initial >= passive.ChargeThreshold {
			state.energizedReady[chargeKey] = true
		}
	}
}

func effectiveDPSChargeCap(passive model.DPSPassiveEffectV2) float64 {
	if passive.ChargeCap > 0 {
		return passive.ChargeCap
	}
	return passive.ChargeThreshold
}

func clampDPSCharge(value float64, cap float64) float64 {
	if value < 0 {
		return 0
	}
	if value > cap {
		return cap
	}
	return value
}

func (state *dpsCurveState) processEnergizedChargePassive(timeMs int64, passive model.DPSPassiveEffectV2) bool {
	chargeKey := strings.TrimSpace(passive.ChargeKey)
	if chargeKey == "" {
		state.block("passive energized_charge_and_consume requires chargeKey")
		return false
	}
	if _, ok := state.energizedCharge[chargeKey]; !ok {
		state.initEnergizedChargeForKey(passive, chargeKey)
	}
	if !passive.ConsumeChargeOnTrigger {
		state.block("passive energized_charge_and_consume requires consumeChargeOnTrigger=true")
		return false
	}

	cap := effectiveDPSChargeCap(passive)
	threshold := passive.ChargeThreshold
	gain := passive.ChargeGainPerBasicAttack

	preCharge := state.energizedCharge[chargeKey]
	readyBefore := state.energizedReady[chargeKey]

	triggered := false
	consumed := false
	chargeAfterProc := preCharge

	if readyBefore && preCharge >= threshold {
		triggered = true
		state.recordPassiveTrigger(timeMs, passive)
		for _, op := range passive.Operations {
			if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
				return triggered
			}
			state.applyPassiveOperation(timeMs, passive, op)
		}
		if passive.ConsumeChargeOnTrigger {
			consumed = true
			chargeAfterProc = 0
			state.energizedReady[chargeKey] = false
		} else {
			state.energizedReady[chargeKey] = false
		}
	}

	state.energizedCharge[chargeKey] = chargeAfterProc
	state.recordEnergizedChargeEvidence(timeMs, passive, dpsEffectEnergizedChargeCheck, chargeKey, preCharge, chargeAfterProc, 0, threshold, readyBefore, state.energizedReady[chargeKey], consumed, triggered)
	if consumed {
		state.recordEnergizedChargeEvidence(timeMs, passive, dpsEffectEnergizedChargeConsume, chargeKey, preCharge, chargeAfterProc, 0, threshold, readyBefore, state.energizedReady[chargeKey], consumed, triggered)
	}

	preGainCharge := state.energizedCharge[chargeKey]
	postCharge := preGainCharge + gain
	if postCharge > cap {
		postCharge = cap
	}
	state.energizedCharge[chargeKey] = postCharge

	readyAfter := state.energizedReady[chargeKey]
	if postCharge >= threshold {
		state.energizedReady[chargeKey] = true
		readyAfter = true
	}

	state.recordEnergizedChargeEvidence(timeMs, passive, dpsEffectEnergizedChargeGain, chargeKey, preGainCharge, postCharge, gain, threshold, readyBefore, readyAfter, consumed, triggered)
	return triggered
}

func (state *dpsCurveState) initEnergizedChargeForKey(passive model.DPSPassiveEffectV2, chargeKey string) {
	cap := effectiveDPSChargeCap(passive)
	initial := 0.0
	for _, scenario := range state.curve.ResolvedSnapshot.ScenarioStates {
		if scenario.StateID != chargeKey || scenario.Activation != "assumed_charge_before_start" {
			continue
		}
		initial = float64(scenario.Stacks)
		break
	}
	initial = clampDPSCharge(initial, cap)
	state.energizedCharge[chargeKey] = initial
	if initial >= passive.ChargeThreshold {
		state.energizedReady[chargeKey] = true
	}
}

func (state *dpsCurveState) recordEnergizedChargeEvidence(
	timeMs int64,
	passive model.DPSPassiveEffectV2,
	kind string,
	chargeKey string,
	preCharge float64,
	postCharge float64,
	chargeGain float64,
	chargeThreshold float64,
	readyBeforeHit bool,
	readyAfterHit bool,
	consumed bool,
	triggered bool,
) {
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  nonEmpty(passive.SourceID, passiveID(passive)),
		Kind:    kind,
		Amount:  postCharge,
		Message: energizedChargeBreakdownMessage(chargeKey, preCharge, postCharge, chargeGain, chargeThreshold, readyBeforeHit, readyAfterHit, consumed, triggered),
	})
}

func energizedChargeBreakdownMessage(
	chargeKey string,
	preCharge float64,
	postCharge float64,
	chargeGain float64,
	chargeThreshold float64,
	readyBeforeHit bool,
	readyAfterHit bool,
	consumed bool,
	triggered bool,
) string {
	return "chargeKey=" + chargeKey +
		" preCharge=" + floatToString(preCharge) +
		" postCharge=" + floatToString(postCharge) +
		" chargeGain=" + floatToString(chargeGain) +
		" chargeThreshold=" + floatToString(chargeThreshold) +
		" readyBeforeHit=" + boolToString(readyBeforeHit) +
		" readyAfterHit=" + boolToString(readyAfterHit) +
		" consumed=" + boolToString(consumed) +
		" triggered=" + boolToString(triggered)
}

func boolToString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func (state *dpsCurveState) consumeScenarioState(timeMs int64, stateID string) {
	stateID = strings.TrimSpace(stateID)
	if stateID == "" || state.consumedScenarioStates[stateID] {
		return
	}
	state.consumedScenarioStates[stateID] = true
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  stateID,
		Kind:    dpsEffectNextAttackStateConsume,
		Message: "consumedScenarioStateId=" + stateID,
	})
}

func (state *dpsCurveState) nextDotTick() (int64, bool) {
	var next int64
	found := false
	for _, dot := range state.dots {
		if dot.NextTickAtMs > dot.ExpireAtMs || dot.NextTickAtMs >= state.rules.DurationMs {
			continue
		}
		if !found || dot.NextTickAtMs < next {
			next = dot.NextTickAtMs
			found = true
		}
	}
	return next, found
}

func (state *dpsCurveState) removeDot(key string) {
	next := state.dots[:0]
	for _, dot := range state.dots {
		if dot.Key != key {
			next = append(next, dot)
		}
	}
	state.dots = next
}

func (state *dpsCurveState) compactDots() {
	next := state.dots[:0]
	for _, dot := range state.dots {
		if dot.NextTickAtMs <= dot.ExpireAtMs && dot.NextTickAtMs < state.rules.DurationMs {
			next = append(next, dot)
		}
	}
	state.dots = next
}

func (state *dpsCurveState) expireStacks(timeMs int64) {
	for key, expireAt := range state.stackExpiry {
		if expireAt > 0 && expireAt <= timeMs {
			delete(state.stackExpiry, key)
			delete(state.stacks, key)
		}
	}
}

func validateDPSCurve(
	bundle compilebundle.CompiledBundle,
	rules model.DPSimulationRulesV2,
	curve model.DPSCurveRunSpecV2,
	attacker model.DPSActorSnapshotV2,
	target model.DPSActorSnapshotV2,
) []string {
	reasons := make([]string, 0)
	if rules.DurationMs <= 0 {
		reasons = append(reasons, "simulationRules.durationMs must be positive")
	}
	if rules.WarmupMs != 0 {
		reasons = append(reasons, "single_attacker_dps only supports simulationRules.warmupMs=0")
	}
	if rules.SampleBy != "none" {
		reasons = append(reasons, "single_attacker_dps only supports simulationRules.sampleBy=none")
	}
	if rules.EventWindowPolicy != "timeMs < durationMs" {
		reasons = append(reasons, "single_attacker_dps only supports simulationRules.eventWindowPolicy=timeMs < durationMs")
	}
	if rules.DotTickIntervalMs != 1000 {
		reasons = append(reasons, "single_attacker_dps only supports simulationRules.dotTickIntervalMs=1000")
	}
	if rules.CritPolicy != "expected" {
		reasons = append(reasons, "single_attacker_dps only supports simulationRules.critPolicy=expected")
	}
	if rules.AttackSpeedCap != 3.0 {
		reasons = append(reasons, "single_attacker_dps only supports simulationRules.attackSpeedCap=3.0")
	}
	if rules.FirstAttackAtMs != 0 || rules.AutoAttackPlan.StartAtMs != 0 {
		reasons = append(reasons, "single_attacker_dps only supports first attack at 0ms")
	}
	if !rules.AutoAttackPlan.Enabled {
		reasons = append(reasons, "simulationRules.autoAttackPlan.enabled must be true")
	}
	if rules.AutoAttackPlan.TargetRole != "target" {
		reasons = append(reasons, "single_attacker_dps only supports autoAttackPlan.targetRole=target")
	}
	if len(bundle.Actions) == 0 {
		reasons = append(reasons, "compiled bundle is required for single_attacker_dps")
	}
	if len(curve.ResolvedSnapshot.BasicAttackActions) == 0 {
		reasons = append(reasons, "missing_basic_attack_action")
	}
	attackerTemplateID := nonEmpty(attacker.TemplateID, "dps_attacker")
	for _, ref := range curve.ResolvedSnapshot.BasicAttackActions {
		if strings.TrimSpace(ref.ActionID) == "" {
			reasons = append(reasons, "basicAttackActions.actionId is required")
			continue
		}
		actionIndex, ok := bundle.ActionIndex[ref.ActionID]
		if !ok {
			reasons = append(reasons, "action_not_found:"+ref.ActionID)
			continue
		}
		if !attackerOwnsCompiledAction(bundle, attackerTemplateID, actionIndex) {
			reasons = append(reasons, "action_not_owned:"+ref.ActionID)
			continue
		}
		if !compiledActionHasBasicAttackClassifier(bundle, actionIndex) {
			reasons = append(reasons, "invalid_basic_attack_classifier:"+ref.ActionID)
		}
	}
	if attacker.ActorID == "" {
		reasons = append(reasons, "resolvedSnapshot.attackerSnapshot is required")
	}
	if target.ActorID == "" {
		reasons = append(reasons, "resolvedSnapshot.targetSnapshot is required")
	}
	if curve.Selection.TargetID == "" {
		reasons = append(reasons, "selection.targetId is required")
	} else if target.ActorID != "" && curve.Selection.TargetID != target.ActorID {
		reasons = append(reasons, "selection.targetId must match resolvedSnapshot.targetSnapshot.actorId")
	}
	if curve.Selection.TargetType != "" && curve.Selection.TargetType != "target_dummy" {
		reasons = append(reasons, "selection.targetType must be target_dummy")
	}
	if target.ActorID != "" && !hasType(target.Types, "target_dummy") {
		reasons = append(reasons, "single_attacker_dps requires target_dummy target actor")
	}
	if readFirstPositiveAttr(attacker.Attributes, "attack_speed", "attackSpeed", "as", "attacks_per_second") <= 0 {
		reasons = append(reasons, "attacker attack speed is required")
	}
	targetMaxHP := target.MaxHP
	if targetMaxHP <= 0 {
		targetMaxHP = readFirstPositiveAttr(target.Attributes, "hp", "health", "max_hp", "max_health")
	}
	if targetMaxHP <= 0 {
		reasons = append(reasons, "target max hp is required")
	}
	if !hasAnyFiniteAttr(target.Attributes, "armor", "armour") {
		reasons = append(reasons, "target armor is required")
	}
	if !hasAnyFiniteAttr(target.Attributes, "magic_resist", "mr", "spellblock", "spell_block") {
		reasons = append(reasons, "target magic resist is required")
	}
	reasons = append(reasons, validateDPSPassiveSelection(curve)...)
	return reasons
}

func validateDPSEquipment(curve model.DPSCurveRunSpecV2) []string {
	reasons := make([]string, 0)
	selectionSet := normalizeStringSet(curve.Selection.EquipmentSet)
	resolvedSet := normalizeStringSet(curve.ResolvedSnapshot.EquipmentSet)
	if len(selectionSet) > 0 && len(resolvedSet) == 0 {
		reasons = append(reasons, "resolvedSnapshot.equipmentSet is required when selection.equipmentSet is present")
	}
	if len(selectionSet) > 0 && len(resolvedSet) > 0 && !sameStringSet(selectionSet, resolvedSet) {
		reasons = append(reasons, "selection.equipmentSet must match resolvedSnapshot.equipmentSet")
	}
	if len(resolvedSet) > 0 && len(curve.ResolvedSnapshot.EquipmentStats) == 0 {
		reasons = append(reasons, "resolvedSnapshot.equipmentStats is required when equipmentSet is present")
	}
	for attrKey, value := range curve.ResolvedSnapshot.EquipmentStats {
		if strings.TrimSpace(attrKey) == "" {
			reasons = append(reasons, "resolvedSnapshot.equipmentStats contains empty attr key")
			continue
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			reasons = append(reasons, "resolvedSnapshot.equipmentStats."+attrKey+" must be finite")
		}
	}
	return reasons
}

func validateDPSPassiveSelection(curve model.DPSCurveRunSpecV2) []string {
	reasons := make([]string, 0)
	enabled := enabledPassiveIDSet(curve)
	if len(enabled) == 0 {
		return reasons
	}
	for id := range enabled {
		if findPassiveByID(curve.ResolvedSnapshot.PassiveEffects, id) == nil {
			reasons = append(reasons, "enabled passive effect "+id+" is missing from resolvedSnapshot.passiveEffects")
		}
	}
	for _, passive := range curve.ResolvedSnapshot.PassiveEffects {
		if !passiveIsEnabled(passive, enabled) {
			continue
		}
		reasons = append(reasons, validateDPSPassive(passive, curve)...)
	}
	return reasons
}

func validateDPSPassive(passive model.DPSPassiveEffectV2, curve model.DPSCurveRunSpecV2) []string {
	reasons := make([]string, 0)
	id := passiveID(passive)
	if id == "" {
		reasons = append(reasons, "passive effect requires passiveId/effectId/sourceId")
	}
	if passive.SourceCategory == "" {
		reasons = append(reasons, "passive effect "+id+" requires sourceCategory")
	}
	if passive.SourceID == "" {
		reasons = append(reasons, "passive effect "+id+" requires sourceId")
	}
	if passive.TriggerID == "" {
		reasons = append(reasons, "passive effect "+id+" requires triggerId")
	}
	if !supportedDPSTrigger(passive.TriggerKind) {
		reasons = append(reasons, "passive effect "+id+" has unsupported triggerKind "+passive.TriggerKind)
	}
	reasons = append(reasons, validateDPSLinkedPassiveTrigger(id, passive)...)
	if passive.TriggerKind == dpsTriggerEveryNBasicAttack && passive.EveryN <= 0 {
		reasons = append(reasons, "passive effect "+id+" requires everyN")
	}
	if passive.TriggerKind == dpsTriggerNextBasicAttackAfterState && strings.TrimSpace(passive.RequiresScenarioStateID) == "" {
		reasons = append(reasons, "passive effect "+id+" triggerKind next_basic_attack_after_state requires requiresScenarioStateId or scenarioState")
	}
	if passive.TriggerKind == dpsTriggerEnergizedChargeAndConsume {
		reasons = append(reasons, validateDPSEnergizedPassive(id, passive)...)
	}
	if passive.RequiresScenarioStateID != "" && !hasScenarioState(curve.ResolvedSnapshot.ScenarioStates, passive.RequiresScenarioStateID) {
		reasons = append(reasons, "passive effect "+id+" requires missing scenarioState "+passive.RequiresScenarioStateID)
	}
	if len(passive.Operations) == 0 {
		reasons = append(reasons, "passive effect "+id+" requires operations")
	}
	addStackKeys := map[string]bool{}
	hasCopyableDamage := false
	for _, op := range passive.Operations {
		if op.Kind == dpsOpAddStack && op.StackKey != "" {
			addStackKeys[op.StackKey] = true
		}
		if op.Kind == dpsOpDamage && op.PhantomHitCopyable {
			hasCopyableDamage = true
		}
		if op.PhantomHitCopyable && op.Kind != dpsOpDamage {
			reasons = append(reasons, "passive effect "+id+" phantomHitCopyable is only supported on damage operations")
		}
	}
	for _, op := range passive.Operations {
		reasons = append(reasons, validateDPSPassiveOperation(id, op)...)
		if op.Kind == dpsOpStatModifier && op.PerStack {
			if op.StackKey == "" {
				reasons = append(reasons, "passive effect "+id+" perStack stat_modifier requires stackKey")
			} else if !addStackKeys[op.StackKey] {
				reasons = append(reasons, "passive effect "+id+" perStack stat_modifier requires matching add_stack for stackKey "+op.StackKey)
			}
		}
		if op.Kind == dpsOpPhantomHitOnHitRepeat {
			reasons = append(reasons, validateDPSPhantomHitOperation(id, op, addStackKeys, hasCopyableDamage)...)
		}
	}
	return reasons
}

func validateDPSPhantomHitOperation(
	passiveID string,
	op model.DPSPassiveOperationV2,
	addStackKeys map[string]bool,
	hasCopyableDamage bool,
) []string {
	reasons := make([]string, 0)
	if op.StackKey == "" {
		reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires stackKey")
	}
	if op.TriggerStacks <= 0 {
		reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires triggerStacks > 0")
	}
	if op.RepeatCount != 1 {
		reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires repeatCount=1")
	}
	if strings.TrimSpace(op.RepeatTag) == "" {
		reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires repeatTag")
	}
	if op.RepeatScope != dpsRepeatScopeCopyableOnHit {
		reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires repeatScope="+dpsRepeatScopeCopyableOnHit)
	}
	if op.StackKey != "" && !addStackKeys[op.StackKey] {
		reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires matching add_stack for stackKey "+op.StackKey)
	}
	if !hasCopyableDamage {
		reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires at least one phantomHitCopyable damage operation")
	}
	return reasons
}

func validateDPSPassiveOperation(passiveID string, op model.DPSPassiveOperationV2) []string {
	reasons := make([]string, 0)
	reasons = append(reasons, validateDPSOperationTargetRole(passiveID, op)...)
	switch op.Kind {
	case dpsOpDamage, dpsOpTriggerDamageAtStacks:
		if !supportedDPSDamageType(op.DamageType) {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported damageType "+op.DamageType)
		}
		if !hasDamageFormula(op) {
			reasons = append(reasons, "passive effect "+passiveID+" damage operation requires formula fields")
		}
		if op.TargetCurrentHPBasis != "" && op.TargetCurrentHPBasis != "current" && op.TargetCurrentHPBasis != "attack_start" {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported targetCurrentHpBasis "+op.TargetCurrentHPBasis)
		}
		if op.TargetMissingHPBasis != "" && op.TargetMissingHPBasis != "current" && op.TargetMissingHPBasis != "attack_start" {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported targetMissingHpBasis "+op.TargetMissingHPBasis)
		}
		if op.Kind == dpsOpTriggerDamageAtStacks && (op.StackKey == "" || op.TriggerStacks <= 0) {
			reasons = append(reasons, "passive effect "+passiveID+" trigger_damage_at_stacks requires stackKey and triggerStacks")
		}
	case dpsOpApplyDot:
		if !supportedDPSDamageType(op.DamageType) {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported dot damageType "+op.DamageType)
		}
		if !hasDamageFormula(op) {
			reasons = append(reasons, "passive effect "+passiveID+" dot operation requires formula fields")
		}
		if op.TargetCurrentHPBasis != "" && op.TargetCurrentHPBasis != "current" && op.TargetCurrentHPBasis != "attack_start" {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported targetCurrentHpBasis "+op.TargetCurrentHPBasis)
		}
		if op.TargetMissingHPBasis != "" && op.TargetMissingHPBasis != "current" && op.TargetMissingHPBasis != "attack_start" {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported targetMissingHpBasis "+op.TargetMissingHPBasis)
		}
		if op.DurationMs <= 0 {
			reasons = append(reasons, "passive effect "+passiveID+" dot operation requires durationMs")
		}
		if op.TickIntervalMs != 0 && op.TickIntervalMs != 1000 {
			reasons = append(reasons, "passive effect "+passiveID+" dot operation tickIntervalMs override is unsupported")
		}
		if op.RefreshMode != "" && op.RefreshMode != "refresh" {
			reasons = append(reasons, "passive effect "+passiveID+" dot operation has unsupported refreshMode "+op.RefreshMode)
		}
	case dpsOpAddStack:
		if op.StackKey == "" || op.MaxStacks <= 0 {
			reasons = append(reasons, "passive effect "+passiveID+" add_stack requires stackKey and maxStacks")
		}
		if op.RefreshMode != "" && op.RefreshMode != "refresh" {
			reasons = append(reasons, "passive effect "+passiveID+" add_stack has unsupported refreshMode "+op.RefreshMode)
		}
	case dpsOpStatModifier:
		if op.AttrKey == "" {
			reasons = append(reasons, "passive effect "+passiveID+" stat_modifier requires attrKey")
		}
		if math.IsNaN(op.Value) || math.IsInf(op.Value, 0) {
			reasons = append(reasons, "passive effect "+passiveID+" stat_modifier has invalid value")
		}
	case dpsOpDamageModifier:
		valuePhase := strings.TrimSpace(op.ValuePhase)
		if valuePhase != "" && valuePhase != dpsValuePhaseIncoming {
			reasons = append(reasons, "passive effect "+passiveID+" damage_modifier only supports valuePhase incoming")
		}
		modifierMode := strings.TrimSpace(op.ModifierMode)
		if modifierMode != "" && modifierMode != "percent" {
			reasons = append(reasons, "passive effect "+passiveID+" damage_modifier only supports modifierMode percent")
		}
		if math.IsNaN(op.Value) || math.IsInf(op.Value, 0) {
			reasons = append(reasons, "passive effect "+passiveID+" damage_modifier has invalid value")
		}
	case dpsOpPhantomHitOnHitRepeat:
		if op.StackKey == "" {
			reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires stackKey")
		}
		if op.TriggerStacks <= 0 {
			reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires triggerStacks > 0")
		}
		if op.RepeatCount != 1 {
			reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires repeatCount=1")
		}
		if strings.TrimSpace(op.RepeatTag) == "" {
			reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires repeatTag")
		}
		if op.RepeatScope != dpsRepeatScopeCopyableOnHit {
			reasons = append(reasons, "passive effect "+passiveID+" phantom_hit_on_hit_repeat requires repeatScope="+dpsRepeatScopeCopyableOnHit)
		}
	default:
		reasons = append(reasons, "passive effect "+passiveID+" has unsupported operation "+op.Kind)
	}
	return reasons
}

func attackIntervalMs(effectiveAttackSpeed float64) int64 {
	if effectiveAttackSpeed <= 0 || math.IsNaN(effectiveAttackSpeed) || math.IsInf(effectiveAttackSpeed, 0) {
		return 0
	}
	interval := int64(math.Round(1000 / effectiveAttackSpeed))
	if interval < 1 {
		return 1
	}
	return interval
}

func enabledDPSPassives(curve model.DPSCurveRunSpecV2) []model.DPSPassiveEffectV2 {
	enabled := enabledPassiveIDSet(curve)
	passives := make([]model.DPSPassiveEffectV2, 0, len(enabled))
	for _, passive := range curve.ResolvedSnapshot.PassiveEffects {
		if passiveIsEnabled(passive, enabled) {
			passives = append(passives, passive)
		}
	}
	return passives
}

func enabledPassiveIDSet(curve model.DPSCurveRunSpecV2) map[string]bool {
	result := map[string]bool{}
	for _, id := range curve.Selection.EnabledPassiveEffects {
		id = strings.TrimSpace(id)
		if id != "" {
			result[id] = true
		}
	}
	for _, id := range curve.ResolvedSnapshot.EnabledPassiveEffects {
		id = strings.TrimSpace(id)
		if id != "" {
			result[id] = true
		}
	}
	return result
}

func passiveIsEnabled(passive model.DPSPassiveEffectV2, enabled map[string]bool) bool {
	for _, id := range passiveIDs(passive) {
		if enabled[id] {
			return true
		}
	}
	return false
}

func findPassiveByID(passives []model.DPSPassiveEffectV2, id string) *model.DPSPassiveEffectV2 {
	for i := range passives {
		for _, candidate := range passiveIDs(passives[i]) {
			if candidate == id {
				return &passives[i]
			}
		}
	}
	return nil
}

func passiveIDs(passive model.DPSPassiveEffectV2) []string {
	ids := make([]string, 0, 3)
	for _, id := range []string{passive.PassiveID, passive.EffectID, passive.SourceID} {
		id = strings.TrimSpace(id)
		if id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func passiveID(passive model.DPSPassiveEffectV2) string {
	for _, id := range passiveIDs(passive) {
		return id
	}
	return ""
}

func passiveRuntimeKey(passive model.DPSPassiveEffectV2) string {
	return nonEmpty(passive.TriggerID, passiveID(passive))
}

func passiveEffectRuntimeKey(passive model.DPSPassiveEffectV2) string {
	passiveKey := nonEmpty(passive.PassiveID, nonEmpty(passive.SourceID, passiveID(passive)))
	effectKey := nonEmpty(passive.EffectID, passive.TriggerID)
	if effectKey == "" || effectKey == passiveKey {
		return passiveKey
	}
	return passiveKey + "/" + effectKey
}

func stackRuntimeKey(passive model.DPSPassiveEffectV2, stackKey string) string {
	return passiveEffectRuntimeKey(passive) + "#" + stackKey
}

func passiveDamageSource(passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) string {
	return nonEmpty(op.Source, nonEmpty(passive.SourceID, passiveID(passive)))
}

func passiveHasPerStackStatModifier(passive model.DPSPassiveEffectV2) bool {
	for _, op := range passive.Operations {
		if op.Kind == dpsOpStatModifier && op.PerStack {
			return true
		}
	}
	return false
}

func validateDPSEnergizedPassive(id string, passive model.DPSPassiveEffectV2) []string {
	reasons := make([]string, 0)
	if strings.TrimSpace(passive.ChargeKey) == "" {
		reasons = append(reasons, "passive effect "+id+" energized_charge_and_consume requires chargeKey")
	}
	if passive.ChargeGainPerBasicAttack <= 0 {
		reasons = append(reasons, "passive effect "+id+" energized_charge_and_consume requires chargeGainPerBasicAttack > 0")
	}
	if passive.ChargeThreshold <= 0 {
		reasons = append(reasons, "passive effect "+id+" energized_charge_and_consume requires chargeThreshold > 0")
	}
	if passive.ChargeCap > 0 && passive.ChargeCap < passive.ChargeThreshold {
		reasons = append(reasons, "passive effect "+id+" energized_charge_and_consume requires chargeCap >= chargeThreshold")
	}
	if !passive.ConsumeChargeOnTrigger {
		reasons = append(reasons, "passive effect "+id+" energized_charge_and_consume requires consumeChargeOnTrigger=true")
	}
	policy := passive.ChargeReadyPolicy
	if policy == "" {
		policy = dpsChargeReadyPolicyNextBasicAttackAfterThreshold
	}
	if policy != dpsChargeReadyPolicyNextBasicAttackAfterThreshold {
		reasons = append(reasons, "passive effect "+id+" energized_charge_and_consume has unsupported chargeReadyPolicy "+passive.ChargeReadyPolicy)
	}
	scope := passive.ProcScope
	if scope == "" {
		scope = dpsProcScopeRealBasicAttackOnly
	}
	if scope != dpsProcScopeRealBasicAttackOnly {
		reasons = append(reasons, "passive effect "+id+" energized_charge_and_consume has unsupported procScope "+passive.ProcScope)
	}
	return reasons
}

func supportedDPSTrigger(triggerKind string) bool {
	switch triggerKind {
	case "", dpsTriggerOnBasicAttackHit, dpsTriggerEveryNBasicAttack, dpsTriggerStackOnHit, dpsTriggerStatAlwaysOn, dpsTriggerPreEnabledModifier, dpsTriggerNextBasicAttackAfterState, dpsTriggerEnergizedChargeAndConsume:
		return true
	default:
		return false
	}
}

func validateDPSOperationTargetRole(passiveID string, op model.DPSPassiveOperationV2) []string {
	reasons := make([]string, 0)
	role := strings.TrimSpace(op.TargetRole)
	if role == "" {
		return reasons
	}
	switch op.Kind {
	case dpsOpDamage, dpsOpStatModifier:
		if role != dpsRoleAttacker && role != dpsRoleTarget {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported operation targetRole "+op.TargetRole)
		}
	case dpsOpDamageModifier:
		if role == dpsRoleAttacker {
			reasons = append(reasons, "passive effect "+passiveID+" operation damage_modifier does not support targetRole attacker")
		} else if role != "" && role != dpsRoleTarget {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported operation targetRole "+op.TargetRole)
		}
	case dpsOpApplyDot, dpsOpTriggerDamageAtStacks:
		if role == dpsRoleAttacker {
			reasons = append(reasons, "passive effect "+passiveID+" operation "+op.Kind+" does not support targetRole attacker")
		} else if role != dpsRoleTarget {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported operation targetRole "+op.TargetRole)
		}
	case dpsOpAddStack, dpsOpPhantomHitOnHitRepeat:
		reasons = append(reasons, "passive effect "+passiveID+" operation "+op.Kind+" does not support targetRole")
	default:
		reasons = append(reasons, "passive effect "+passiveID+" has unsupported operation targetRole "+op.TargetRole)
	}
	return reasons
}

func validateDPSLinkedPassiveTrigger(id string, passive model.DPSPassiveEffectV2) []string {
	reasons := make([]string, 0)
	ownerRole := resolvedDPSOwnerRole(passive)
	if ownerRole != dpsRoleAttacker && ownerRole != dpsRoleTarget {
		reasons = append(reasons, "passive effect "+id+" has unsupported ownerRole "+passive.OwnerRole)
	}
	if event := strings.TrimSpace(passive.Trigger.Event); event != "" && !supportedDPSLinkedTriggerEvent(event) {
		reasons = append(reasons, "passive effect "+id+" has unsupported trigger.event "+event)
	}
	return reasons
}

func supportedDPSLinkedTriggerEvent(event string) bool {
	switch event {
	case dpsEventOnBasicAttackHit, dpsEventOnSpellHit, dpsEventOnHit, dpsEventOnDamageDealt, dpsEventOnDamageTaken, dpsTriggerStatAlwaysOn, dpsTriggerPreEnabledModifier, dpsEventDotTick:
		return true
	default:
		return false
	}
}

func supportedDPSDamageType(damageType string) bool {
	return damageType == "physical" || damageType == "magic" || damageType == "true"
}

func hasDamageFormula(op model.DPSPassiveOperationV2) bool {
	return op.Amount != 0 || op.AmountPerStack != 0 || op.TargetCurrentHPRatio != 0 || op.TargetMaxHPRatio != 0 || op.TargetMissingHPRatio != 0 || op.TargetMissingHPAmp != 0 || op.AttackerAttrRatio != 0 || op.HasMinAmount
}

func stackBreakdownMessage(stackKey string, before int, after int, maxStacks int, expireAt int64) string {
	message := "stackKey=" + stackKey + " before=" + intToString(before) + " after=" + intToString(after) + " maxStacks=" + intToString(maxStacks)
	if expireAt > 0 {
		message += " expireAtMs=" + int64ToString(expireAt)
	}
	return message
}

func statModifierBreakdownMessage(op model.DPSPassiveOperationV2, stacks int, targetRole string) string {
	mode := op.ModifierMode
	if mode == "" {
		mode = "flat"
	}
	message := "attrKey=" + op.AttrKey + " modifierMode=" + mode + " value=" + floatToString(op.Value)
	if targetRole != "" && targetRole != dpsRoleAttacker {
		message += " targetRole=" + targetRole
	}
	if op.PerStack {
		message += " perStack=true stackKey=" + op.StackKey + " stacks=" + intToString(stacks)
	}
	return message
}

func intToString(value int) string {
	return strconv.Itoa(value)
}

func int64ToString(value int64) string {
	return strconv.FormatInt(value, 10)
}

func floatToString(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func hasScenarioState(states []model.DPSScenarioStateV2, stateID string) bool {
	for _, state := range states {
		if state.StateID == stateID {
			return true
		}
	}
	return false
}

func dotInterval(_ model.DPSPassiveOperationV2, rules model.DPSimulationRulesV2) int64 {
	return rules.DotTickIntervalMs
}

func copyDPSFloatMap(input map[string]float64) map[string]float64 {
	output := make(map[string]float64, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func copyDPSAttributeViews(input map[string]model.AttributeSnapshotV2) map[string]model.AttributeSnapshotV2 {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]model.AttributeSnapshotV2, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func normalizeStringSet(values []string) map[string]bool {
	output := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			output[value] = true
		}
	}
	return output
}

func sameStringSet(left map[string]bool, right map[string]bool) bool {
	if len(left) != len(right) {
		return false
	}
	for value := range left {
		if !right[value] {
			return false
		}
	}
	return true
}

func readFirstPositiveAttr(attrs map[string]float64, keys ...string) float64 {
	for _, key := range keys {
		value, ok := attrs[key]
		if ok && value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return value
		}
	}
	return 0
}

func readFirstFiniteAttr(attrs map[string]float64, keys ...string) float64 {
	for _, key := range keys {
		value, ok := attrs[key]
		if ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return value
		}
	}
	return 0
}

func hasAnyFiniteAttr(attrs map[string]float64, keys ...string) bool {
	for _, key := range keys {
		value, ok := attrs[key]
		if ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return true
		}
	}
	return false
}

func hasType(types []string, expected string) bool {
	for _, value := range types {
		if value == expected {
			return true
		}
	}
	return false
}

func clampFloat(value float64, min float64, max float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return min
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func nonEmpty(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

var dpsAttrAliases = map[string]string{
	"ad":           "attack_damage",
	"attackDamage": "attack_damage",
}

func applyDPSAttributesToStore(store *attribute.Store, attrIndex map[string]uint16, values map[string]float64) {
	if store == nil || len(values) == 0 {
		return
	}
	for key, value := range values {
		attrID := strings.TrimSpace(key)
		if alias, ok := dpsAttrAliases[attrID]; ok {
			attrID = alias
		}
		index, ok := attrIndex[attrID]
		if !ok || int(index) >= len(store.Slots) {
			continue
		}
		store.Slots[index].SetBase(value)
	}
	store.ResolveAll(0)
}

func attackerOwnsCompiledAction(bundle compilebundle.CompiledBundle, attackerTemplateID string, actionIndex uint16) bool {
	templateIndex, ok := bundle.ActorIndex[attackerTemplateID]
	if !ok || int(templateIndex) >= len(bundle.Actors) {
		return false
	}
	for _, owned := range bundle.Actors[templateIndex].Actions {
		if owned == actionIndex {
			return true
		}
	}
	return false
}

func compiledActionHasBasicAttackClassifier(bundle compilebundle.CompiledBundle, actionIndex uint16) bool {
	if int(actionIndex) >= len(bundle.Actions) {
		return false
	}
	typeID, ok := bundle.Types.Lookup("action/basic_attack")
	if !ok {
		return false
	}
	return bundle.Actions[actionIndex].TypeSet.Contains(typeID)
}
