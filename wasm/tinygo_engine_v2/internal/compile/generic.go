package compile

import (
	"regexp"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

const (
	defaultGenericMaxEvents           = 100000
	defaultGenericMaxCommandsPerEvent = 256
)

// CompiledAbilityRef 是 intern 后的 ability 三元组引用。
type CompiledAbilityRef struct {
	CombatantIndex uint8
	ProviderIndex  uint16
	AbilityIndex   uint16
}

// CompiledSession 是 generic compile 输出的只读 session 快照。
type CompiledSession struct {
	SchemaVersion   string
	SchemaHash      string
	RulesHash       string
	Types           typeset.CatalogResult
	Combatants      []CompiledCombatant
	Providers       []CompiledProvider
	Abilities       []CompiledAbility
	Operations      []CompiledOperation
	Formulas        formula.GenericRegistry
	Settings        model.GenericCompileSettings
	AbilityRefIndex map[string]CompiledAbilityRef
	RuleModifiers   []CompiledModifier
	Listeners       []CompiledListener
}

// CompiledCombatant 是 compile 后的 combatant 定义。
type CompiledCombatant struct {
	Key            string
	DisplayName    string
	TypeSet        typeset.TypeSet
	Attributes     map[string]model.AttributeSlotDef
	Resources      map[string]model.ResourceSlotDef
	ProviderMounts []CompiledProviderMount
}

// CompiledProviderMount 是 combatant 上已解析的 provider 挂载。
type CompiledProviderMount struct {
	ProviderRef          string
	DefinitionIndex      uint16
	MountedProviderIndex uint16
}

// CompiledModifier 是 compile 后的 provider / rule modifier。
type CompiledModifier struct {
	ModifierKey   string
	Kind          string
	Target        string
	Command       string
	Channel       string
	Bucket        string
	Stage         string
	Priority      int
	ValuePolicy   string
	ValueProgram  formula.GenericProgramID
	HasValue      bool
	HasCondition  bool
	ConditionProg formula.GenericProgramID
}

// CompiledListener 是 compile 后的 listener（provider / rules / inline listenerSpec）。
type CompiledListener struct {
	ListenerKey         string
	AbilityRef          string
	HasAbilityRef       bool
	MaxTriggersPerEvent int
	ChainLimitKey       string
	EventMatcher        typeset.Matcher
	OwnerCombatantKey   string // empty for rules listeners; concrete key for provider-owned
	OwnerProviderRef    string // empty for rules / inline without mount context
	SourceAbilityIndex  int    // >=0 when compiled from passive_listener ability ops
	OperationStart      uint16
	OperationCount      uint16
}

// CompiledProviderLifecycle 是 compile 后的 provider 生命周期。
type CompiledProviderLifecycle struct {
	DurationProgram formula.GenericProgramID
	HasDuration     bool
	MaxStacks       int
	RefreshPolicy   string
	TickIntervalMs  int64
}

// CompiledProvider 是 compile 后的 provider 定义。
type CompiledProvider struct {
	ProviderKey  string
	Kind         string
	StableID     string
	TypeSet      typeset.TypeSet
	AbilityStart uint16
	AbilityCount uint16
	Modifiers    []CompiledModifier
	Listeners    []CompiledListener
	Lifecycle    *CompiledProviderLifecycle
}

// CompiledAbilityCost 是 compile 后的 ability 资源消耗。
type CompiledAbilityCost struct {
	ResourceKey   string
	AmountProgram formula.GenericProgramID
	HasAmount     bool
	AllowPartial  bool
}

// CompiledAbilityCooldown 是 compile 后的 ability 冷却。
type CompiledAbilityCooldown struct {
	DurationProgram formula.GenericProgramID
	HasDuration     bool
	StartsOn        string
	GroupKey        string
}

// CompiledTickSpec 是 compile 后的 tick ability 行为。
type CompiledTickSpec struct {
	IntervalMs   int64
	StartDelayMs int64
	OnTickStart  uint16
	OnTickCount  uint16
}

// CompiledAbility 是 compile 后的 ability 定义。
type CompiledAbility struct {
	AbilityKey     string
	Kind           string
	TypeSet        typeset.TypeSet
	Params         map[string]float64
	Cost           *CompiledAbilityCost
	Cooldown       *CompiledAbilityCooldown
	TickSpec       *CompiledTickSpec
	ProviderIndex  uint16
	OperationStart uint16
	OperationCount uint16
}

// CompiledOperation 是 compile 后的 operation 定义。
type CompiledOperation struct {
	Operation             string
	Target                string
	DamageType            string
	AmountProgram         formula.GenericProgramID
	HasAmount             bool
	ResourceKey           string
	AttributeKey          string
	ValuePolicy           string
	ProviderDefinitionRef string
	ProviderRef           string
	ShieldRef             string
	AbilityRef            CompiledAbilityRef
	HasAbilityRef         bool
	AbilityRefStr         string
	EventType             string
	Ref                   string
	ConditionProgram      formula.GenericProgramID
	HasCondition          bool
	StateScope            string // state_scope/provider | state_scope/provider_target for state_change
	Types                 []string
}

// GenericCompileResult 是 CompileGeneric 的返回值。
type GenericCompileResult struct {
	OK      bool
	Session CompiledSession
	Result  model.CompileResult
}

type genericCompileContext struct {
	collector            *genericCollector
	session              *CompiledSession
	catalog              typeset.CatalogResult
	namedFormulas        map[string]model.GenericFormulaExpr
	providerKeyIndex     map[string]uint16
	combatantByKey       map[string]uint8
	providerMounts       map[string]map[string]uint16
	providerAbilityIndex map[uint16]map[string]uint16
}

var abilityRefPattern = regexp.MustCompile(`^(source|target|self|opponent)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$`)

// CompileGeneric 将 canonical CompileRequest 编译为只读 CompiledSession（collect-all）。
func CompileGeneric(req model.CompileRequest) GenericCompileResult {
	collector := newGenericCollector(req.SchemaHash, req.RulesHash)
	if req.SchemaVersion != model.GenericSchemaVersion {
		collector.addError(model.GenericErrSchemaVersionUnsupported, "schemaVersion", "unsupported schema version", req.SchemaVersion)
	}
	if req.SchemaHash == "" {
		collector.addError(model.GenericErrMissingRequiredField, "schemaHash", "schemaHash is required", "")
	}
	if req.RulesHash == "" {
		collector.addError(model.GenericErrMissingRequiredField, "rulesHash", "rulesHash is required", "")
	}
	if len(req.Combatants) != 2 {
		collector.addError(model.GenericErrMissingRequiredField, "combatants", "P0 requires exactly two combatants", "")
	}

	catalog := typeset.CompileTypeCatalog(req.TypeCatalog, collector.addError)
	session := CompiledSession{
		SchemaVersion:   req.SchemaVersion,
		SchemaHash:      req.SchemaHash,
		RulesHash:       req.RulesHash,
		Types:           catalog,
		AbilityRefIndex: make(map[string]CompiledAbilityRef),
		Settings:        normalizeGenericSettings(req.Settings, collector),
		Formulas: formula.GenericRegistry{
			Programs: make([]formula.GenericProgram, 0),
			Index:    make(map[string]formula.GenericProgramID),
		},
	}
	ctx := &genericCompileContext{
		collector:        collector,
		session:          &session,
		catalog:          catalog,
		namedFormulas:    buildNamedFormulaMap(req.Formulas, collector),
		providerKeyIndex: make(map[string]uint16),
	}

	for i, provider := range req.SharedProviders {
		compileProviderDefinition(provider, "sharedProviders["+itoa(i)+"]", ctx)
	}
	for i, provider := range req.SharedProviders {
		compileProviderAbilities(provider, "sharedProviders["+itoa(i)+"]", ctx)
	}

	combatantKeys := map[string]uint8{}
	for i, combatant := range req.Combatants {
		path := "combatants[" + itoa(i) + "]"
		if combatant.Key == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".key", "combatant key is required", "")
			continue
		}
		if combatant.Key != model.SelectorSource && combatant.Key != model.SelectorTarget {
			collector.addError(model.GenericErrMissingRequiredField, path+".key", "combatant key must be source or target", combatant.Key)
		}
		if _, exists := combatantKeys[combatant.Key]; exists {
			collector.addError(model.GenericErrMissingRequiredField, path+".key", "duplicate combatant key", combatant.Key)
			continue
		}
		combatantKeys[combatant.Key] = uint8(len(session.Combatants))
		compiled := CompiledCombatant{
			Key:         combatant.Key,
			DisplayName: combatant.DisplayName,
			Attributes:  combatant.Attributes,
			Resources:   combatant.Resources,
		}
		if compiled.Attributes == nil {
			compiled.Attributes = map[string]model.AttributeSlotDef{}
		}
		if compiled.Resources == nil {
			compiled.Resources = map[string]model.ResourceSlotDef{}
		}
		compiled.TypeSet = typeset.ValidateTypeKeys(combatant.Types, typeset.EntityCombatant, catalog, path+".types", collector.addError)
		typeset.ValidateTypeKeys(combatant.Tags, typeset.EntityCombatant, catalog, path+".tags", collector.addError)
		for j, mount := range combatant.Providers {
			mountPath := path + ".providers[" + itoa(j) + "]"
			if mount.ProviderRef == "" {
				collector.addError(model.GenericErrMissingRequiredField, mountPath+".providerRef", "providerRef is required", "")
				continue
			}
			if mount.DefinitionRef == "" {
				collector.addError(model.GenericErrMissingRequiredField, mountPath+".definitionRef", "definitionRef is required", mount.ProviderRef)
				continue
			}
			defIdx, ok := ctx.providerKeyIndex[mount.DefinitionRef]
			if !ok {
				collector.addError(model.GenericErrUnknownRef, mountPath+".definitionRef", "unknown provider definition", mount.DefinitionRef)
				continue
			}
			compiled.ProviderMounts = append(compiled.ProviderMounts, CompiledProviderMount{
				ProviderRef:          mount.ProviderRef,
				DefinitionIndex:      defIdx,
				MountedProviderIndex: uint16(len(compiled.ProviderMounts)),
			})
		}
		session.Combatants = append(session.Combatants, compiled)
	}

	namedRegistry := formula.CompileNamedFormulas(req.Formulas, collector.addError)
	for _, prog := range namedRegistry.Programs {
		session.Formulas.Index[prog.Key] = formula.GenericProgramID(len(session.Formulas.Programs))
		session.Formulas.Programs = append(session.Formulas.Programs, prog)
	}
	compileRulesOperations(req.Rules, ctx)
	buildAbilityRefIndex(ctx)
	validateAllAbilityRefs(req, ctx)
	finalizeListenerIndex(ctx)

	if len(collector.errors) > 0 {
		return GenericCompileResult{
			OK: false,
			Result: model.CompileResult{
				OK:         false,
				SchemaHash: req.SchemaHash,
				RulesHash:  req.RulesHash,
				Errors:     collector.errors,
				Warnings:   collector.warnings,
			},
		}
	}

	metadata := &model.CompileResultMetadata{
		CombatantCount: len(session.Combatants),
		ProviderCount:  len(session.Providers),
		AbilityCount:   len(session.Abilities),
		TypeCount:      len(session.Types.Registry.Keys),
		FormulaCount:   len(session.Formulas.Programs),
	}
	return GenericCompileResult{
		OK:      true,
		Session: session,
		Result: model.CompileResult{
			OK:            true,
			SchemaVersion: req.SchemaVersion,
			SchemaHash:    req.SchemaHash,
			RulesHash:     req.RulesHash,
			Metadata:      metadata,
			Warnings:      collector.warnings,
		},
	}
}

