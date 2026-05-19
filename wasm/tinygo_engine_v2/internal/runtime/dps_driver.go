package runtime

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/model"
)

const (
	singleAttackerDPSMode = "single_attacker_dps"
	dpsStatusOK           = "ok"
	dpsStatusBlocked      = "blocked"

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
	rules                model.DPSimulationRulesV2
	curve                model.DPSCurveRunSpecV2
	result               *model.DPSCurveResultV2
	attacker             model.DPSActorSnapshotV2
	target               model.DPSActorSnapshotV2
	baseAttrs            map[string]float64
	attrs                map[string]float64
	targetHP             float64
	targetMaxHP          float64
	attackStartTargetHP  float64
	armor                float64
	magicResist          float64
	passives             []model.DPSPassiveEffectV2
	stacks               map[string]int
	stackExpiry          map[string]int64
	hitCounts            map[string]int
	statModifierTriggers map[string]bool
	dots                 []activeDPSDot
}

func RunSingleAttackerDPS(input model.SingleAttackerDPSInputV2) model.SingleAttackerDPSOutputV2 {
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
		output.CurveResults = append(output.CurveResults, runSingleAttackerDPSCurve(rules, curve))
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
	if rules.AutoAttackPlan.ActionID == "" {
		rules.AutoAttackPlan.ActionID = "basic_attack"
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

	blockedReasons := validateDPSCurve(rules, curve, attacker, target)
	blockedReasons = append(equipmentReasons, blockedReasons...)
	if len(blockedReasons) > 0 {
		result.Status = dpsStatusBlocked
		result.StopReason = "blocked"
		result.BlockedReasons = blockedReasons
		return result
	}

	state := newDPSCurveState(rules, curve, &result, attacker, target)
	state.applyInitialStatModifiers()
	if result.Status == dpsStatusBlocked {
		return result
	}
	state.TargetHPTimelineAppend(0)

	nextAttackAtMs := rules.AutoAttackPlan.StartAtMs
	if nextAttackAtMs < 0 {
		nextAttackAtMs = 0
	}
	result.FinalTimeMs = rules.DurationMs

	for {
		nextDotAtMs, hasDot := state.nextDotTick()
		hasAttack := nextAttackAtMs >= 0 && nextAttackAtMs < rules.DurationMs
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

		nextAttackAtMs = state.processAttack(nextAttackAtMs)
		if state.shouldStopAfterEvent(result.FinalTimeMs) {
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
	return &dpsCurveState{
		rules:                rules,
		curve:                curve,
		result:               result,
		attacker:             attacker,
		target:               target,
		baseAttrs:            copyDPSFloatMap(attacker.Attributes),
		attrs:                copyDPSFloatMap(attacker.Attributes),
		targetHP:             targetHP,
		targetMaxHP:          targetMaxHP,
		armor:                readFirstFiniteAttr(target.Attributes, "armor", "armour"),
		magicResist:          readFirstFiniteAttr(target.Attributes, "magic_resist", "mr", "spellblock", "spell_block"),
		passives:             enabledDPSPassives(curve),
		stacks:               map[string]int{},
		stackExpiry:          map[string]int64{},
		hitCounts:            map[string]int{},
		statModifierTriggers: map[string]bool{},
		dots:                 make([]activeDPSDot, 0),
	}
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

func (state *dpsCurveState) processAttack(timeMs int64) int64 {
	state.expireStacks(timeMs)
	state.refreshActiveStatModifiers(timeMs)
	if state.result.Status == dpsStatusBlocked {
		return -1
	}
	state.attackStartTargetHP = state.targetHP
	state.result.ProcessedEvents++
	state.updateQueuePeak()
	state.result.AttackCount++
	state.result.AttackTimeline = append(state.result.AttackTimeline, model.DPSAttackEventV2{
		TimeMs:        timeMs,
		ActionID:      state.rules.AutoAttackPlan.ActionID,
		SourceActorID: nonEmpty(state.attacker.ActorID, "self"),
		TargetActorID: nonEmpty(state.target.ActorID, "target"),
	})

	attackDamage := state.resolveBasicAttackRawDamage(readFirstFiniteAttr(state.attrs, "ad", "attack_damage", "attackDamage"))
	if !state.applyDamage(timeMs, state.rules.AutoAttackPlan.ActionID, "physical", attackDamage) {
		return -1
	}
	if state.targetHP <= 0 {
		return -1
	}

	state.processAttackPassives(timeMs)
	if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
		return -1
	}
	if state.result.ProcessedEvents >= state.rules.MaxEvents {
		state.result.FinalTimeMs = timeMs
		state.result.StopReason = "event_limit"
		return -1
	}

	rawAttackSpeed := readFirstPositiveAttr(state.attrs, "attack_speed", "attackSpeed", "as", "attacks_per_second")
	effectiveAttackSpeed := math.Min(rawAttackSpeed, state.rules.AttackSpeedCap)
	overflowAttackSpeed := math.Max(0, rawAttackSpeed-state.rules.AttackSpeedCap)
	intervalMs := attackIntervalMs(effectiveAttackSpeed)
	if intervalMs <= 0 {
		state.block("effective attack speed is required")
		return -1
	}
	nextAttackAtMs := timeMs + intervalMs
	state.result.AttackIntervalTimeline = append(state.result.AttackIntervalTimeline, model.DPSAttackIntervalV2{
		TimeMs:               timeMs,
		RawAttackSpeed:       rawAttackSpeed,
		EffectiveAttackSpeed: effectiveAttackSpeed,
		OverflowAttackSpeed:  overflowAttackSpeed,
		AttackIntervalMs:     intervalMs,
		NextAttackAtMs:       nextAttackAtMs,
		Source:               "attacker.attributes.attack_speed",
	})
	return nextAttackAtMs
}

func (state *dpsCurveState) processAttackPassives(timeMs int64) {
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
	}
}

func (state *dpsCurveState) applyPassiveOperation(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	switch op.Kind {
	case dpsOpDamage:
		stacks := 0
		if op.StackKey != "" {
			stacks = state.stacks[op.StackKey]
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
		state.applyStatModifier(timeMs, passive, op, true)
	}
}

func (state *dpsCurveState) applyInitialStatModifiers() {
	state.refreshActiveStatModifiers(0)
}

func (state *dpsCurveState) refreshActiveStatModifiers(timeMs int64) {
	state.attrs = copyDPSFloatMap(state.baseAttrs)
	for _, passive := range state.passives {
		if passive.TriggerKind != dpsTriggerStatAlwaysOn && passive.TriggerKind != dpsTriggerPreEnabledModifier {
			continue
		}
		if !state.passiveActiveAt(passive, timeMs) {
			continue
		}
		triggerKey := "stat_modifier:" + passiveRuntimeKey(passive)
		record := !state.statModifierTriggers[triggerKey]
		if record {
			state.recordPassiveTrigger(timeMs, passive)
			state.statModifierTriggers[triggerKey] = true
		}
		for _, op := range passive.Operations {
			if op.Kind == dpsOpStatModifier {
				state.applyStatModifier(timeMs, passive, op, record)
			}
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
	switch op.ModifierMode {
	case "", "flat":
		state.attrs[op.AttrKey] = current + op.Value
	case "percent":
		state.attrs[op.AttrKey] = current * (1 + op.Value)
	case "override", "override_base", "override_current", "override_max":
		state.attrs[op.AttrKey] = op.Value
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
		Message: op.AttrKey + "=" + op.ModifierMode,
	})
}

func (state *dpsCurveState) addStack(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	if op.StackKey == "" {
		state.block("passive add_stack operation requires stackKey")
		return
	}
	current := state.stacks[op.StackKey] + 1
	if op.MaxStacks > 0 && current > op.MaxStacks {
		current = op.MaxStacks
	}
	state.stacks[op.StackKey] = current
	if op.DurationMs > 0 {
		state.stackExpiry[op.StackKey] = timeMs + op.DurationMs
	}
	state.result.EffectTimeline = append(state.result.EffectTimeline, model.DPSEffectEventV2{
		TimeMs: timeMs, SourceID: nonEmpty(passive.SourceID, passiveID(passive)), Kind: dpsOpAddStack,
	})
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    dpsOpAddStack,
		Amount:  float64(current),
		Message: op.StackKey,
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
	if triggerStacks <= 0 || state.stacks[op.StackKey] < triggerStacks {
		return
	}
	amount, ok := state.resolveOperationAmount(op, state.stacks[op.StackKey])
	if !ok {
		return
	}
	if !state.applyDamage(timeMs, passiveDamageSource(passive, op), op.DamageType, amount) {
		return
	}
	state.recordPassiveDamageBreakdown(timeMs, passive, op, amount, dpsOpTriggerDamageAtStacks)
	if op.ResetStacks {
		delete(state.stacks, op.StackKey)
		delete(state.stackExpiry, op.StackKey)
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
		stacks = state.stacks[op.StackKey]
	}
	key := nonEmpty(op.Source, passiveRuntimeKey(passive)) + ":" + op.StackKey
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

func (state *dpsCurveState) resolveBasicAttackRawDamage(baseDamage float64) float64 {
	critChance := clampFloat(readFirstFiniteAttr(state.attrs, "crit_chance", "critChance"), 0, 1)
	critDamage := readFirstPositiveAttr(state.attrs, "crit_damage", "critDamage")
	if critChance <= 0 || critDamage <= 1 {
		return baseDamage
	}
	return baseDamage * (1 + critChance*(critDamage-1))
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
	if rules.AutoAttackPlan.ActionID != "basic_attack" {
		reasons = append(reasons, "single_attacker_dps only supports autoAttackPlan.actionId=basic_attack")
	}
	if rules.AutoAttackPlan.TargetRole != "target" {
		reasons = append(reasons, "single_attacker_dps only supports autoAttackPlan.targetRole=target")
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
	if !hasAnyFiniteAttr(attacker.Attributes, "ad", "attack_damage", "attackDamage") {
		reasons = append(reasons, "attacker attack damage is required")
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
	for _, op := range passive.Operations {
		reasons = append(reasons, validateDPSPassiveOperation(id, op)...)
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

func passiveDamageSource(passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) string {
	return nonEmpty(op.Source, nonEmpty(passive.SourceID, passiveID(passive)))
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
