// Scheduled active action 命令执行序列（普攻与技能）。
package runtime

import (
	"math"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

func (state *dpsCurveState) processActiveAction(schedIdx int, timeMs int64) {
	if state.runCtx == nil || schedIdx < 0 || schedIdx >= len(state.schedules) {
		return
	}
	sched := &state.schedules[schedIdx]
	switch sched.kind {
	case dpsActiveActionKindBasicAttack:
		state.processBasicAttackAction(sched, timeMs)
	case dpsActiveActionKindSkill:
		state.processSkillAction(sched, timeMs)
	default:
		state.block("unsupported_active_action_kind:" + sched.kind)
		sched.nextAtMs = -1
	}
}

func (state *dpsCurveState) processBasicAttackAction(sched *dpsActiveActionSchedule, timeMs int64) {
	actionID := sched.ref.ActionID

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
		ctx, _, ok := state.processActiveActionDamageEffect(timeMs, sched, compiledAction, castResult, effectIndex, effect, targetHPBefore, true)
		if !ok {
			sched.nextAtMs = -1
			return
		}
		actionDamageProcessed = true
		combatCtx = ctx
		hasCombatCtx = true
	}
	state.syncRunContextHPFromDPS()
	if actionDamageProcessed && hasCombatCtx {
		state.processAttackPassives(combatCtx)
	}

	if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
		sched.nextAtMs = -1
		return
	}

	state.scheduleNextActiveActionCast(sched, timeMs, actionID, true)
}

func (state *dpsCurveState) processSkillAction(sched *dpsActiveActionSchedule, timeMs int64) {
	actionID := sched.ref.ActionID

	state.expireStacks(timeMs)
	state.refreshActiveStatModifiers(timeMs)
	if state.result.Status == dpsStatusBlocked {
		sched.nextAtMs = -1
		return
	}
	state.result.ProcessedEvents++
	state.updateQueuePeak()

	state.syncRunContextFromDPSState(timeMs)
	targetHPBefore := state.targetHP
	castResult := state.runCtx.PerformCastAt(timeMs, state.attackerIdx, state.targetIdx, sched.actionIndex)
	state.runCtx.Actors[state.targetIdx].HP = targetHPBefore

	if !castResult.Accepted {
		reason := "skill_cast_blocked"
		if blocked := strings.TrimSpace(castResult.BlockedReason); blocked != "" {
			reason += ":" + blocked
		}
		state.block(reason)
		sched.nextAtMs = -1
		return
	}

	actionDamageProcessed := false
	var combatCtx dpsCombatEventContext
	hasCombatCtx := false
	compiledAction := state.bundle.Actions[sched.actionIndex]
	for effectIndex, effect := range castResult.Effects {
		if effect.Kind != string(model.EffectTypeDealDamage) || !effect.HasRawAmount {
			continue
		}
		ctx, _, ok := state.processActiveActionDamageEffect(timeMs, sched, compiledAction, castResult, effectIndex, effect, targetHPBefore, false)
		if !ok {
			sched.nextAtMs = -1
			return
		}
		actionDamageProcessed = true
		combatCtx = ctx
		hasCombatCtx = true
	}
	state.syncRunContextHPFromDPS()
	if actionDamageProcessed && hasCombatCtx {
		state.processSkillPassives(combatCtx)
	}

	if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
		sched.nextAtMs = -1
		return
	}

	state.scheduleNextActiveActionCast(sched, timeMs, actionID, false)
}

func (state *dpsCurveState) scheduleNextActiveActionCast(sched *dpsActiveActionSchedule, timeMs int64, actionID string, recordAttackInterval bool) {
	state.syncRunContextFromDPSState(timeMs)
	cooldownMs, ok := state.runCtx.actionCooldownMs(state.attackerIdx, sched.actionIndex)
	if !ok || cooldownMs <= 0 {
		if sched.kind == dpsActiveActionKindBasicAttack {
			state.block("invalid_basic_attack_cooldown:" + actionID)
		} else {
			state.block("invalid_skill_cooldown:" + actionID)
		}
		sched.nextAtMs = -1
		return
	}
	nextAtMs := timeMs + cooldownMs
	sched.nextAtMs = nextAtMs
	state.setDPSActionReadyAt(sched.actionIndex, nextAtMs)

	if recordAttackInterval {
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
	}

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

func (state *dpsCurveState) buildBasicAttackCombatContext(
	timeMs int64,
	sched dpsActiveActionSchedule,
	action compilebundle.CompiledAction,
	damageType string,
	app dpsDamageApplication,
) dpsCombatEventContext {
	actionTypes, effectTags := resolveActiveActionClassifier(sched.ref.Classifier, state.bundle, action)
	return dpsCombatEventContext{
		Event:          dpsEventOnBasicAttackHit,
		TimeMs:         timeMs,
		SourceRole:     dpsRoleAttacker,
		TargetRole:     dpsRoleTarget,
		ActionID:       sched.ref.ActionID,
		ActionTypes:    actionTypes,
		EffectTypes:    []string{string(model.EffectTypeDealDamage)},
		EffectTags:     effectTags,
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

func (state *dpsCurveState) buildSkillCombatContext(
	timeMs int64,
	sched dpsActiveActionSchedule,
	action compilebundle.CompiledAction,
	damageType string,
	app dpsDamageApplication,
) dpsCombatEventContext {
	actionTypes, effectTags := resolveActiveActionClassifier(sched.ref.Classifier, state.bundle, action)
	return dpsCombatEventContext{
		Event:          dpsEventOnSpellHit,
		TimeMs:         timeMs,
		SourceRole:     dpsRoleAttacker,
		TargetRole:     dpsRoleTarget,
		ActionID:       sched.ref.ActionID,
		ActionTypes:    actionTypes,
		EffectTypes:    []string{string(model.EffectTypeDealDamage)},
		EffectTags:     effectTags,
		SourceType:     "spell",
		SourceCategory: "spell",
		SourceID:       nonEmpty(sched.ref.SkillID, sched.ref.ActionID),
		DamageType:     damageType,
		RawDamage:      app.RawDamage,
		FinalDamage:    app.FinalDamage,
		TargetHPBefore: app.TargetHPBefore,
		TargetHPAfter:  app.TargetHPAfter,
		IsSpell:        true,
		ProcScope:      dpsProcScopeActiveSkill,
	}
}

func resolveActiveActionClassifier(
	classifier model.ClassifierV2,
	bundle compilebundle.CompiledBundle,
	action compilebundle.CompiledAction,
) (actionTypes []string, effectTags []string) {
	if len(classifier.Types) > 0 {
		actionTypes = append([]string(nil), classifier.Types...)
	}
	if len(classifier.Tags) > 0 {
		effectTags = append([]string(nil), classifier.Tags...)
	}
	if len(actionTypes) == 0 {
		actionTypes = typeKeysFromCompiledAction(bundle, action)
	}
	return actionTypes, effectTags
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