func buildNamedFormulaMap(formulas []model.NamedFormula, collector *genericCollector) map[string]model.GenericFormulaExpr {
	named := make(map[string]model.GenericFormulaExpr, len(formulas))
	for i, def := range formulas {
		path := "formulas[" + itoa(i) + "]"
		if def.Key == "" {
			continue
		}
		if _, exists := named[def.Key]; exists {
			collector.addError(model.GenericErrUnknownRef, path+".key", "duplicate formula key", def.Key)
			continue
		}
		named[def.Key] = def.Expression
	}
	return named
}

func validateAllAbilityRefs(req model.CompileRequest, ctx *genericCompileContext) {
	for i, listener := range req.Rules.Listeners {
		if listener.AbilityRef != "" {
			ctx.resolveAbilityRef(listener.AbilityRef, "rules.listeners["+itoa(i)+"].abilityRef")
		}
		for j, op := range listener.Operations {
			if op.AbilityRef != "" {
				ctx.resolveAbilityRef(op.AbilityRef, "rules.listeners["+itoa(i)+"].operations["+itoa(j)+"].abilityRef")
			}
		}
	}
	for i, op := range req.Rules.Operations {
		if op.AbilityRef != "" {
			ctx.resolveAbilityRef(op.AbilityRef, "rules.operations["+itoa(i)+"].abilityRef")
		}
	}
	for i, provider := range req.SharedProviders {
		base := "sharedProviders[" + itoa(i) + "]"
		for j, listener := range provider.Listeners {
			if listener.AbilityRef != "" {
				ctx.resolveAbilityRef(listener.AbilityRef, base+".listeners["+itoa(j)+"].abilityRef")
			}
			for k, op := range listener.Operations {
				if op.AbilityRef != "" {
					ctx.resolveAbilityRef(op.AbilityRef, base+".listeners["+itoa(j)+"].operations["+itoa(k)+"].abilityRef")
				}
			}
		}
		for j, ability := range provider.Abilities {
			for k, op := range ability.Operations {
				if op.AbilityRef != "" {
					ctx.resolveAbilityRef(op.AbilityRef, base+".abilities["+itoa(j)+"].operations["+itoa(k)+"].abilityRef")
				}
			}
		}
	}
}

