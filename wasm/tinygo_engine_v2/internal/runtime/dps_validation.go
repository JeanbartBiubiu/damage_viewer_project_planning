// DPS 合约校验与支持的 trigger/damage 类型。
package runtime

import (
	"math"
	"strings"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

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
	reasons = append(reasons, validateDPSTargetEquipment(curve)...)
	return reasons
}

func validateDPSTargetEquipment(curve model.DPSCurveRunSpecV2) []string {
	reasons := make([]string, 0)
	selectionSet := normalizeStringSet(curve.Selection.TargetEquipmentSet)
	resolvedSet := normalizeStringSet(curve.ResolvedSnapshot.TargetEquipmentSet)
	if len(selectionSet) > 0 && len(resolvedSet) == 0 {
		reasons = append(reasons, "resolvedSnapshot.targetEquipmentSet is required when selection.targetEquipmentSet is present")
	}
	if len(selectionSet) > 0 && len(resolvedSet) > 0 && !sameStringSet(selectionSet, resolvedSet) {
		reasons = append(reasons, "selection.targetEquipmentSet must match resolvedSnapshot.targetEquipmentSet")
	}
	if len(resolvedSet) > 0 && curve.ResolvedSnapshot.TargetEquipmentStats == nil {
		reasons = append(reasons, "resolvedSnapshot.targetEquipmentStats is required when targetEquipmentSet is present")
	}
	for attrKey, value := range curve.ResolvedSnapshot.TargetEquipmentStats {
		if strings.TrimSpace(attrKey) == "" {
			reasons = append(reasons, "resolvedSnapshot.targetEquipmentStats contains empty attr key")
			continue
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			reasons = append(reasons, "resolvedSnapshot.targetEquipmentStats."+attrKey+" must be finite")
		}
	}
	return reasons
}

func validateDPSPassiveSelection(curve model.DPSCurveRunSpecV2) []string {
	reasons := make([]string, 0)
	enabled := enabledPassiveIDSet(curve)
	targetEnabled := targetEnabledPassiveIDSet(curve)
	if len(enabled) == 0 && len(targetEnabled) == 0 {
		return reasons
	}
	for id := range enabled {
		if findPassiveByID(curve.ResolvedSnapshot.PassiveEffects, id) == nil {
			reasons = append(reasons, "enabled passive effect "+id+" is missing from resolvedSnapshot.passiveEffects")
		}
	}
	for id := range targetEnabled {
		passive := findPassiveByID(curve.ResolvedSnapshot.PassiveEffects, id)
		if passive == nil {
			reasons = append(reasons, "target enabled passive effect "+id+" is missing from resolvedSnapshot.passiveEffects")
			continue
		}
		if resolvedDPSOwnerRole(*passive) != dpsRoleTarget {
			reasons = append(reasons, "target enabled passive effect "+id+" requires ownerRole target")
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
