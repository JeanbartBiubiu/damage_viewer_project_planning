// DPS 合约校验与支持的 trigger/damage 类型。
package runtime

import (
	"math"
	"strconv"
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
	activeRefs := resolvedDPSActiveActions(curve.ResolvedSnapshot)
	if len(activeRefs) == 0 {
		reasons = append(reasons, "missing_basic_attack_action")
	}
	attackerTemplateID := nonEmpty(attacker.TemplateID, "dps_attacker")
	for _, ref := range activeRefs {
		if strings.TrimSpace(ref.ActionID) == "" {
			if len(curve.ResolvedSnapshot.ActiveActions) > 0 {
				reasons = append(reasons, "activeActions.actionId is required")
			} else {
				reasons = append(reasons, "basicAttackActions.actionId is required")
			}
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
		kind := resolveActiveActionKind(bundle, ref, actionIndex)
		switch kind {
		case dpsActiveActionKindBasicAttack:
			if !compiledActionHasBasicAttackClassifier(bundle, actionIndex) {
				reasons = append(reasons, "invalid_basic_attack_classifier:"+ref.ActionID)
			}
		case dpsActiveActionKindSkill:
		default:
			reasons = append(reasons, "unsupported_active_action_kind:"+kind)
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
	reasons = append(reasons, validateDPSPassiveSelection(bundle, curve)...)
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

func validateDPSPassiveSelection(bundle compilebundle.CompiledBundle, curve model.DPSCurveRunSpecV2) []string {
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
		reasons = append(reasons, validateDPSPassive(bundle, passive, curve)...)
	}
	return reasons
}

func validateDPSPassive(bundle compilebundle.CompiledBundle, passive model.DPSPassiveEffectV2, curve model.DPSCurveRunSpecV2) []string {
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
	if passive.InternalCooldownMs < 0 {
		reasons = append(reasons, "passive effect "+id+" internalCooldownMs="+strconv.FormatInt(passive.InternalCooldownMs, 10)+" must be >= 0")
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
		reasons = append(reasons, validateDPSPassiveOperation(bundle, id, op)...)
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

func validateDPSPassiveOperation(bundle compilebundle.CompiledBundle, passiveID string, op model.DPSPassiveOperationV2) []string {
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
		bucketKey := strings.TrimSpace(op.BucketKey)
		if bucketKey == "" {
			if op.AttrKey == "" {
				reasons = append(reasons, "passive effect "+passiveID+" stat_modifier requires attrKey")
			}
			if math.IsNaN(op.Value) || math.IsInf(op.Value, 0) {
				reasons = append(reasons, "passive effect "+passiveID+" stat_modifier has invalid value")
			}
		} else {
			reasons = append(reasons, validateDPSBucketModifierValueSpec(bundle, passiveID, "stat_modifier", op)...)
		}
	case dpsOpDamageModifier:
		bucketKey := strings.TrimSpace(op.BucketKey)
		if bucketKey == "" {
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
		} else {
			reasons = append(reasons, validateDPSBucketModifierValueSpec(bundle, passiveID, "damage_modifier", op)...)
		}
	case dpsOpCoefficientModifier:
		bucketKey := strings.TrimSpace(op.BucketKey)
		if bucketKey == "" {
			reasons = append(reasons, "passive effect "+passiveID+" coefficient_modifier requires bucketKey")
		} else {
			bucket, ok := lookupDPSCoefficientBucket(bundle, bucketKey)
			if !ok {
				reasons = append(reasons, "passive effect "+passiveID+" coefficient_modifier references unknown coefficient bucket "+bucketKey)
			} else {
				reasons = append(reasons, validateDPSBucketModifierValueSpec(bundle, passiveID, "coefficient_modifier", op)...)
				reasons = append(reasons, validateDPSCoefficientModifierTargetRole(passiveID, op, bucket)...)
			}
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
	case dpsOpCritContextModifier:
		if !op.ForceCrit && !op.HasCritMultiplierOverride && !op.HasCritMultiplierScale {
			reasons = append(reasons, "passive effect "+passiveID+" crit_context_modifier requires forceCrit, critMultiplierOverride, or critMultiplierScale")
		}
		if op.HasCritMultiplierOverride && op.HasCritMultiplierScale {
			reasons = append(reasons, "passive effect "+passiveID+" crit_context_modifier cannot combine critMultiplierOverride and critMultiplierScale")
		}
		if op.HasCritMultiplierOverride && (math.IsNaN(op.CritMultiplierOverride) || math.IsInf(op.CritMultiplierOverride, 0) || op.CritMultiplierOverride <= 0) {
			reasons = append(reasons, "passive effect "+passiveID+" crit_context_modifier has invalid critMultiplierOverride")
		}
		if op.HasCritMultiplierScale && (math.IsNaN(op.CritMultiplierScale) || math.IsInf(op.CritMultiplierScale, 0) || op.CritMultiplierScale <= 0) {
			reasons = append(reasons, "passive effect "+passiveID+" crit_context_modifier has invalid critMultiplierScale")
		}
	case dpsOpExecuteThreshold:
		switch strings.TrimSpace(op.ThresholdType) {
		case dpsThresholdTypeCurrentHPRatio, dpsThresholdTypeCurrentHPValue:
		default:
			reasons = append(reasons, "passive effect "+passiveID+" execute_threshold has unsupported thresholdType "+op.ThresholdType)
		}
		if math.IsNaN(op.ThresholdValue) || math.IsInf(op.ThresholdValue, 0) || op.ThresholdValue < 0 {
			reasons = append(reasons, "passive effect "+passiveID+" execute_threshold has invalid thresholdValue")
		}
		checkTiming := strings.TrimSpace(op.CheckTiming)
		if checkTiming == "" {
			checkTiming = dpsCheckTimingAfterDamage
		}
		if checkTiming != dpsCheckTimingAfterDamage {
			reasons = append(reasons, "passive effect "+passiveID+" execute_threshold has unsupported checkTiming "+op.CheckTiming)
		}
	default:
		reasons = append(reasons, "passive effect "+passiveID+" has unsupported operation "+op.Kind)
	}
	return reasons
}

func validateDPSBucketModifierValueSpec(
	bundle compilebundle.CompiledBundle,
	passiveID string,
	operationKind string,
	op model.DPSPassiveOperationV2,
) []string {
	reasons := make([]string, 0)
	valueSpecKind := strings.TrimSpace(op.ValueSpec.Kind)
	if valueSpecKind == "" {
		if math.IsNaN(op.Value) || math.IsInf(op.Value, 0) {
			reasons = append(reasons, "passive effect "+passiveID+" "+operationKind+" has invalid value")
		}
		return reasons
	}
	switch valueSpecKind {
	case "literal":
		if math.IsNaN(op.ValueSpec.Value) || math.IsInf(op.ValueSpec.Value, 0) {
			reasons = append(reasons, "passive effect "+passiveID+" "+operationKind+" valueSpec literal has invalid value")
		}
	case "attr_ratio", "hp_ratio", "hp_diff_ratio":
	case "crit_scaling":
		metric := strings.TrimSpace(op.ValueSpec.AttrKey)
		if metric == "" {
			metric = "crit_chance_effective"
		}
		switch metric {
		case "crit_chance", "crit_chance_raw", "crit_chance_effective", "crit_multiplier", "crit_multiplier_effective", "crit_damage":
		default:
			reasons = append(reasons, "passive effect "+passiveID+" "+operationKind+" valueSpec crit_scaling has unsupported attrKey "+metric)
		}
	case "formula":
		reasons = append(reasons, validateDPSModifierFormulaValueSpec(bundle, passiveID, operationKind, op.ValueSpec)...)
	default:
		reasons = append(reasons, "passive effect "+passiveID+" "+operationKind+" valueSpec has unsupported kind "+valueSpecKind)
	}
	return reasons
}

func validateDPSCoefficientModifierTargetRole(
	passiveID string,
	op model.DPSPassiveOperationV2,
	bucket compilebundle.CompiledCoefficientBucket,
) []string {
	reasons := make([]string, 0)
	role := strings.TrimSpace(op.TargetRole)
	if bucket.ResolutionDomain == compilebundle.ResolutionDomainAttribute {
		if role != "" && role != dpsRoleAttacker && role != dpsRoleTarget {
			reasons = append(reasons, "passive effect "+passiveID+" coefficient_modifier has unsupported operation targetRole "+op.TargetRole)
		}
		return reasons
	}
	if bucket.StageKey == dpsHPChangeStageOutgoingPreMitigation {
		if role != "" && role != dpsRoleAttacker {
			reasons = append(reasons, "passive effect "+passiveID+" coefficient_modifier outgoing bucket requires targetRole attacker")
		}
		return reasons
	}
	if role != "" && role != dpsRoleTarget {
		reasons = append(reasons, "passive effect "+passiveID+" coefficient_modifier hp_change bucket requires targetRole target")
	}
	return reasons
}

func validateDPSModifierFormulaValueSpec(
	bundle compilebundle.CompiledBundle,
	passiveID string,
	operationKind string,
	spec model.DPSModifierValueSpecV2,
) []string {
	reasons := make([]string, 0)
	formulaID := strings.TrimSpace(spec.FormulaID)
	if formulaID == "" {
		reasons = append(reasons, "passive effect "+passiveID+" "+operationKind+" valueSpec formula requires formulaId")
		return reasons
	}
	programID, ok := bundle.Formulas.Lookup(formulaID)
	if !ok {
		reasons = append(reasons, "passive effect "+passiveID+" "+operationKind+" valueSpec formula references unknown formula "+formulaID)
		return reasons
	}
	if int(programID) >= len(bundle.Formulas.Programs) {
		reasons = append(reasons, "passive effect "+passiveID+" "+operationKind+" valueSpec formula references invalid formula "+formulaID)
		return reasons
	}
	if formulaProgramUsesUnsupportedDPSModifierReaders(bundle.Formulas.Programs[programID]) {
		reasons = append(reasons, "passive effect "+passiveID+" "+operationKind+" valueSpec formula requires unsupported runtime readers")
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
			if strings.TrimSpace(op.BucketKey) == "" {
				reasons = append(reasons, "passive effect "+passiveID+" operation damage_modifier does not support targetRole attacker")
			}
		} else if role != "" && role != dpsRoleTarget {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported operation targetRole "+op.TargetRole)
		}
	case dpsOpApplyDot, dpsOpTriggerDamageAtStacks, dpsOpExecuteThreshold:
		if role == dpsRoleAttacker {
			reasons = append(reasons, "passive effect "+passiveID+" operation "+op.Kind+" does not support targetRole attacker")
		} else if role != "" && role != dpsRoleTarget {
			reasons = append(reasons, "passive effect "+passiveID+" has unsupported operation targetRole "+op.TargetRole)
		}
	case dpsOpCoefficientModifier:
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
	case dpsEventOnBasicAttackHit, dpsEventOnSpellHit, dpsEventOnHit, dpsEventOnDamageDealt, dpsEventOnDamageTaken, dpsEventOnCrit, dpsTriggerStatAlwaysOn, dpsTriggerPreEnabledModifier, dpsEventDotTick:
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