func compileProviderDefinition(provider model.ProviderDefinition, path string, ctx *genericCompileContext) {
	collector := ctx.collector
	session := ctx.session
	if provider.ProviderKey == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".providerKey", "providerKey is required", "")
		return
	}
	if provider.Kind == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".kind", "provider kind is required", provider.ProviderKey)
	}
	if provider.StableID == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".stableId", "stableId is required", provider.ProviderKey)
	}
	if _, exists := ctx.providerKeyIndex[provider.ProviderKey]; exists {
		collector.addError(model.GenericErrUnknownRef, path+".providerKey", "duplicate provider key", provider.ProviderKey)
		return
	}
	idx := uint16(len(session.Providers))
	ctx.providerKeyIndex[provider.ProviderKey] = idx
	compiled := CompiledProvider{
		ProviderKey:  provider.ProviderKey,
		Kind:         provider.Kind,
		StableID:     provider.StableID,
		AbilityStart: uint16(len(session.Abilities)),
	}
	compiled.TypeSet = typeset.ValidateTypeKeys(provider.Types, typeset.EntityProvider, session.Types, path+".types", collector.addError)
	typeset.ValidateTypeKeys(provider.Tags, typeset.EntityProvider, session.Types, path+".tags", collector.addError)
	for j, mod := range provider.Modifiers {
		compiled.Modifiers = append(compiled.Modifiers, compileModifierDefinition(mod, path+".modifiers["+itoa(j)+"]", ctx))
	}
	if provider.Lifecycle != nil {
		compiled.Lifecycle = compileProviderLifecycle(*provider.Lifecycle, path+".lifecycle", ctx)
	}
	session.Providers = append(session.Providers, compiled)
}

