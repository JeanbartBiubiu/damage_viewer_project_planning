// DPS 常量与轻量共享上下文/数据类型。
package runtime

import (
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
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
	dpsProcScopeActiveSkill                           = "active_skill"

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
	dpsOpCoefficientModifier        = "coefficient_modifier"
	dpsOpCritContextModifier        = "crit_context_modifier"
	dpsEffectCoefficientBucket      = "coefficient_bucket"

	dpsEventOnCrit = "on_crit"

	dpsHPChangeStageOutgoingPreMitigation = "hp_change/outgoing/pre_mitigation"
	dpsHPChangeStageIncomingPreMitigation = "hp_change/incoming/pre_mitigation"
	dpsHPChangeStageFinalPostMitigation   = "hp_change/final/post_mitigation"
	dpsHPChangeStageFlatPostPercent       = "hp_change/flat/post_percent"

	dpsAttributeStageBaseBonus       = "attribute/base_bonus"
	dpsAttributeStageFlatBonus       = "attribute/flat_bonus"
	dpsAttributeStageFinalMultiplier = "attribute/final_multiplier"
	dpsOpPhantomHitOnHitRepeat       = "phantom_hit_on_hit_repeat"
	dpsOpExecuteThreshold            = "execute_threshold"
	dpsRepeatScopeCopyableOnHit      = "copyable_on_hit"

	dpsThresholdTypeCurrentHPRatio = "current_hp_ratio"
	dpsThresholdTypeCurrentHPValue = "current_hp_value"
	dpsCheckTimingAfterDamage      = "after_damage"
	dpsStopReasonExecuteThreshold  = "execute_threshold"

	dpsEventOnBasicAttackHit = "on_basic_attack_hit"
	dpsEventOnSpellHit       = "on_spell_hit"
	dpsEventOnHit            = "on_hit"
	dpsEventOnDamageDealt    = "on_damage_dealt"
	dpsEventOnDamageTaken    = "on_damage_taken"
	dpsEventDotTick          = "dot_tick"

	dpsValuePhaseIncoming = "incoming"

	dpsRoleAttacker = "attacker"
	dpsRoleTarget   = "target"

	dpsActiveActionKindBasicAttack = "basic_attack"
	dpsActiveActionKindSkill       = "skill"
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

	IsBasicAttack       bool
	IsSpell             bool
	IsOnHit             bool
	IsDotTick           bool
	IsPhantomHit        bool
	HasCritContext      bool
	CritPolicy          string
	CritChanceRaw       float64
	CritChanceEffective float64
	CritMultiplier      float64
	HasActualCritResult bool
	IsCrit              bool
	ExpectedNormalPart  float64
	ExpectedCritPart    float64
	CritBound           *model.NumericBoundEvidenceV2
	ProcScope           string
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

type dpsAttributeStatModifierEntry struct {
	passive       model.DPSPassiveEffectV2
	op            model.DPSPassiveOperationV2
	recordTrigger bool
}

type dpsAttributeBucketCandidate struct {
	passive model.DPSPassiveEffectV2
	op      model.DPSPassiveOperationV2
	value   float64
	bucket  compilebundle.CompiledCoefficientBucket
}

type dpsActiveActionSchedule struct {
	ref         model.DPSActiveActionRefV2
	actionIndex uint16
	nextAtMs    int64
	listOrder   int
	kind        string
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
	schedules              []dpsActiveActionSchedule
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
