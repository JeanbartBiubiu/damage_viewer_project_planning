package runtime

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/attribute"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const (
	dpsStatusOK      = "ok"
	dpsStatusBlocked = "blocked"

	dpsTriggerOnBasicAttackHit   = "on_basic_attack_hit"
	dpsTriggerEveryNBasicAttack  = "every_n_basic_attack_hit"
	dpsTriggerStackOnHit         = "stack_on_hit"
	dpsTriggerStatAlwaysOn       = "stat_modifier_always_on"
	dpsTriggerPreEnabledModifier = "pre_enabled_state_modifier"

	dpsOpDamage                = "damage"
	dpsOpApplyDot              = "apply_dot"
	dpsOpAddStack              = "add_stack"
	dpsOpTriggerDamageAtStacks = "trigger_damage_at_stacks"
	dpsOpStatModifier          = "stat_modifier"
)

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
	bundle               compilebundle.CompiledBundle
	runCtx               *RunContext
	attackerIdx          uint8
	targetIdx            uint8
	rules                model.DPSimulationRulesV2
	curve                model.DPSCurveRunSpecV2
	result               *model.DPSCurveResultV2
	attacker             model.DPSActorSnapshotV2
	target               model.DPSActorSnapshotV2
	attackerTemplateID   string
	baseAttrs            map[string]float64
	attrs                map[string]float64
	targetHP             float64
	targetMaxHP          float64
	attackStartTargetHP  float64
	armor                float64
	magicResist          float64
	schedules            []dpsBasicAttackSchedule
	passives             []model.DPSPassiveEffectV2
	stacks               map[string]int
	stackExpiry          map[string]int64
	hitCounts            map[string]int
	statModifierTriggers map[string]bool
	dots                 []activeDPSDot
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
		bundle:               bundle,
		runCtx:               runCtx,
		attackerIdx:          attackerIdx,
		targetIdx:            targetIdx,
		rules:                rules,
		curve:                curve,
		result:               result,
		attacker:             attacker,
		target:               target,
		attackerTemplateID:   attackerTemplateID,
		baseAttrs:            copyDPSFloatMap(attacker.Attributes),
		attrs:                copyDPSFloatMap(attacker.Attributes),
		targetHP:             targetHP,
		targetMaxHP:          targetMaxHP,
		armor:                readFirstFiniteAttr(target.Attributes, "armor", "armour"),
		magicResist:          readFirstFiniteAttr(target.Attributes, "magic_resist", "mr", "spellblock", "spell_block"),
		schedules:            make([]dpsBasicAttackSchedule, 0),
		passives:             enabledDPSPassives(curve),
		stacks:               map[string]int{},
		stackExpiry:          map[string]int64{},
		hitCounts:            map[string]int{},
		statModifierTriggers: map[string]bool{},
		dots:                 make([]activeDPSDot, 0),
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
	for attrKey, value := range snapshot.EquipmentStats {
		attrKey = strings.TrimSpace(attrKey)
		if attrKey == "" {
			continue
		}
		attrs[attrKey] += value
	}
	snapshot.AttackerSnapshot.Attributes = attrs
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
	for _, effect := range castResult.Effects {
		if effect.Kind != string(model.EffectTypeDealDamage) || !effect.HasRawAmount {
			continue
		}
		actionDamageProcessed = true
		damageType := effect.DamageType
		if damageType == "" {
			damageType = "physical"
		}
		state.applyDamage(timeMs, damageSource, damageType, effect.RawAmount)
	}
	state.syncRunContextHPFromDPS()
	if actionDamageProcessed {
		state.processAttackPassives(timeMs)
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

func (state *dpsCurveState) processAttackPassives(timeMs int64) {
	refreshStackStatModifiers := false
	for _, passive := range state.passives {
		if !state.passiveActiveAt(passive, timeMs) {
			continue
		}
		triggerKind := passive.TriggerKind
		if triggerKind == "" {
			triggerKind = dpsTriggerOnBasicAttackHit
		}
		if triggerKind == dpsTriggerStatAlwaysOn || triggerKind == dpsTriggerPreEnabledModifier {
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
		state.recordPassiveTrigger(timeMs, passive)
		for _, op := range passive.Operations {
			if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
				return
			}
			state.applyPassiveOperation(timeMs, passive, op)
		}
		if passiveHasPerStackStatModifier(passive) {
			refreshStackStatModifiers = true
		}
	}
	if refreshStackStatModifiers && state.result.Status != dpsStatusBlocked && state.targetHP > 0 {
		state.refreshActiveStatModifiers(timeMs)
	}
}

func (state *dpsCurveState) applyPassiveOperation(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	switch op.Kind {
	case dpsOpDamage:
		stacks := 0
		if op.StackKey != "" {
			stacks = state.stacks[stackRuntimeKey(passive, op.StackKey)]
		}
		amount, ok := state.resolveOperationAmount(op, stacks)
		if !ok {
			return
		}
		if state.applyDamage(timeMs, passiveDamageSource(passive, op), op.DamageType, amount) {
			state.recordPassiveDamageBreakdown(timeMs, passive, op, amount, dpsOpDamage)
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

func (state *dpsCurveState) refreshActiveStatModifiers(timeMs int64) {
	state.attrs = copyDPSFloatMap(state.baseAttrs)
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
}

func (state *dpsCurveState) applyStatModifier(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2, record bool) {
	if op.AttrKey == "" {
		state.block("passive stat_modifier operation requires attrKey")
		return
	}
	current, ok := state.attrs[op.AttrKey]
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
		state.attrs[op.AttrKey] = current + value
	case "percent":
		state.attrs[op.AttrKey] = current * (1 + value)
	case "override", "override_base", "override_current", "override_max":
		state.attrs[op.AttrKey] = value
	default:
		state.block("unsupported passive stat modifier mode " + op.ModifierMode)
		return
	}
	if !record {
		return
	}
	state.result.EffectTimeline = append(state.result.EffectTimeline, model.DPSEffectEventV2{
		TimeMs: timeMs, SourceID: nonEmpty(passive.SourceID, passiveID(passive)), Kind: dpsOpStatModifier,
	})
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    dpsOpStatModifier,
		Amount:  state.attrs[op.AttrKey],
		Message: statModifierBreakdownMessage(op, stacks),
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
	amount, ok := state.resolveOperationAmount(op, state.stacks[key])
	if !ok {
		return
	}
	if !state.applyDamage(timeMs, passiveDamageSource(passive, op), op.DamageType, amount) {
		return
	}
	state.recordPassiveDamageBreakdown(timeMs, passive, op, amount, dpsOpTriggerDamageAtStacks)
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
		amount, ok := state.resolveOperationAmount(dot.Operation, dot.Stacks)
		if !ok {
			return
		}
		source := dot.Operation.Source
		if source == "" {
			source = dot.SourceID
		}
		if state.applyDamage(timeMs, source, dot.Operation.DamageType, amount) {
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
) {
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    kind,
		Amount:  amount,
		Message: op.DamageType,
	})
}

func (state *dpsCurveState) resolveOperationAmount(op model.DPSPassiveOperationV2, stacks int) (float64, bool) {
	amount := op.Amount
	if op.TargetCurrentHPRatio != 0 {
		hpForCurrent := state.targetHP
		switch op.TargetCurrentHPBasis {
		case "", "current":
		case "attack_start":
			hpForCurrent = state.attackStartTargetHP
		default:
			state.block("unsupported target current hp basis " + op.TargetCurrentHPBasis)
			return 0, false
		}
		if hpForCurrent < 0 {
			hpForCurrent = 0
		}
		amount += hpForCurrent * op.TargetCurrentHPRatio
	}
	if op.TargetMaxHPRatio != 0 {
		if state.targetMaxHP <= 0 {
			state.block("passive damage formula requires target max hp")
			return 0, false
		}
		amount += state.targetMaxHP * op.TargetMaxHPRatio
	}
	if op.TargetMissingHPRatio != 0 {
		if state.targetMaxHP <= 0 {
			state.block("passive damage formula requires target max hp")
			return 0, false
		}
		hpForMissing := state.targetHP
		switch op.TargetMissingHPBasis {
		case "", "current":
		case "attack_start":
			hpForMissing = state.attackStartTargetHP
		default:
			state.block("unsupported target missing hp basis " + op.TargetMissingHPBasis)
			return 0, false
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
			return 0, false
		}
		hpForMissing := state.targetHP
		switch op.TargetMissingHPBasis {
		case "", "current":
		case "attack_start":
			hpForMissing = state.attackStartTargetHP
		default:
			state.block("unsupported target missing hp basis " + op.TargetMissingHPBasis)
			return 0, false
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
	if op.AttackerAttrRatio != 0 {
		if op.AttackerAttr == "" {
			state.block("passive damage formula requires attackerAttr")
			return 0, false
		}
		attrValue, ok := state.attrs[op.AttackerAttr]
		if !ok || math.IsNaN(attrValue) || math.IsInf(attrValue, 0) {
			state.block("passive damage formula requires attacker attr " + op.AttackerAttr)
			return 0, false
		}
		amount += attrValue * op.AttackerAttrRatio
	}
	if op.AmountPerStack != 0 {
		amount += float64(stacks) * op.AmountPerStack
	}
	if op.HasMinAmount && amount < op.MinAmount {
		amount = op.MinAmount
	}
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		state.block("passive damage formula resolved invalid amount")
		return 0, false
	}
	return amount, true
}

func (state *dpsCurveState) applyDamage(timeMs int64, source string, damageType string, rawAmount float64) bool {
	resistance := 0.0
	switch damageType {
	case "physical":
		resistance = state.armor
	case "magic":
		resistance = state.magicResist
	case "true":
	default:
		state.block("unsupported damage type " + damageType)
		return false
	}
	resistance = state.effectiveResistance(damageType, resistance)
	mitigatedDamage, code := mitigateDamageByResistance(rawAmount, resistance, damageType)
	if code != model.ErrOK {
		state.block("damage could not be resolved")
		return false
	}
	hpBefore := state.targetHP
	hpAfter, finalDamage, code := applyDamageToHP(state.targetHP, mitigatedDamage)
	if code != model.ErrOK {
		state.block("damage could not be applied")
		return false
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
	trigger := model.DPSPassiveTriggerV2{
		TimeMs:             timeMs,
		ProcSourceCategory: passive.SourceCategory,
		SourceID:           nonEmpty(passive.SourceID, passiveID(passive)),
		SourceType:         passive.SourceType,
		TriggerID:          passive.TriggerID,
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
	for _, scenario := range state.curve.ResolvedSnapshot.ScenarioStates {
		if scenario.StateID != passive.RequiresScenarioStateID {
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
	if passive.TriggerKind == dpsTriggerEveryNBasicAttack && passive.EveryN <= 0 {
		reasons = append(reasons, "passive effect "+id+" requires everyN")
	}
	if passive.RequiresScenarioStateID != "" && !hasScenarioState(curve.ResolvedSnapshot.ScenarioStates, passive.RequiresScenarioStateID) {
		reasons = append(reasons, "passive effect "+id+" requires missing scenarioState "+passive.RequiresScenarioStateID)
	}
	if len(passive.Operations) == 0 {
		reasons = append(reasons, "passive effect "+id+" requires operations")
	}
	addStackKeys := map[string]bool{}
	for _, op := range passive.Operations {
		if op.Kind == dpsOpAddStack && op.StackKey != "" {
			addStackKeys[op.StackKey] = true
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
	}
	return reasons
}

func validateDPSPassiveOperation(passiveID string, op model.DPSPassiveOperationV2) []string {
	reasons := make([]string, 0)
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

func supportedDPSTrigger(triggerKind string) bool {
	switch triggerKind {
	case "", dpsTriggerOnBasicAttackHit, dpsTriggerEveryNBasicAttack, dpsTriggerStackOnHit, dpsTriggerStatAlwaysOn, dpsTriggerPreEnabledModifier:
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

func statModifierBreakdownMessage(op model.DPSPassiveOperationV2, stacks int) string {
	mode := op.ModifierMode
	if mode == "" {
		mode = "flat"
	}
	message := "attrKey=" + op.AttrKey + " modifierMode=" + mode + " value=" + floatToString(op.Value)
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