func compileProviderAbilities(provider model.ProviderDefinition, path string, ctx *genericCompileContext) {
	providerIdx, ok := findProviderIndex(ctx.session, provider.ProviderKey)
	if !ok {
		return
	}
	start := ctx.session.Providers[providerIdx].AbilityStart
	for j, ability := range provider.Abilities {
		compileAbilityDefinition(ability, path+".abilities["+itoa(j)+"]", uint16(providerIdx), ctx)
	}
	for j, listener := range provider.Listeners {
		compiledListener := compileListenerDefinition(listener, path+".listeners["+itoa(j)+"]", "", "", -1, ctx)
		ctx.session.Providers[providerIdx].Listeners = append(ctx.session.Providers[providerIdx].Listeners, compiledListener)
	}
	ctx.session.Providers[providerIdx].AbilityCount = uint16(len(ctx.session.Abilities)) - start
}

func compileAbilityDefinition(ability model.AbilityDefinition, path string, providerIndex uint16, ctx *genericCompileContext) {
	collector := ctx.collector
	session := ctx.session
	if ability.AbilityKey == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".abilityKey", "abilityKey is required", "")
		return
	}
	if ability.Kind == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".kind", "ability kind is required", ability.AbilityKey)
	}
	abilityIndex := len(session.Abilities)
	compiled := CompiledAbility{
		AbilityKey:     ability.AbilityKey,
		Kind:           ability.Kind,
		Params:         ability.Params,
		ProviderIndex:  providerIndex,
		OperationStart: uint16(len(session.Operations)),
	}
	if compiled.Params == nil {
		compiled.Params = map[string]float64{}
	}
	compiled.TypeSet = typeset.ValidateTypeKeys(ability.Types, typeset.EntityAbility, session.Types, path+".types", collector.addError)
	typeset.ValidateTypeKeys(ability.Tags, typeset.EntityAbility, session.Types, path+".tags", collector.addError)
	if ability.Cost != nil {
		if ability.Cost.ResourceKey == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".cost.resourceKey", "cost resourceKey is required", ability.AbilityKey)
		}
		instr := formula.CompileGenericFormula(ability.Cost.Amount, path+".cost.amount", ctx.namedFormulas, map[string]bool{}, collector.addError)
		cost := &CompiledAbilityCost{
			ResourceKey:  ability.Cost.ResourceKey,
			AllowPartial: ability.Cost.AllowPartial,
		}
		if len(instr) > 0 {
			key := path + ".cost.amount"
			cost.AmountProgram = ctx.registerFormula(key, instr)
			cost.HasAmount = true
		}
		compiled.Cost = cost
	}
	if ability.Cooldown != nil {
		instr := formula.CompileGenericFormula(ability.Cooldown.DurationMs, path+".cooldown.durationMs", ctx.namedFormulas, map[string]bool{}, collector.addError)
		cd := &CompiledAbilityCooldown{
			StartsOn: ability.Cooldown.StartsOn,
			GroupKey: ability.Cooldown.GroupKey,
		}
		if len(instr) > 0 {
			key := path + ".cooldown.durationMs"
			cd.DurationProgram = ctx.registerFormula(key, instr)
			cd.HasDuration = true
		}
		compiled.Cooldown = cd
	}
	for k, op := range ability.Operations {
		compileOperation(op, path+".operations["+itoa(k)+"]", ctx)
	}
	compiled.OperationCount = uint16(len(session.Operations)) - compiled.OperationStart
	if ability.TickSpec != nil {
		ts := ability.TickSpec
		if ts.IntervalMs <= 0 {
			collector.addError(model.GenericErrMissingRequiredField, path+".tickSpec.intervalMs", "tickSpec.intervalMs must be > 0", ability.AbilityKey)
		}
		tickSpec := &CompiledTickSpec{
			IntervalMs:   ts.IntervalMs,
			StartDelayMs: ts.StartDelayMs,
			OnTickStart:  uint16(len(session.Operations)),
		}
		for k, op := range ts.OnTick {
			compileOperation(op, path+".tickSpec.onTick["+itoa(k)+"]", ctx)
		}
		tickSpec.OnTickCount = uint16(len(session.Operations)) - tickSpec.OnTickStart
		if tickSpec.StartDelayMs <= 0 {
			tickSpec.StartDelayMs = tickSpec.IntervalMs
		}
		compiled.TickSpec = tickSpec
	} else if ability.Kind == "tick" {
		collector.addError(model.GenericErrMissingRequiredField, path+".tickSpec", "tick ability requires tickSpec", ability.AbilityKey)
	}
	session.Abilities = append(session.Abilities, compiled)

	if ability.ListenerSpec != nil {
		spec := *ability.ListenerSpec
		if spec.ListenerKey == "" {
			spec.ListenerKey = ability.AbilityKey
		}
		// Inline passive_listener: execution target is this ability's operations.
		inline := compileListenerDefinition(spec, path+".listenerSpec", "", "", abilityIndex, ctx)
		if ability.Kind == "passive_listener" && inline.OperationCount == 0 && compiled.OperationCount > 0 {
			inline.OperationStart = compiled.OperationStart
			inline.OperationCount = compiled.OperationCount
		}
		session.Providers[providerIndex].Listeners = append(session.Providers[providerIndex].Listeners, inline)
	} else if ability.Kind == "passive_listener" {
		collector.addError(model.GenericErrMissingRequiredField, path+".listenerSpec", "passive_listener requires listenerSpec", ability.AbilityKey)
	}
}

