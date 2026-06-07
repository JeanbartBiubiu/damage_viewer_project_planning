// 被动事件分发与 incoming damage modifier 管线。
package runtime

import (
	"math"
	"sort"
	"strings"
	"tinygo_engine_v2/internal/model"
)

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
