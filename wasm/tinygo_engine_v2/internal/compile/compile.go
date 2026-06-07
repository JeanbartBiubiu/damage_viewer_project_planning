// compile 包：EngineBundleV2 → CompiledBundle，纯编译期、无 runtime/outbox 副作用。
//
// 不变量：
//   - 短 ID 等于对应 slice 下标；runtime 只通过 uint16/uint8 索引访问
//   - Bundle 尽量 collect-all 返回 Problems，便于前后端一次修完
//   - 不在此包写 scheduler、session 或 HP 变更逻辑
package compile

import (
	"math"
	"sort"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

const (
	DefaultMaxCommandsPerEvent = 64
	DefaultMaxEvents           = 10000
)

// CompiledBundle 是 Session.init 成功后持有的只读规则快照；每次 run 复用同一份。
type CompiledBundle struct {
	Attrs         []CompiledAttribute
	AttrIndex     map[string]uint16
	Resources     []CompiledResource
	ResourceIndex map[string]uint16
	Actors        []CompiledActor
	ActorIndex    map[string]uint8
	Actions       []CompiledAction
	ActionIndex   map[string]uint16
	Statuses      []CompiledStatus
	StatusIndex   map[string]uint16
	Formulas      formula.Registry
	Types         typeset.Registry
	ControlRules  ControlRuleIndex
	Triggers      []CompiledTrigger
	Settings      Settings
}

type Settings struct {
	MaxEvents           int
	MaxCommandsPerEvent int
	MaxQueueEvents      int
	MaxChainDepth       int
}

type CompiledAttribute struct {
	ID                string
	DefaultBase       float64
	DefaultCurrent    float64
	DefaultMax        float64
	HasDefaultCurrent bool
	HasDefaultMax     bool
	ClampMin          float64
	HasClampMin       bool
	ClampMax          float64
	HasClampMax       bool
	DerivedFormula    formula.ProgramID
	HasDerivedFormula bool
}

type CompiledResource struct {
	ID             string
	DefaultCurrent float64
	DefaultMax     float64
}

type CompiledActor struct {
	ID         string
	MaxHP      float64
	InitialHP  float64
	Attributes []model.AttributeValueV2
	Resources  []model.ResourceValueV2
	Actions    []uint16
}

type CompiledAction struct {
	ID                 string
	Label              string
	TypeSet            typeset.TypeSet
	CooldownMs         int64
	CooldownFormula    formula.ProgramID
	HasCooldownFormula bool
	ChannelDurationMs  int64
	SkillLevel         int
	PanelInputs        map[string]float64
	Costs              []CompiledResourceCost
	Effects            []CompiledEffect
	PanelCosts         []CompiledPanelCost
	PanelEffects       []CompiledPanelEffect
	RequiresMark       string
	ConsumesMark       bool
}

type CompiledResourceCost struct {
	Resource   uint16
	Formula    formula.ProgramID
	HasFormula bool
	Amount     float64
}

type CompiledPanelCost struct {
	ResourceID string
	Formula    formula.ProgramID
	HasFormula bool
	FormulaID  string
	Amount     float64
}

type CompiledPanelEffect struct {
	EffectIndex int
	Kind        string
	Label       string
	Formula     formula.ProgramID
	HasFormula  bool
	FormulaID   string
	Amount      float64
	DamageType  string
	StatusID    string
	AttrID      string
	MarkID      string
	SourceRole  string
	TargetRole  string
}

type CompiledStatus struct {
	ID                   string
	Kind                 string
	TypeSet              typeset.TypeSet
	DurationMs           int64
	BlocksActions        bool
	RetryOnRelease       bool
	Magnitude            float64
	ShieldKind           string
	TickIntervalMs       int64
	TickCount            int
	TickEffect           EffectType
	TickFormula          formula.ProgramID
	HasTickFormula       bool
	TickAmount           float64
	TickDamageType       string
	TickCritPolicy       string
	TickCritChanceSource string
	TickCritChance       float64
	TickCritMultiplier   float64
}

type ControlRuleKind uint8

const (
	ControlRuleForbid ControlRuleKind = iota + 1
	ControlRuleInterrupt
)

type CompiledStatusActionControlRule struct {
	ID               string
	Kind             ControlRuleKind
	StatusMatcher    typeset.Matcher
	ActionMatcher    typeset.Matcher
	ActionTagMatcher typeset.Matcher
	PhaseMatcher     typeset.Matcher
	Priority         int16
	RetryOnRelease   bool
}

type ControlRuleIndex struct {
	Rules []CompiledStatusActionControlRule
}

type TriggerEvent uint8

const (
	TriggerOnDamageTaken TriggerEvent = iota + 1
	TriggerOnDamageDealt
	TriggerOnActionCast
)

type CompiledTrigger struct {
	ID             string
	Event          TriggerEvent
	OwnerRole      string
	OwnerID        string
	RequiresDamage bool
	Effects        []CompiledEffect
}

type EffectType uint8

const (
	EffectDealDamage EffectType = iota + 1
	EffectHeal
	EffectApplyStatus
	EffectGrantShield
	EffectApplyMark
	EffectConsumeMark
	EffectDamageFromRecent
	EffectInterrupt
	EffectIncrementCounter
)

type CompiledEffect struct {
	Type                 EffectType
	Formula              formula.ProgramID
	HasFormula           bool
	Amount               float64
	DamageType           string
	Status               uint16
	SourceRole           string
	TargetRole           string
	HistoryWindowMs      int64
	CounterKey           string
	MarkID               string
	CritPolicy           string
	CritChanceSource     string
	CritChance           float64
	CritMultiplierSource string
	CritMultiplier       float64
	ModeAugmentID        string
	ModeMultiplier       float64
}

type Result struct {
	Bundle   CompiledBundle
	Problems []string
}

// Bundle 是编译唯一入口；Problems 非空时 Session 应写 error 帧并进入 PhaseFailed。
func Bundle(input model.EngineBundle) Result {
	var problems []string
	if input.SchemaVersion != 0 && input.SchemaVersion != model.SchemaVersion {
		return Result{Problems: []string{"schemaVersion mismatch"}}
	}

	cb := CompiledBundle{
		Attrs:         make([]CompiledAttribute, 0, len(input.Attributes)),
		AttrIndex:     make(map[string]uint16, len(input.Attributes)),
		Resources:     make([]CompiledResource, 0, len(input.Resources)),
		ResourceIndex: make(map[string]uint16, len(input.Resources)),
		ActorIndex:    make(map[string]uint8, len(input.Actors)),
		ActionIndex:   make(map[string]uint16, len(input.Actions)),
		StatusIndex:   make(map[string]uint16, len(input.Statuses)),
		Types:         typeset.NewRegistry(),
	}
	cb.Settings.MaxEvents = input.Settings.MaxEvents
	if cb.Settings.MaxEvents <= 0 {
		cb.Settings.MaxEvents = DefaultMaxEvents
	}
	cb.Settings.MaxCommandsPerEvent = input.Settings.MaxCommandsPerEvent
	if cb.Settings.MaxCommandsPerEvent <= 0 {
		cb.Settings.MaxCommandsPerEvent = DefaultMaxCommandsPerEvent
	}
	cb.Settings.MaxQueueEvents = input.Settings.MaxQueueEvents
	cb.Settings.MaxChainDepth = input.Settings.MaxChainDepth

	for _, attr := range input.Attributes {
		if attr.ID == "" {
			problems = append(problems, "attribute id is empty")
			continue
		}
		if _, exists := cb.AttrIndex[attr.ID]; exists {
			problems = append(problems, "duplicate attribute: "+attr.ID)
			continue
		}
		cb.AttrIndex[attr.ID] = uint16(len(cb.Attrs))
		cb.Attrs = append(cb.Attrs, CompiledAttribute{
			ID: attr.ID, DefaultBase: attr.DefaultBase, DefaultCurrent: attr.DefaultCurrent,
			DefaultMax: attr.DefaultMax, HasDefaultCurrent: attr.HasDefaultCurrent,
			HasDefaultMax: attr.HasDefaultMax, ClampMin: attr.ClampMin, HasClampMin: attr.HasClampMin,
			ClampMax: attr.ClampMax, HasClampMax: attr.HasClampMax,
		})
	}
	for _, resource := range input.Resources {
		if resource.ID == "" {
			problems = append(problems, "resource id is empty")
			continue
		}
		if _, exists := cb.ResourceIndex[resource.ID]; exists {
			problems = append(problems, "duplicate resource: "+resource.ID)
			continue
		}
		cb.ResourceIndex[resource.ID] = uint16(len(cb.Resources))
		cb.Resources = append(cb.Resources, CompiledResource{
			ID: resource.ID, DefaultCurrent: resource.DefaultCurrent, DefaultMax: resource.DefaultMax,
		})
	}
	registry, formulaProblems := formula.CompileRegistry(input.Formulas, cb.AttrIndex, cb.ResourceIndex)
	problems = append(problems, formulaProblems...)
	cb.Formulas = registry
	for i, inputAttr := range input.Attributes {
		if i >= len(cb.Attrs) || inputAttr.ID == "" || inputAttr.DerivedFormulaID == "" {
			continue
		}
		compiledIdx, ok := cb.AttrIndex[inputAttr.ID]
		if !ok {
			continue
		}
		pid, ok := cb.Formulas.Lookup(inputAttr.DerivedFormulaID)
		if !ok {
			problems = append(problems, "unknown derived formula reference: "+inputAttr.ID+"."+inputAttr.DerivedFormulaID)
			continue
		}
		cb.Attrs[compiledIdx].DerivedFormula = pid
		cb.Attrs[compiledIdx].HasDerivedFormula = true
	}

	for _, status := range input.Statuses {
		if status.ID == "" {
			problems = append(problems, "status id is empty")
			continue
		}
		if _, exists := cb.StatusIndex[status.ID]; exists {
			problems = append(problems, "duplicate status: "+status.ID)
			continue
		}
		typeSet, typeProblems := compileClassifierSet(statusClassifier(status), &cb.Types)
		problems = append(problems, typeProblems...)
		tickEffect, tickFormula, hasTickFormula, tickProblems := compileStatusTick(status, cb)
		problems = append(problems, tickProblems...)
		cb.StatusIndex[status.ID] = uint16(len(cb.Statuses))
		cb.Statuses = append(cb.Statuses, CompiledStatus{
			ID:                   status.ID,
			Kind:                 status.Kind,
			TypeSet:              typeSet,
			DurationMs:           status.DurationMs,
			BlocksActions:        status.BlocksActions,
			RetryOnRelease:       status.RetryOnRelease,
			Magnitude:            status.Magnitude,
			ShieldKind:           status.ShieldKind,
			TickIntervalMs:       status.TickIntervalMs,
			TickCount:            status.TickCount,
			TickEffect:           tickEffect,
			TickFormula:          tickFormula,
			HasTickFormula:       hasTickFormula,
			TickAmount:           status.TickAmount,
			TickDamageType:       status.TickDamageType,
			TickCritPolicy:       status.TickCritPolicy,
			TickCritChanceSource: status.TickCritChanceSource,
			TickCritChance:       status.TickCritChance,
			TickCritMultiplier:   status.TickCritMultiplier,
		})
	}

	for _, action := range input.Actions {
		if action.ID == "" {
			problems = append(problems, "action id is empty")
			continue
		}
		if _, exists := cb.ActionIndex[action.ID]; exists {
			problems = append(problems, "duplicate action: "+action.ID)
			continue
		}
		typeSet, typeProblems := compileClassifierSet(actionClassifier(action), &cb.Types)
		problems = append(problems, typeProblems...)
		cooldownFormula, hasCooldownFormula, cooldownProblems := compileActionCooldown(action, cb)
		problems = append(problems, cooldownProblems...)
		costs, costProblems := compileActionCosts(action, cb)
		problems = append(problems, costProblems...)
		compiledEffects, effectProblems := compileEffects(action.Effects, cb)
		problems = append(problems, effectProblems...)
		panelCosts, panelCostProblems := compilePanelCosts(action, cb)
		problems = append(problems, panelCostProblems...)
		panelEffects, panelEffectProblems := compilePanelEffects(action, cb)
		problems = append(problems, panelEffectProblems...)
		cb.ActionIndex[action.ID] = uint16(len(cb.Actions))
		cb.Actions = append(cb.Actions, CompiledAction{
			ID:                 action.ID,
			Label:              action.Label,
			TypeSet:            typeSet,
			CooldownMs:         action.CooldownMs,
			CooldownFormula:    cooldownFormula,
			HasCooldownFormula: hasCooldownFormula,
			ChannelDurationMs:  action.ChannelDurationMs,
			SkillLevel:         action.SkillLevel,
			PanelInputs:        copyFloatMap(action.PanelInputs),
			Costs:              costs,
			Effects:            compiledEffects,
			PanelCosts:         panelCosts,
			PanelEffects:       panelEffects,
			RequiresMark:       action.RequiresMark,
			ConsumesMark:       action.ConsumesMark,
		})
	}

	controlRules, controlProblems := compileControlRules(input, &cb)
	problems = append(problems, controlProblems...)
	cb.ControlRules = controlRules

	for _, actor := range input.Actors {
		if actor.ID == "" {
			problems = append(problems, "actor id is empty")
			continue
		}
		if _, exists := cb.ActorIndex[actor.ID]; exists {
			problems = append(problems, "duplicate actor: "+actor.ID)
			continue
		}
		attrs := make([]model.AttributeValueV2, len(cb.Attrs))
		for i, def := range cb.Attrs {
			attrs[i] = model.AttributeValueV2{
				Base: def.DefaultBase, Current: def.DefaultCurrent, Max: def.DefaultMax,
				Resolved: def.DefaultBase, HasCurrent: def.HasDefaultCurrent, HasMax: def.HasDefaultMax,
			}
			if !def.HasDefaultCurrent {
				attrs[i].Current = def.DefaultBase
			}
			if !def.HasDefaultMax {
				attrs[i].Max = def.DefaultBase
			}
		}
		for attr, value := range actor.Attributes {
			idx, ok := cb.AttrIndex[attr]
			if !ok {
				problems = append(problems, "unknown actor attr: "+actor.ID+"."+attr)
				continue
			}
			attrs[idx] = value
		}
		resources := make([]model.ResourceValueV2, len(cb.Resources))
		for i, def := range cb.Resources {
			resources[i] = model.ResourceValueV2{Current: def.DefaultCurrent, Max: def.DefaultMax}
		}
		for resourceID, value := range actor.Resources {
			idx, ok := cb.ResourceIndex[resourceID]
			if !ok {
				problems = append(problems, "unknown actor resource: "+actor.ID+"."+resourceID)
				continue
			}
			resources[idx] = value
		}
		actions := make([]uint16, 0, len(actor.Actions))
		for _, actionID := range actor.Actions {
			idx, ok := cb.ActionIndex[actionID]
			if !ok {
				problems = append(problems, "unknown actor action: "+actor.ID+"."+actionID)
				continue
			}
			actions = append(actions, idx)
		}
		cb.ActorIndex[actor.ID] = uint8(len(cb.Actors))
		cb.Actors = append(cb.Actors, CompiledActor{
			ID: actor.ID, MaxHP: actor.MaxHP, InitialHP: actor.InitialHP,
			Attributes: attrs, Resources: resources, Actions: actions,
		})
	}

	for _, trigger := range input.Triggers {
		effects, effectProblems := compileEffects(trigger.Effects, cb)
		problems = append(problems, effectProblems...)
		event := triggerEvent(trigger.Event)
		if event == 0 {
			problems = append(problems, "unsupported trigger event: "+trigger.Event)
			continue
		}
		cb.Triggers = append(cb.Triggers, CompiledTrigger{
			ID: trigger.ID, Event: event, OwnerRole: trigger.OwnerRole, OwnerID: trigger.OwnerID,
			RequiresDamage: trigger.RequiresDamage, Effects: effects,
		})
	}

	return Result{Bundle: cb, Problems: problems}
}

func actionClassifier(action model.ActionTemplate) model.ClassifierV2 {
	classifier := action.Classifier
	if len(classifier.Types) == 0 {
		classifier.Types = append(classifier.Types, "action/"+action.ID)
	}
	return classifier
}

func compileActionCooldown(action model.ActionTemplate, cb CompiledBundle) (formula.ProgramID, bool, []string) {
	if action.CooldownFormulaID == "" {
		return 0, false, nil
	}
	pid, ok := cb.Formulas.Lookup(action.CooldownFormulaID)
	if !ok {
		return 0, false, []string{"unknown action cooldown formula: " + action.ID + "." + action.CooldownFormulaID}
	}
	return pid, true, nil
}

func statusClassifier(status model.StatusTemplate) model.ClassifierV2 {
	classifier := status.Classifier
	if len(classifier.Types) == 0 {
		classifier.Types = append(classifier.Types, "status/"+status.ID)
	}
	return classifier
}

func compileClassifierSet(classifier model.ClassifierV2, registry *typeset.Registry) (typeset.TypeSet, []string) {
	var set typeset.TypeSet
	var problems []string
	for _, key := range classifier.Types {
		addTypeKey(key, registry, &set, &problems)
	}
	for _, key := range classifier.Tags {
		addTypeKey(key, registry, &set, &problems)
	}
	return set, problems
}

func compileStatusTick(status model.StatusTemplate, cb CompiledBundle) (EffectType, formula.ProgramID, bool, []string) {
	var problems []string
	effect := effectType(status.TickEffectType)
	hasTickConfig := status.TickIntervalMs != 0 || status.TickCount != 0 || status.TickFormulaID != "" || status.TickAmount != 0
	if !hasTickConfig {
		return 0, 0, false, nil
	}
	if effect == 0 {
		switch status.Kind {
		case "dot":
			effect = EffectDealDamage
		case "hot":
			effect = EffectHeal
		}
	}
	if effect != EffectDealDamage && effect != EffectHeal {
		problems = append(problems, "unsupported status tick effect: "+status.ID+"."+string(status.TickEffectType))
	}
	if status.TickIntervalMs <= 0 {
		problems = append(problems, "invalid status tick interval: "+status.ID)
	}
	if status.TickCount <= 0 {
		problems = append(problems, "invalid status tick count: "+status.ID)
	}
	if status.TickFormulaID == "" && invalidAmount(status.TickAmount) {
		problems = append(problems, "invalid status tick amount: "+status.ID)
	}
	if status.TickFormulaID == "" {
		return effect, 0, false, problems
	}
	pid, ok := cb.Formulas.Lookup(status.TickFormulaID)
	if !ok {
		problems = append(problems, "unknown status tick formula: "+status.ID+"."+status.TickFormulaID)
		return effect, 0, false, problems
	}
	return effect, pid, true, problems
}

func addTypeKey(key string, registry *typeset.Registry, set *typeset.TypeSet, problems *[]string) {
	if key == "" {
		*problems = append(*problems, "type key is empty")
		return
	}
	id, ok := registry.Intern(key)
	if !ok {
		*problems = append(*problems, "too many type keys")
		return
	}
	set.Add(id)
}

func compileActionCosts(action model.ActionTemplate, cb CompiledBundle) ([]CompiledResourceCost, []string) {
	compiled := make([]CompiledResourceCost, 0, len(action.ResourceCost))
	var problems []string
	for _, cost := range action.ResourceCost {
		if cost.ResourceID == "" {
			problems = append(problems, "action resource cost missing resource: "+action.ID)
			continue
		}
		resourceID, ok := cb.ResourceIndex[cost.ResourceID]
		if !ok {
			problems = append(problems, "unknown action resource cost: "+action.ID+"."+cost.ResourceID)
			continue
		}
		next := CompiledResourceCost{Resource: resourceID, Amount: cost.Amount}
		if cost.FormulaID != "" {
			pid, ok := cb.Formulas.Lookup(cost.FormulaID)
			if !ok {
				problems = append(problems, "unknown action resource cost formula: "+action.ID+"."+cost.FormulaID)
				continue
			}
			next.Formula = pid
			next.HasFormula = true
		} else if invalidAmount(cost.Amount) {
			problems = append(problems, "invalid action resource cost amount: "+action.ID+"."+cost.ResourceID)
			continue
		}
		compiled = append(compiled, next)
	}
	return compiled, problems
}

func compilePanelCosts(action model.ActionTemplate, cb CompiledBundle) ([]CompiledPanelCost, []string) {
	compiled := make([]CompiledPanelCost, 0, len(action.PanelCosts))
	var problems []string
	for _, cost := range action.PanelCosts {
		next := CompiledPanelCost{
			ResourceID: cost.ResourceID,
			FormulaID:  cost.FormulaID,
			Amount:     cost.Amount,
		}
		if cost.ResourceID != "" {
			if _, ok := cb.ResourceIndex[cost.ResourceID]; !ok {
				problems = append(problems, "unknown action panel cost resource: "+action.ID+"."+cost.ResourceID)
			}
		}
		if cost.FormulaID != "" {
			pid, ok := cb.Formulas.Lookup(cost.FormulaID)
			if !ok {
				problems = append(problems, "unknown action panel cost formula: "+action.ID+"."+cost.FormulaID)
			} else {
				next.Formula = pid
				next.HasFormula = true
			}
		}
		if cost.FormulaID == "" && invalidAmount(cost.Amount) {
			problems = append(problems, "invalid action panel cost amount: "+action.ID)
		}
		compiled = append(compiled, next)
	}
	return compiled, problems
}

func compilePanelEffects(action model.ActionTemplate, cb CompiledBundle) ([]CompiledPanelEffect, []string) {
	compiled := make([]CompiledPanelEffect, 0, len(action.PanelEffects))
	var problems []string
	for _, effect := range action.PanelEffects {
		next := CompiledPanelEffect{
			EffectIndex: effect.EffectIndex,
			Kind:        effect.Kind,
			Label:       effect.Label,
			FormulaID:   effect.FormulaID,
			Amount:      effect.Amount,
			DamageType:  effect.DamageType,
			StatusID:    effect.StatusID,
			AttrID:      effect.AttrID,
			MarkID:      effect.MarkID,
			SourceRole:  effect.SourceRole,
			TargetRole:  effect.TargetRole,
		}
		if effect.EffectIndex < 0 {
			problems = append(problems, "invalid action panel effect index: "+action.ID)
		}
		if effect.FormulaID != "" {
			pid, ok := cb.Formulas.Lookup(effect.FormulaID)
			if !ok {
				problems = append(problems, "unknown action panel effect formula: "+action.ID+"."+effect.FormulaID)
			} else {
				next.Formula = pid
				next.HasFormula = true
			}
		}
		compiled = append(compiled, next)
	}
	return compiled, problems
}

func compileControlRules(input model.EngineBundle, cb *CompiledBundle) (ControlRuleIndex, []string) {
	if len(input.StatusActionControlRules) == 0 {
		return compileLegacyControlRules(cb)
	}
	rules := make([]CompiledStatusActionControlRule, 0, len(input.StatusActionControlRules))
	var problems []string
	seen := make(map[string]struct{}, len(input.StatusActionControlRules))
	for _, rule := range input.StatusActionControlRules {
		if rule.ID == "" {
			problems = append(problems, "status action control rule id is empty")
			continue
		}
		if _, exists := seen[rule.ID]; exists {
			problems = append(problems, "duplicate status action control rule: "+rule.ID)
			continue
		}
		seen[rule.ID] = struct{}{}
		compiled := CompiledStatusActionControlRule{
			ID:             rule.ID,
			Priority:       int16(rule.Priority),
			RetryOnRelease: rule.RetryOnRelease,
		}
		switch rule.RuleKind {
		case "forbid":
			compiled.Kind = ControlRuleForbid
			if !emptyMatcher(rule.InterruptPhaseTypes) {
				problems = append(problems, "forbid rule declares interrupt phases: "+rule.ID)
				continue
			}
		case "interrupt":
			compiled.Kind = ControlRuleInterrupt
			if emptyMatcher(rule.InterruptPhaseTypes) {
				problems = append(problems, "interrupt rule missing interrupt phases: "+rule.ID)
				continue
			}
		default:
			problems = append(problems, "unsupported status action control rule kind: "+rule.ID+"."+rule.RuleKind)
			continue
		}
		if emptyMatcher(rule.StatusTypes) {
			problems = append(problems, "status action control rule missing status types: "+rule.ID)
			continue
		}
		if emptyMatcher(rule.ActionTypes) {
			problems = append(problems, "status action control rule missing action types: "+rule.ID)
			continue
		}
		compiled.StatusMatcher, problems = compileRuleMatcher(rule.ID+".statusTypes", rule.StatusTypes, cb.Types, problems)
		compiled.ActionMatcher, problems = compileRuleMatcher(rule.ID+".actionTypes", rule.ActionTypes, cb.Types, problems)
		compiled.ActionTagMatcher, problems = compileRuleMatcher(rule.ID+".actionMatchTypes", rule.ActionMatchTypes, cb.Types, problems)
		compiled.PhaseMatcher, problems = compileRuleMatcher(rule.ID+".interruptPhaseTypes", rule.InterruptPhaseTypes, cb.Types, problems)
		rules = append(rules, compiled)
	}
	sortControlRules(rules)
	return ControlRuleIndex{Rules: rules}, problems
}

func compileLegacyControlRules(cb *CompiledBundle) (ControlRuleIndex, []string) {
	legacyActionTypes := model.TypeMatcherV2{Any: model.TypeListV2{
		"action/basic_attack", "action/cast_skill", "action/cast_item", "action/move",
	}}
	rules := make([]CompiledStatusActionControlRule, 0)
	var problems []string
	for _, key := range legacyActionTypes.Any {
		if _, ok := cb.Types.Intern(key); !ok {
			problems = append(problems, "too many type keys")
		}
	}
	for _, status := range cb.Statuses {
		if !status.BlocksActions {
			continue
		}
		rule := CompiledStatusActionControlRule{
			ID:             "legacy_" + status.ID + "_block_all",
			Kind:           ControlRuleForbid,
			Priority:       0,
			RetryOnRelease: status.RetryOnRelease,
		}
		rule.StatusMatcher, problems = compileRuleMatcher(rule.ID+".statusTypes", model.TypeMatcherV2{Any: typeKeys(status.TypeSet, cb.Types)}, cb.Types, problems)
		rule.ActionMatcher, problems = compileRuleMatcher(rule.ID+".actionTypes", legacyActionTypes, cb.Types, problems)
		rules = append(rules, rule)
	}
	sortControlRules(rules)
	return ControlRuleIndex{Rules: rules}, problems
}

func compileRuleMatcher(prefix string, input model.TypeMatcherV2, registry typeset.Registry, problems []string) (typeset.Matcher, []string) {
	matcher, matcherProblems := typeset.CompileMatcher(input, registry)
	for _, problem := range matcherProblems {
		problems = append(problems, prefix+": "+problem)
	}
	return matcher, problems
}

func typeKeys(set typeset.TypeSet, registry typeset.Registry) model.TypeListV2 {
	keys := make(model.TypeListV2, 0)
	for i, key := range registry.Keys {
		if set.Contains(typeset.TypeID(i)) {
			keys = append(keys, key)
		}
	}
	return keys
}

func emptyMatcher(input model.TypeMatcherV2) bool {
	return len(input.Any) == 0 && len(input.All) == 0 && len(input.None) == 0
}

func sortControlRules(rules []CompiledStatusActionControlRule) {
	sort.SliceStable(rules, func(i, j int) bool {
		return rules[i].Priority > rules[j].Priority
	})
}

func invalidAmount(amount float64) bool {
	return amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0)
}