func compileRulesOperations(rules model.RulesContainer, ctx *genericCompileContext) {
	collector := ctx.collector
	session := ctx.session
	for i, op := range rules.Operations {
		compileOperation(op, "rules.operations["+itoa(i)+"]", ctx)
	}
	for i, modifier := range rules.Modifiers {
		path := "rules.modifiers[" + itoa(i) + "]"
		compiled := compileModifierDefinition(modifier, path, ctx)
		if compiled.Kind == "" {
			compiled.Kind = "attribute"
		}
		if compiled.Kind == "pipeline" {
			// P0: pipeline modifiers require command-pipeline integration; validate/retain only.
			session.RuleModifiers = append(session.RuleModifiers, compiled)
			continue
		}
		if compiled.Kind != "attribute" {
			collector.addError(model.GenericErrUnknownRef, path+".kind", "unsupported modifier kind", compiled.Kind)
			continue
		}
		if compiled.Target == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".target", "attribute modifier target is required", modifier.ModifierKey)
		}
		session.RuleModifiers = append(session.RuleModifiers, compiled)
	}
	for i, listener := range rules.Listeners {
		compiled := compileListenerDefinition(listener, "rules.listeners["+itoa(i)+"]", "", "", -1, ctx)
		session.Listeners = append(session.Listeners, compiled)
	}
}

func compileModifierDefinition(mod model.ModifierDefinition, path string, ctx *genericCompileContext) CompiledModifier {
	collector := ctx.collector
	compiled := CompiledModifier{
		ModifierKey: mod.ModifierKey,
		Kind:        mod.Kind,
		Target:      mod.Target,
		Command:     mod.Command,
		Channel:     mod.Channel,
		Bucket:      mod.Bucket,
		Stage:       mod.Stage,
		Priority:    mod.Priority,
		ValuePolicy: mod.ValuePolicy,
	}
	if mod.ModifierKey == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".modifierKey", "modifierKey is required", "")
	}
	if mod.ValuePolicy == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".valuePolicy", "valuePolicy is required", mod.ModifierKey)
	}
	instr := formula.CompileGenericFormula(mod.Value, path+".value", ctx.namedFormulas, map[string]bool{}, collector.addError)
	if len(instr) > 0 {
		key := path + ".value"
		compiled.ValueProgram = ctx.registerFormula(key, instr)
		compiled.HasValue = true
	}
	if mod.Condition != nil {
		condInstr := formula.CompileGenericFormula(*mod.Condition, path+".condition", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if len(condInstr) > 0 {
			key := path + ".condition"
			compiled.ConditionProg = ctx.registerFormula(key, condInstr)
			compiled.HasCondition = true
		}
	}
	return compiled
}

