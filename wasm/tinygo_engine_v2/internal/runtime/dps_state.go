// DPS 曲线状态、RunContext 同步与生命周期阻断。
package runtime

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"tinygo_engine_v2/internal/abi"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

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
	state := &dpsCurveState{
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
		schedules:              make([]dpsActiveActionSchedule, 0),
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
	state.boundDPSAttrMap(state.baseAttrs)
	state.boundDPSAttrMap(state.attrs)
	state.boundDPSAttrMap(state.targetBaseAttrs)
	state.boundDPSAttrMap(state.targetAttrs)
	state.armor = readFirstFiniteAttr(state.targetAttrs, "armor", "armour")
	state.magicResist = readFirstFiniteAttr(state.targetAttrs, "magic_resist", "mr", "spellblock", "spell_block")
	return state
}

func (state *dpsCurveState) dpsBoundAttrDefinition(attrKey string) (compilebundle.CompiledAttribute, bool) {
	for _, key := range dpsModifierAttrLookupKeys(attrKey) {
		index, ok := state.bundle.AttrIndex[key]
		if !ok || int(index) >= len(state.bundle.Attrs) {
			continue
		}
		return state.bundle.Attrs[index], true
	}
	return compilebundle.CompiledAttribute{}, false
}

func (state *dpsCurveState) boundDPSAttrValue(attrKey string, value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return value
	}
	def, ok := state.dpsBoundAttrDefinition(attrKey)
	if !ok {
		return value
	}
	if def.HasClampMin && value < def.ClampMin {
		value = def.ClampMin
	}
	if def.HasClampMax && value > def.ClampMax {
		value = def.ClampMax
	}
	return value
}

func (state *dpsCurveState) boundDPSAttrMap(values map[string]float64) {
	if len(values) == 0 {
		return
	}
	for key, value := range values {
		if bounded := state.boundDPSAttrValue(key, value); bounded != value {
			values[key] = bounded
		}
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

func (state *dpsCurveState) expireStacks(timeMs int64) {
	for key, expireAt := range state.stackExpiry {
		if expireAt > 0 && expireAt <= timeMs {
			delete(state.stackExpiry, key)
			delete(state.stacks, key)
		}
	}
}