func copyFloatMap(input map[string]float64) map[string]float64 {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]float64, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func compileEffects(effects []model.EffectDef, cb CompiledBundle) ([]CompiledEffect, []string) {
	compiled := make([]CompiledEffect, 0, len(effects))
	var problems []string
	for _, effect := range effects {
		next := CompiledEffect{
			Type: effectType(effect.Type), Amount: effect.Amount, DamageType: effect.DamageType,
			SourceRole: effect.SourceRole, TargetRole: effect.TargetRole, HistoryWindowMs: effect.HistoryWindowMs,
			CounterKey: effect.CounterKey, MarkID: effect.MarkID, CritPolicy: effect.CritPolicy,
			CritChanceSource:     effect.CritChanceSource,
			CritChance:           effect.CritChance,
			CritMultiplierSource: effect.CritMultiplierSource,
			CritMultiplier:       effect.CritMultiplier,
			ModeAugmentID:        effect.ModeAugmentID, ModeMultiplier: effect.ModeMultiplier,
		}
		if next.Type == 0 {
			problems = append(problems, "unsupported effect type: "+string(effect.Type))
			continue
		}
		if effect.FormulaID != "" {
			pid, ok := cb.Formulas.Lookup(effect.FormulaID)
			if !ok {
				problems = append(problems, "unknown formula reference: "+effect.FormulaID)
			} else {
				next.Formula = pid
				next.HasFormula = true
			}
		}
		if effect.StatusID != "" {
			idx, ok := cb.StatusIndex[effect.StatusID]
			if !ok {
				problems = append(problems, "unknown status reference: "+effect.StatusID)
			} else {
				next.Status = idx
			}
		}
		compiled = append(compiled, next)
	}
	return compiled, problems
}

func effectType(value model.EffectType) EffectType {
	switch value {
	case model.EffectTypeDealDamage:
		return EffectDealDamage
	case model.EffectTypeHeal:
		return EffectHeal
	case model.EffectTypeApplyStatus:
		return EffectApplyStatus
	case model.EffectTypeGrantShield:
		return EffectGrantShield
	case model.EffectTypeApplyMark:
		return EffectApplyMark
	case model.EffectTypeConsumeMark:
		return EffectConsumeMark
	case model.EffectTypeDamageFromRecent:
		return EffectDamageFromRecent
	case model.EffectTypeInterrupt:
		return EffectInterrupt
	case model.EffectTypeIncrementCounter:
		return EffectIncrementCounter
	default:
		return 0
	}
}

func triggerEvent(value string) TriggerEvent {
	switch value {
	case "on_damage_taken":
		return TriggerOnDamageTaken
	case "on_damage_dealt":
		return TriggerOnDamageDealt
	case "on_action_cast":
		return TriggerOnActionCast
	default:
		return 0
	}
}