func compileProviderLifecycle(lc model.ProviderLifecycle, path string, ctx *genericCompileContext) *CompiledProviderLifecycle {
	collector := ctx.collector
	out := &CompiledProviderLifecycle{
		MaxStacks:      lc.MaxStacks,
		RefreshPolicy:  lc.RefreshPolicy,
		TickIntervalMs: lc.TickIntervalMs,
	}
	if lc.DurationMs != nil {
		instr := formula.CompileGenericFormula(*lc.DurationMs, path+".durationMs", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if len(instr) > 0 {
			key := path + ".durationMs"
			out.DurationProgram = ctx.registerFormula(key, instr)
			out.HasDuration = true
		}
	}
	if out.RefreshPolicy == "" {
		out.RefreshPolicy = "replace"
	}
	_ = collector
	return out
}

func compileListenerDefinition(listener model.ListenerDefinition, path, ownerCombatantKey, ownerProviderRef string, sourceAbilityIndex int, ctx *genericCompileContext) CompiledListener {
	collector := ctx.collector
	if sourceAbilityIndex < 0 {
		sourceAbilityIndex = -1
	}
	compiled := CompiledListener{
		ListenerKey:         listener.ListenerKey,
		MaxTriggersPerEvent: listener.MaxTriggersPerEvent,
		ChainLimitKey:       listener.ChainLimitKey,
		OwnerCombatantKey:   ownerCombatantKey,
		OwnerProviderRef:    ownerProviderRef,
		SourceAbilityIndex:  sourceAbilityIndex,
		OperationStart:      uint16(len(ctx.session.Operations)),
	}
	if compiled.MaxTriggersPerEvent <= 0 {
		compiled.MaxTriggersPerEvent = 1
	}
	if listener.ListenerKey == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".listenerKey", "listenerKey is required", "")
	}
	compiled.EventMatcher = typeset.CompileGenericMatcher(listener.EventMatcher, ctx.session.Types, typeset.EntityListener, path+".eventMatcher", collector.addError)
	if listener.AbilityRef != "" {
		compiled.HasAbilityRef = true
		compiled.AbilityRef = listener.AbilityRef
	}
	for i, op := range listener.Operations {
		compileOperation(op, path+".operations["+itoa(i)+"]", ctx)
	}
	compiled.OperationCount = uint16(len(ctx.session.Operations)) - compiled.OperationStart
	return compiled
}

func compileProviderListener(listener model.ListenerDefinition, path string, ctx *genericCompileContext) CompiledListener {
	return compileListenerDefinition(listener, path, "", "", -1, ctx)
}

func compileListener(listener model.ListenerDefinition, path string, ctx *genericCompileContext) {
	_ = compileListenerDefinition(listener, path, "", "", -1, ctx)
}

func (ctx *genericCompileContext) registerFormula(key string, instr []formula.GenericInstr) formula.GenericProgramID {
	session := ctx.session
	if id, exists := session.Formulas.Index[key]; exists {
		return id
	}
	id := formula.GenericProgramID(len(session.Formulas.Programs))
	session.Formulas.Index[key] = id
	session.Formulas.Programs = append(session.Formulas.Programs, formula.GenericProgram{Key: key, Instr: instr})
	return id
}

func compileOperation(op model.OperationDefinition, path string, ctx *genericCompileContext) {
	collector := ctx.collector
	session := ctx.session
	catalog := ctx.catalog
	if op.Operation == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".operation", "operation is required", "")
		return
	}
	if isForbiddenHPOperation(op.Operation) {
		collector.addError(model.GenericErrHPRawSetForbidden, path+".operation", "HP raw set is forbidden", op.Operation)
	}
	if op.Target == "" {
		collector.addError(model.GenericErrOperationTargetMissing, path+".target", "operation target is required", op.Operation)
	} else if _, ok := model.ValidCombatantSelectors[op.Target]; !ok && !strings.HasPrefix(op.Target, "source.") && !strings.HasPrefix(op.Target, "target.") {
		collector.addError(model.GenericErrOperationTargetMissing, path+".target", "unknown operation target", op.Target)
	}
	switch op.Operation {
	case "damage":
		if op.DamageType == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".damageType", "damage operation requires damageType", "")
		} else {
			typeset.ValidateTypeKeys([]string{op.DamageType}, typeset.EntityOperationDamageType, catalog, path+".damageType", collector.addError)
		}
		if op.Amount == nil {
			collector.addError(model.GenericErrMissingRequiredField, path+".amount", "damage operation requires amount", "")
		}
	case "heal", "shield", "resource_change", "attribute_change":
		if op.Amount == nil {
			collector.addError(model.GenericErrMissingRequiredField, path+".amount", op.Operation+" requires amount", "")
		}
	case "apply_provider":
		if op.ProviderDefinitionRef == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".providerDefinitionRef", "apply_provider requires providerDefinitionRef", "")
		}
	case "refresh_provider", "expire_provider":
		if op.ProviderRef == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".providerRef", op.Operation+" requires providerRef", "")
		}
	case "cooldown_change":
		if op.AbilityRef == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".abilityRef", "cooldown_change requires abilityRef", "")
		}
	case "state_change":
		if op.Ref == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".ref", "state_change requires ref state key", "")
		}
		if op.Amount == nil {
			collector.addError(model.GenericErrMissingRequiredField, path+".amount", "state_change requires amount", "")
		}
		if op.Target != "" && op.Target != model.SelectorSource && op.Target != model.SelectorSelf {
			collector.addError(model.GenericErrOperationTargetMissing, path+".target", "state_change target must be source or self", op.Target)
		}
		scope, scopeErr := resolveProviderStateScope(op.Types)
		if scopeErr != "" {
			collector.addError(model.GenericErrUnknownTypeKey, path+".types", scopeErr, strings.Join(op.Types, ","))
		}
		_ = scope
	}
	compiled := CompiledOperation{
		Operation:             op.Operation,
		Target:                op.Target,
		DamageType:            op.DamageType,
		ResourceKey:           op.ResourceKey,
		AttributeKey:          op.AttributeKey,
		ValuePolicy:           op.ValuePolicy,
		ProviderDefinitionRef: op.ProviderDefinitionRef,
		ProviderRef:           op.ProviderRef,
		ShieldRef:             op.ShieldRef,
		EventType:             op.EventType,
		Types:                 append([]string(nil), op.Types...),
	}
	if op.Operation == "state_change" {
		if scope, errMsg := resolveProviderStateScope(op.Types); errMsg == "" {
			compiled.StateScope = scope
		}
	}
	if op.Amount != nil {
		instr := formula.CompileGenericFormula(*op.Amount, path+".amount", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if len(instr) > 0 {
			key := path + ".amount"
			if _, exists := session.Formulas.Index[key]; !exists {
				session.Formulas.Index[key] = formula.GenericProgramID(len(session.Formulas.Programs))
				session.Formulas.Programs = append(session.Formulas.Programs, formula.GenericProgram{Key: key, Instr: instr})
			}
			compiled.AmountProgram = session.Formulas.Index[key]
			compiled.HasAmount = true
		}
	}
	if op.Condition != nil {
		instr := formula.CompileGenericFormula(*op.Condition, path+".condition", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if len(instr) > 0 {
			key := path + ".condition"
			compiled.ConditionProgram = ctx.registerFormula(key, instr)
			compiled.HasCondition = true
		}
	}
	if op.AbilityRef != "" {
		compiled.HasAbilityRef = true
		compiled.AbilityRefStr = op.AbilityRef
	}
	compiled.Ref = op.Ref
	if compiled.Ref == "" {
		compiled.Ref = op.EventType
	}
	session.Operations = append(session.Operations, compiled)
}

// resolveProviderStateScope extracts the single supported state_scope/* from operation types.
func resolveProviderStateScope(types []string) (scope string, errMsg string) {
	const (
		scopeProvider       = "state_scope/provider"
		scopeProviderTarget = "state_scope/provider_target"
	)
	var found string
	for _, t := range types {
		if strings.HasPrefix(t, "state_scope/") {
			if t != scopeProvider && t != scopeProviderTarget {
				return "", "unsupported state scope"
			}
			if found != "" && found != t {
				return "", "state_change requires a single state scope"
			}
			found = t
		}
	}
	if found == "" {
		return "", "state_change requires state_scope/provider or state_scope/provider_target"
	}
	return found, ""
}

func finalizeListenerIndex(ctx *genericCompileContext) {
	session := ctx.session
	// Bind provider-owned listeners to concrete combatant mounts and merge into session.Listeners.
	for _, combatant := range session.Combatants {
		for _, mount := range combatant.ProviderMounts {
			provider := session.Providers[mount.DefinitionIndex]
			for _, listener := range provider.Listeners {
				bound := listener
				bound.OwnerCombatantKey = combatant.Key
				bound.OwnerProviderRef = mount.ProviderRef
				session.Listeners = append(session.Listeners, bound)
			}
		}
	}
}

func buildAbilityRefIndex(ctx *genericCompileContext) {
	session := ctx.session
	combatantByKey := make(map[string]uint8, len(session.Combatants))
	for i, c := range session.Combatants {
		combatantByKey[c.Key] = uint8(i)
	}
	providerMounts := make(map[string]map[string]uint16)
	for _, combatant := range session.Combatants {
		mounts := make(map[string]uint16, len(combatant.ProviderMounts))
		for _, mount := range combatant.ProviderMounts {
			mounts[mount.ProviderRef] = mount.MountedProviderIndex
		}
		providerMounts[combatant.Key] = mounts
	}
	providerAbilityIndex := make(map[uint16]map[string]uint16)
	for providerIdx, provider := range session.Providers {
		start := provider.AbilityStart
		end := start + provider.AbilityCount
		index := make(map[string]uint16)
		for ai := start; ai < end && int(ai) < len(session.Abilities); ai++ {
			index[session.Abilities[ai].AbilityKey] = ai
		}
		providerAbilityIndex[uint16(providerIdx)] = index
	}
	ctx.providerAbilityIndex = providerAbilityIndex
	ctx.combatantByKey = combatantByKey
	ctx.providerMounts = providerMounts

	for _, combatant := range session.Combatants {
		for _, mount := range combatant.ProviderMounts {
			provider := session.Providers[mount.DefinitionIndex]
			start := provider.AbilityStart
			end := start + provider.AbilityCount
			for ai := start; ai < end && int(ai) < len(session.Abilities); ai++ {
				ability := session.Abilities[ai]
				ref := combatant.Key + ".provider[" + mount.ProviderRef + "].ability[" + ability.AbilityKey + "]"
				if compiled, ok := ctx.resolveAbilityRef(ref, ""); ok {
					session.AbilityRefIndex[ref] = compiled
				}
			}
		}
	}
}

func (ctx *genericCompileContext) resolveAbilityRef(abilityRef, path string) (CompiledAbilityRef, bool) {
	collector := ctx.collector
	session := ctx.session
	parsed, ok := ParseAbilityRef(abilityRef)
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "invalid abilityRef format", abilityRef)
		}
		return CompiledAbilityRef{}, false
	}
	combatantKey := parsed.Combatant
	if combatantKey == model.SelectorSelf || combatantKey == model.SelectorOpponent {
		// self/opponent cannot be bound to a concrete combatant at compile time.
		// Validate that providerRef+abilityKey exist on at least one combatant mount.
		if path != "" && !ctx.abilityExistsOnAnyCombatant(parsed.ProviderRef, parsed.AbilityKey) {
			collector.addError(model.GenericErrUnknownRef, path, "unknown providerRef/abilityKey in abilityRef", abilityRef)
		}
		return CompiledAbilityRef{}, false
	}
	ci, ok := ctx.combatantByKey[combatantKey]
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "unknown combatant in abilityRef", abilityRef)
		}
		return CompiledAbilityRef{}, false
	}
	mounts, ok := ctx.providerMounts[combatantKey]
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "combatant has no provider mounts", abilityRef)
		}
		return CompiledAbilityRef{}, false
	}
	mountIdx, ok := mounts[parsed.ProviderRef]
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "unknown providerRef in abilityRef", abilityRef)
		}
		return CompiledAbilityRef{}, false
	}
	mount := session.Combatants[ci].ProviderMounts[mountIdx]
	abilityMap := ctx.providerAbilityIndex[mount.DefinitionIndex]
	ai, ok := abilityMap[parsed.AbilityKey]
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "unknown abilityKey in abilityRef", abilityRef)
		}
		return CompiledAbilityRef{}, false
	}
	return CompiledAbilityRef{
		CombatantIndex: ci,
		ProviderIndex:  mount.DefinitionIndex,
		AbilityIndex:   ai,
	}, true
}

func (ctx *genericCompileContext) abilityExistsOnAnyCombatant(providerRef, abilityKey string) bool {
	session := ctx.session
	for _, combatant := range session.Combatants {
		mounts := ctx.providerMounts[combatant.Key]
		mountIdx, ok := mounts[providerRef]
		if !ok {
			continue
		}
		mount := combatant.ProviderMounts[mountIdx]
		abilityMap := ctx.providerAbilityIndex[mount.DefinitionIndex]
		if _, ok := abilityMap[abilityKey]; ok {
			return true
		}
	}
	return false
}

func findProviderIndex(session *CompiledSession, providerKey string) (int, bool) {
	for i, provider := range session.Providers {
		if provider.ProviderKey == providerKey {
			return i, true
		}
	}
	return 0, false
}

func normalizeGenericSettings(settings model.GenericCompileSettings, collector *genericCollector) model.GenericCompileSettings {
	if settings.MaxEvents <= 0 {
		settings.MaxEvents = defaultGenericMaxEvents
	} else if settings.MaxEvents > defaultGenericMaxEvents {
		requested := settings.MaxEvents
		settings.MaxEvents = defaultGenericMaxEvents
		collector.addWarning(
			model.WarningCodeCompileSettingCapped,
			"settings.maxEvents",
			"maxEvents capped to compile limit",
			itoa(requested),
			itoa(defaultGenericMaxEvents),
		)
	}
	if settings.MaxCommandsPerEvent <= 0 {
		settings.MaxCommandsPerEvent = defaultGenericMaxCommandsPerEvent
	}
	return settings
}

func isForbiddenHPOperation(op string) bool {
	switch strings.ToLower(op) {
	case "set_hp_raw", "hp_raw_set", "sethpraw", "hp_set_raw":
		return true
	default:
		return false
	}
}

// ParsedAbilityRef 是解析后的 abilityRef 组件。
type ParsedAbilityRef struct {
	Combatant   string
	ProviderRef string
	AbilityKey  string
}

// ParseAbilityRef 解析 canonical abilityRef 字符串。
func ParseAbilityRef(ref string) (ParsedAbilityRef, bool) {
	matches := abilityRefPattern.FindStringSubmatch(ref)
	if len(matches) != 4 {
		return ParsedAbilityRef{}, false
	}
	return ParsedAbilityRef{
		Combatant:   matches[1],
		ProviderRef: matches[2],
		AbilityKey:  matches[3],
	}, true
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	var buf [12]byte
	pos := len(buf)
	n := v
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
