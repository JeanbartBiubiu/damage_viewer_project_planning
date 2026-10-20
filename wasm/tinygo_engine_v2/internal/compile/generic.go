package compile

import (
	"strings"
	"tinygo_engine_v2/internal/attribute"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/typeset"
)

const (
	defaultGenericMaxEvents           = 100000
	defaultGenericMaxCommandsPerEvent = 256
)

// GenericCompileResult 是 CompileGeneric 的返回值。
type GenericCompileResult struct {
	OK      bool
	Session plan.CompiledSession
	Result  model.CompileResult
}

type genericCompileContext struct {
	currentSkillKey      string
	currentProcess       *plan.CompiledProcess
	currentProcessMoment *model.ProcessMomentDefinition
	collector            *genericCollector
	session              *plan.CompiledSession
	catalog              typeset.CatalogResult
	namedFormulas        map[string]model.GenericFormulaExpr
	providerKeyIndex     map[string]uint16
	combatantByKey       map[string]uint8
	providerMounts       map[string]map[string]uint16
	providerAbilityIndex map[uint16]map[string]uint16
	healGroupModes       map[string]healGroupModeSeen
	currentListener      *model.ListenerDefinition
	outputUnitRefs       map[string]int
	outputUnitIndex      int
	compilingBasicAttack bool
}

type healGroupModeSeen struct {
	mode string
	path string
}

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
	session := plan.CompiledSession{
		SchemaVersion:   req.SchemaVersion,
		SchemaHash:      req.SchemaHash,
		RulesHash:       req.RulesHash,
		Types:           catalog,
		RuntimeTypes:    BindRuntimeTypes(catalog.Registry),
		AbilityRefIndex: make(map[string]plan.CompiledAbilityRef),
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
		namedFormulas:    make(map[string]model.GenericFormulaExpr),
		providerKeyIndex: make(map[string]uint16),
		healGroupModes:   make(map[string]healGroupModeSeen),
	}

	var attributeKeys []string
	for _, key := range catalog.Registry.Keys {
		if _, ok := catalog.Registry.LookupDomain("attribute", key); ok {
			attributeKeys = append(attributeKeys, key)
		}
	}
	formula.CompileDeclaredNamedFormulas(req.Formulas, attributeKeys, &session.Formulas, collector.addError)
	ctx.namedFormulas = session.Formulas.DeclaredReferences()
	compileVampRules(req.Rules.VampRules, req.Combatants, ctx)
	compileDamageTypeFormulas(req.Rules.DamageTypeFormulas, ctx)
	for i, provider := range req.SharedProviders {
		compileProviderDefinition(provider, "sharedProviders["+itoa(i)+"]", ctx)
	}
	for i, provider := range req.SharedProviders {
		compileProviderAbilities(provider, "sharedProviders["+itoa(i)+"]", ctx)
	}
	for i, provider := range req.SharedProviders {
		compileProviderProcesses(provider, "sharedProviders["+itoa(i)+"]", ctx)
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
		compiled := plan.CompiledCombatant{
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
			compiled.ProviderMounts = append(compiled.ProviderMounts, plan.CompiledProviderMount{
				ProviderRef:          mount.ProviderRef,
				DefinitionIndex:      defIdx,
				MountedProviderIndex: uint16(len(compiled.ProviderMounts)),
			})
		}
		session.Combatants = append(session.Combatants, compiled)
	}

	compileRulesOperations(req.Rules, ctx)
	compileAttributeDerivations(req.Rules.AttributeDerivations, ctx)
	buildAbilityRefIndex(ctx)
	compileSkillActionBindings(req.Rules.SkillActionBindings, ctx)
	finalizeAttackDamageRoles(ctx)
	finalizeProcessStartStateReads(ctx)
	finalizeDynamicModifiers(ctx)
	validateProcessAbilityRefs(req, ctx)
	validateAllAbilityRefs(req, ctx)
	finalizeShieldLifecycleBindings(req, ctx)
	finalizeParticipationProviderBindings(ctx)
	finalizeSkillHitPersistentAttributeProviders(ctx)
	finalizeProviderDurationChanges(ctx)
	finalizeOwnedHealthModifiers(ctx)
	validateProviderElapsedReads(ctx)
	finalizeListenerIndex(ctx)
	compileAmmoBindings(ctx)
	validateMechanicFormulaContexts(ctx)
	if len(session.Operations) > 65535 {
		collector.addError(model.GenericErrRuntimeInvariantFailed, "operations", "compiled operations exceed supported index range", "")
	}
	approvedStatic := make(map[string]float64)
	for i, program := range session.Formulas.Programs {
		if !program.DeclaredNamed || len(session.Formulas.ReadDependencies(formula.GenericProgramID(i))) != 0 {
			continue
		}
		value, err := session.Formulas.Eval(formula.GenericProgramID(i), formula.GenericEvalContext{})
		if err != nil {
			if authored, ok := err.(*formula.AuthoredEvaluationError); ok {
				collector.addError(model.GenericErrCode(authored.Issue.Code), authored.DefinitionPath+authored.Issue.Path, authored.Error(), authored.ProgramKey)
			} else {
				collector.addError(model.GenericErrFormulaTypeError, program.Key, err.Error(), program.Key)
			}
			continue
		}
		approvedStatic[program.Key] = value
	}

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
		ApprovedStaticValues: approvedStatic,
		CombatantCount:       len(session.Combatants),
		ProviderCount:        len(session.Providers),
		AbilityCount:         len(session.Abilities),
		TypeCount:            len(session.Types.Registry.Keys),
		FormulaCount:         len(session.Formulas.Programs),
	}
	// 编号只由成功编译后的属性目录与实际槽生成；运行扩展只追加。
	keys := append([]string(nil), attributeKeys...)
	for _, actor := range session.Combatants {
		for key := range actor.Attributes {
			keys = append(keys, key)
		}
	}
	session.AttributeLayout = attribute.NewLayout(keys)
	session.Formulas.BindAttributeLayout(session.AttributeLayout)
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
	previousSkill := ctx.currentSkillKey
	ctx.currentSkillKey = provider.SkillKey
	defer func() { ctx.currentSkillKey = previousSkill }()
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
	compiled := plan.CompiledProvider{
		ShieldDefinitionRef: provider.LinkedShieldDefinitionRef,
		SkillKey:            provider.SkillKey,
		ProviderKey:         provider.ProviderKey,
		Kind:                provider.Kind,
		StableID:            provider.StableID,
		AbilityStart:        uint16(len(session.Abilities)),
	}
	compiled.TypeSet = typeset.ValidateTypeKeys(provider.Types, typeset.EntityProvider, session.Types, path+".types", collector.addError)
	typeset.ValidateTypeKeys(provider.Tags, typeset.EntityProvider, session.Types, path+".tags", collector.addError)
	for j, mod := range provider.Modifiers {
		modifier := compileModifierDefinition(mod, path+".modifiers["+itoa(j)+"]", ctx)
		if provider.Kind == "status" && provider.Lifecycle == nil && len(provider.Abilities)+len(provider.Listeners)+len(provider.Processes)+len(provider.InitialStateSchema)+len(provider.StatusContributions) == 0 {
			modifier.OwnedHealthReads = ownsAuthoredHealthReads(modifier, ctx)
		}
		compiled.Modifiers = append(compiled.Modifiers, modifier)
	}
	if provider.Lifecycle != nil {
		compiled.Lifecycle = compileProviderLifecycle(*provider.Lifecycle, path+".lifecycle", ctx)
	}
	if compiled.Lifecycle != nil && compiled.Lifecycle.HasDuration {
		for _, mod := range compiled.Modifiers {
			if mod.Kind == "attribute" && mod.Stage == "total" && mod.ValuePolicy == "multiply" {
				compiled.NeedsModifierExpiry, session.HasFiniteModifierExpiry = true, true
			}
		}
	}
	compiled.StatusContributions = compileStatusContributions(provider.StatusContributions, path+".statusContributions", ctx)
	validateProviderStatusLifecycle(provider, compiled, path, collector)
	stateSchema := ctx.freezeStateSchema(provider.InitialStateSchema, path+".initialStateSchema")
	compiled.StateFields = compileInitialStateSchema(stateSchema, path+".initialStateSchema", collector)
	compileProviderStateKinds(stateSchema, compiled.StateFields, path+".initialStateSchema", ctx)
	session.Providers = append(session.Providers, compiled)
}

func compileProviderAbilities(provider model.ProviderDefinition, path string, ctx *genericCompileContext) {
	previousSkill := ctx.currentSkillKey
	ctx.currentSkillKey = provider.SkillKey
	defer func() { ctx.currentSkillKey = previousSkill }()
	providerIdx, ok := findProviderIndex(ctx.session, provider.ProviderKey)
	if !ok {
		return
	}
	start := uint16(len(ctx.session.Abilities))
	ctx.session.Providers[providerIdx].AbilityStart = start
	for j, ability := range provider.Abilities {
		compileAbilityDefinition(ability, path+".abilities["+itoa(j)+"]", uint16(providerIdx), ctx)
	}
	for j, listener := range provider.Listeners {
		compiledListener := compileListenerDefinition(listener, path+".listeners["+itoa(j)+"]", "", "", -1, providerIdx, ctx)
		ctx.session.Providers[providerIdx].Listeners = append(ctx.session.Providers[providerIdx].Listeners, compiledListener)
	}
	ctx.session.Providers[providerIdx].AbilityCount = uint16(len(ctx.session.Abilities)) - start
}

func compileAbilityDefinition(ability model.AbilityDefinition, path string, providerIndex uint16, ctx *genericCompileContext) {
	previousSkill := ctx.currentSkillKey
	ctx.currentSkillKey = ability.SkillKey
	if ability.SkillKey != "" {
		if previousSkill != "" && previousSkill != ability.SkillKey {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".skillKey", "ability skill must match its provider", ability.SkillKey)
		}
		ctx.currentSkillKey = ability.SkillKey
	}
	defer func() { ctx.currentSkillKey = previousSkill }()
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
	compiled := plan.CompiledAbility{
		AbilityKey:     ability.AbilityKey,
		Kind:           ability.Kind,
		Params:         ability.Params,
		ProviderIndex:  providerIndex,
		OperationStart: uint16(len(session.Operations)),
	}
	if compiled.Params == nil {
		compiled.Params = map[string]float64{}
	}
	if ability.CastOrigin != "" {
		if _, ok := model.ValidCastOrigins[ability.CastOrigin]; !ok {
			collector.addError(model.GenericErrUnknownRef, path+".castOrigin", "invalid castOrigin", ability.CastOrigin)
		} else {
			compiled.CastOrigin = ability.CastOrigin
		}
	}
	compiled.TypeSet = typeset.ValidateTypeKeys(ability.Types, typeset.EntityAbility, session.Types, path+".types", collector.addError)
	typeset.ValidateTypeKeys(ability.Tags, typeset.EntityAbility, session.Types, path+".tags", collector.addError)
	if id, ok := session.Types.Registry.LookupDomain("ability", model.AbilityTypeBasicAttack); ok && compiled.TypeSet.Contains(id) {
		compiled.IsBasicAttack = true
	}
	compiled.SkillKey = strings.TrimSpace(ability.SkillKey)
	if ability.Cost != nil {
		if ability.Cost.ResourceKey == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".cost.resourceKey", "cost resourceKey is required", ability.AbilityKey)
		}
		instr := formula.CompileGenericFormula(ability.Cost.Amount, path+".cost.amount", ctx.namedFormulas, map[string]bool{}, collector.addError)
		cost := &plan.CompiledAbilityCost{
			ResourceKey:  ability.Cost.ResourceKey,
			AllowPartial: ability.Cost.AllowPartial,
		}
		if len(instr) > 0 {
			key := path + ".cost.amount"
			cost.AmountProgram, cost.HasAmount = ctx.registerFormula(key, instr)
		}
		compiled.Cost = cost
	}
	if ability.Cooldown != nil {
		instr := formula.CompileGenericFormula(ability.Cooldown.DurationMs, path+".cooldown.durationMs", ctx.namedFormulas, map[string]bool{}, collector.addError)
		cd := &plan.CompiledAbilityCooldown{
			StartsOn: ability.Cooldown.StartsOn,
			GroupKey: ability.Cooldown.GroupKey,
		}
		if len(instr) > 0 {
			key := path + ".cooldown.durationMs"
			cd.DurationProgram, cd.HasDuration = ctx.registerFormula(key, instr)
		}
		compiled.Cooldown = cd
	}
	if ability.CastCondition != nil {
		instr := formula.CompileGenericFormula(*ability.CastCondition, path+".castCondition", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if len(instr) > 0 {
			key := path + ".castCondition"
			compiled.CastConditionProgram, compiled.HasCastCondition = ctx.registerFormula(key, instr)
		}
	}
	compiled.OperationStart = uint16(len(session.Operations))
	if skillHitOp, ok := uniqueResolveSkillHit(ability.Operations); ok {
		if ability.Kind != "active" {
			collector.addError(model.GenericErrUnknownRef, path+".kind", "resolve_skill_hit requires an active ability", ability.AbilityKey)
		}
		if len(ability.Operations) != 1 {
			collector.addError(model.GenericErrUnknownRef, path+".operations", "hit ability operations must be exactly one resolve_skill_hit", ability.AbilityKey)
		}
		if ability.TickSpec != nil {
			collector.addError(model.GenericErrUnknownRef, path+".tickSpec", "resolve_skill_hit cannot mix tickSpec", ability.AbilityKey)
		}
		compileSkillHitAbility(ability, skillHitOp, path, int(providerIndex), ctx)
		if idx := lastSkillHitOperationIndex(session); idx >= 0 {
			compiled.OperationStart = uint16(idx)
			compiled.OperationCount = 1
			compiled.HasSkillHit = true
			compiled.SkillHitSkillKey = skillHitOp.SkillHit.SkillKey
			if compiled.SkillKey == "" {
				compiled.SkillKey = compiled.SkillHitSkillKey
			} else if compiled.SkillKey != compiled.SkillHitSkillKey {
				collector.addError(model.GenericErrUnknownRef, path+".skillKey", "ability.skillKey must equal skillHit.skillKey", ability.AbilityKey)
			}
		}
	} else {
		ctx.beginOutputUnit()
		for k, op := range ability.Operations {
			if op.Operation == model.OperationKindResolveSkillHit {
				collector.addError(model.GenericErrUnknownRef, path+".operations["+itoa(k)+"]", "resolve_skill_hit must be the unique operation on an active hit ability", ability.AbilityKey)
			}
			compileOperation(op, path+".operations["+itoa(k)+"]", int(providerIndex), ctx)
			ctx.outputUnitIndex++
		}
		ctx.endOutputUnit()
		compiled.OperationCount = uint16(len(session.Operations)) - compiled.OperationStart
	}
	if ability.TickSpec != nil {
		ts := ability.TickSpec
		if ts.IntervalMs <= 0 {
			collector.addError(model.GenericErrMissingRequiredField, path+".tickSpec.intervalMs", "tickSpec.intervalMs must be > 0", ability.AbilityKey)
		}
		if ts.StartDelayMs < 0 {
			collector.addError(model.GenericErrMissingRequiredField, path+".tickSpec.startDelayMs", "tickSpec.startDelayMs must be >= 0", ability.AbilityKey)
		}
		tickSpec := &plan.CompiledTickSpec{
			IntervalMs:   ts.IntervalMs,
			StartDelayMs: ts.StartDelayMs,
			OnTickStart:  uint16(len(session.Operations)),
		}
		ctx.beginOutputUnit()
		for k, op := range ts.OnTick {
			compileOperation(op, path+".tickSpec.onTick["+itoa(k)+"]", int(providerIndex), ctx)
			ctx.outputUnitIndex++
		}
		ctx.endOutputUnit()
		tickSpec.OnTickCount = uint16(len(session.Operations)) - tickSpec.OnTickStart
		// Anchor pair validation must run before ordinary startDelayMs defaulting.
		anchorScope := ts.AnchorScope
		anchorKey := ts.AnchorStateKey
		hasScope := anchorScope != ""
		hasKey := anchorKey != ""
		switch {
		case hasScope && !hasKey:
			collector.addError(model.GenericErrMissingRequiredField, path+".tickSpec.anchorStateKey", "tickSpec.anchorStateKey required when anchorScope is set", ability.AbilityKey)
		case hasKey && !hasScope:
			collector.addError(model.GenericErrMissingRequiredField, path+".tickSpec.anchorScope", "tickSpec.anchorScope required when anchorStateKey is set", ability.AbilityKey)
		case hasScope && hasKey:
			if ability.Kind != "tick" {
				collector.addError(model.GenericErrMissingRequiredField, path+".kind", "anchored tickSpec requires tick ability", ability.AbilityKey)
			}
			if anchorScope != "state_scope/provider_target" {
				collector.addError(model.GenericErrUnknownTypeKey, path+".tickSpec.anchorScope", "tickSpec.anchorScope must be state_scope/provider_target", ability.AbilityKey)
			}
			if ts.StartDelayMs != 0 {
				collector.addError(model.GenericErrMissingRequiredField, path+".tickSpec.startDelayMs", "anchored tickSpec requires startDelayMs omitted or 0", ability.AbilityKey)
			}
			providerFields := session.Providers[providerIndex].StateFields
			field, fieldOK := providerFields[anchorKey]
			if !fieldOK {
				collector.addError(model.GenericErrUnknownRef, path+".tickSpec.anchorStateKey", "tickSpec.anchorStateKey not found in provider initialStateSchema", ability.AbilityKey)
			} else if field.DurationMs <= 0 {
				collector.addError(model.GenericErrMissingRequiredField, path+".tickSpec.anchorStateKey", "anchored tickSpec requires anchor state durationMs > 0", ability.AbilityKey)
			} else if field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
				collector.addError(model.GenericErrMissingRequiredField, path+".tickSpec.anchorStateKey", "anchored tickSpec requires anchor state refresh_on_write", ability.AbilityKey)
			}
			tickSpec.AnchorScope = anchorScope
			tickSpec.AnchorStateKey = anchorKey
			// Anchored mode: startDelay remains 0 (do not default to intervalMs).
			tickSpec.StartDelayMs = 0
		default:
			if tickSpec.StartDelayMs <= 0 {
				tickSpec.StartDelayMs = tickSpec.IntervalMs
			}
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
		if spec.OncePerUse != nil && len(spec.Operations) == 0 {
			validateOncePerUseOperations(ability.Operations, path+".operations", ctx)
		}
		inline := compileListenerDefinition(spec, path+".listenerSpec", "", "", abilityIndex, int(providerIndex), ctx)
		if ability.Kind == "passive_listener" && inline.OperationCount == 0 && compiled.OperationCount > 0 {
			inline.OperationStart = compiled.OperationStart
			inline.OperationCount = compiled.OperationCount
		}
		session.Providers[providerIndex].Listeners = append(session.Providers[providerIndex].Listeners, inline)
	} else if ability.Kind == "passive_listener" {
		collector.addError(model.GenericErrMissingRequiredField, path+".listenerSpec", "passive_listener requires listenerSpec", ability.AbilityKey)
	}
	validateVampAbilityInputs(ability, compiled, path, ctx)
}

func compileRulesOperations(rules model.RulesContainer, ctx *genericCompileContext) {
	collector := ctx.collector
	session := ctx.session
	ctx.beginOutputUnit()
	for i, op := range rules.Operations {
		if len(session.VampRules) > 0 && op.Operation == "damage" {
			collector.addError(model.GenericErrMissingRequiredField, "rules.operations["+itoa(i)+"]", "vamp damage requires a declared owning ability", op.Ref)
		}
		compileOperation(op, "rules.operations["+itoa(i)+"]", -1, ctx)
		ctx.outputUnitIndex++
	}
	ctx.endOutputUnit()
	for i, modifier := range rules.Modifiers {
		path := "rules.modifiers[" + itoa(i) + "]"
		compiled := compileModifierDefinition(modifier, path, ctx)
		if compiled.Kind == "" {
			compiled.Kind = "attribute"
		}
		if compiled.Kind == "pipeline" {
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
		compiled := compileListenerDefinition(listener, "rules.listeners["+itoa(i)+"]", "", "", -1, -1, ctx)
		session.Listeners = append(session.Listeners, compiled)
	}
}

func validateDamageParticipantReadContext(instr []formula.GenericInstr, mod model.ModifierDefinition, path string, collector *genericCollector) {
	if mod.Kind == "pipeline" && (mod.Command == "damage" || mod.Command == "crit") {
		return
	}
	for _, item := range instr {
		if item.Op == formula.GenericOpRead && item.ReadKind == formula.ReadDamageSelf {
			collector.addError(model.GenericErrFormulaTypeError, path, "damage.self requires a damage or crit pipeline modifier", model.FormulaPathDamageSelf)
			return
		}
	}
}

func compileModifierDefinition(mod model.ModifierDefinition, path string, ctx *genericCompileContext) plan.CompiledModifier {
	collector := ctx.collector
	compiled := plan.CompiledModifier{
		ModifierKey:              mod.ModifierKey,
		Kind:                     mod.Kind,
		Target:                   mod.Target,
		Command:                  mod.Command,
		Channel:                  mod.Channel,
		Bucket:                   mod.Bucket,
		Stage:                    mod.Stage,
		Priority:                 mod.Priority,
		ValuePolicy:              mod.ValuePolicy,
		CurrentValuePolicy:       mod.CurrentValuePolicy,
		HealDirection:            mod.HealDirection,
		HealCategory:             mod.HealCategory,
		HealGroupKey:             mod.HealGroupKey,
		HealGroupCalculationMode: mod.HealGroupCalculationMode,
	}
	if mod.AffectedAbilityRefs != nil {
		compiled.HasAffectedAbilityRefs = true
		compiled.AffectedAbilityRefs = append([]string{}, (*mod.AffectedAbilityRefs)...)
	}
	if mod.CurrentValuePolicy != "" && mod.Kind != "resource_max" {
		collector.addError(model.GenericErrUnknownRef, path+".currentValuePolicy", "currentValuePolicy requires resource_max", mod.ModifierKey)
	}
	if mod.AffectedAbilityRefs != nil && mod.Kind != "cooldown_duration" {
		collector.addError(model.GenericErrUnknownRef, path+".affectedAbilityRefs", "affectedAbilityRefs requires cooldown_duration", mod.ModifierKey)
	}
	if (compiled.Kind == "attribute" || compiled.Kind == "") && compiled.ValuePolicy == "add_percent" {
		compiled.ValuePolicy = "percent_add"
	}
	if mod.ModifierKey == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".modifierKey", "modifierKey is required", "")
	}
	if mod.ValuePolicy == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".valuePolicy", "valuePolicy is required", mod.ModifierKey)
	}
	if mod.ValuePolicy == "complement_multiply" && (mod.Kind != "attribute" || mod.Stage != "total") {
		collector.addError(model.GenericErrUnknownRef, path+".valuePolicy", "complement multiplication requires an attribute modifier at total stage", mod.ModifierKey)
	}
	instr := formula.CompileGenericFormula(mod.Value, path+".value", ctx.namedFormulas, map[string]bool{}, collector.addError)
	validateDamagePredicateReads(ctx.session.Formulas.InstructionDependencies(instr, nil), path+".value", ctx.catalog, collector.addError)
	validateDamageParticipantReadContext(ctx.session.Formulas.InstructionDependencies(instr, nil), mod, path+".value", collector)
	if len(instr) > 0 {
		key := path + ".value"
		compiled.ValueProgram, compiled.HasValue = ctx.registerFormula(key, instr)
	}
	if mod.ValuePolicy == "complement_multiply" && compiled.HasValue {
		if value, static := ctx.session.Formulas.FoldStatic(compiled.ValueProgram); static && (value < 0 || value > 1) {
			collector.addError(model.GenericErrFormulaTypeError, path+".value", "complement ratio must be in [0,1]", mod.ModifierKey)
		}
	}
	if mod.Condition != nil {
		condInstr := formula.CompileGenericFormula(*mod.Condition, path+".condition", ctx.namedFormulas, map[string]bool{}, collector.addError)
		validateDamagePredicateReads(ctx.session.Formulas.InstructionDependencies(condInstr, nil), path+".condition", ctx.catalog, collector.addError)
		validateDamageParticipantReadContext(ctx.session.Formulas.InstructionDependencies(condInstr, nil), mod, path+".condition", collector)
		if len(condInstr) > 0 {
			key := path + ".condition"
			compiled.ConditionProg, compiled.HasCondition = ctx.registerFormula(key, condInstr)
		}
	}
	if compiled.Kind == "pipeline" {
		validatePipelineModifier(compiled, path, collector)
		if compiled.Command == "heal" {
			compiled.HealGroupCalculationMode = normalizeHealGroupMode(compiled.HealGroupCalculationMode)
			if compiled.HealGroupCalculationMode == model.HealGroupRatioAdd || compiled.HealGroupCalculationMode == model.HealGroupRatioMax {
				ctx.noteHealGroupMode(compiled.HealGroupKey, compiled.HealGroupCalculationMode, path)
			}
		} else if compiled.HealGroupCalculationMode != "" {
			collector.addError(model.GenericErrUnknownRef, path+".healGroupCalculationMode", "healGroupCalculationMode requires command=heal", mod.ModifierKey)
		}
	} else if mod.HealDirection != "" || mod.HealCategory != "" || mod.HealGroupKey != "" || mod.HealGroupCalculationMode != "" {
		collector.addError(model.GenericErrUnknownRef, path, "heal fields require kind=pipeline and command=heal", mod.ModifierKey)
	}
	return compiled
}

// validatePipelineModifier collects errors for unsupported pipeline vocabulary.
// command=damage stages: outgoing_pre_mitigation|incoming_crit_part_post_mitigation|incoming_post_mitigation
// command=crit stages: crit_chance_pre_settlement|crit_multiplier_forced_branch|crit_multiplier_natural_branch
// Channels: basic_damage|all_damage. Buckets: all_instances|first_per_cast.
func validatePipelineModifier(mod plan.CompiledModifier, path string, collector *genericCollector) {
	if mod.Command == "shield" {
		if mod.Channel != "normal_shield" || mod.Stage != "received" || mod.Bucket == "" || mod.ValuePolicy != "add_percent" || !mod.HasValue || mod.HealDirection != "" || mod.HealCategory != "" || mod.HealGroupKey != "" || mod.HealGroupCalculationMode != "" {
			collector.addError(model.GenericErrUnknownRef, path, "shield modifiers require normal_shield/received, an explicit group and add_percent", mod.ModifierKey)
		}
		return
	}
	if mod.Command == "heal" {
		validateHealPipelineModifier(mod, path, collector)
		return
	}
	if mod.HealDirection != "" || mod.HealCategory != "" || mod.HealGroupKey != "" || mod.HealGroupCalculationMode != "" {
		collector.addError(model.GenericErrUnknownRef, path, "heal fields require command=heal", mod.ModifierKey)
	}
	switch mod.Channel {
	case "basic_damage", "all_damage":
	default:
		collector.addError(model.GenericErrUnknownRef, path+".channel", "unsupported pipeline modifier channel", mod.Channel)
	}
	switch mod.Bucket {
	case "all_instances", "first_per_cast":
	default:
		collector.addError(model.GenericErrUnknownRef, path+".bucket", "unsupported pipeline modifier bucket", mod.Bucket)
	}
	if !mod.HasValue {
		collector.addError(model.GenericErrMissingRequiredField, path+".value", "pipeline modifier value is required", mod.ModifierKey)
	}
	switch mod.Command {
	case "damage":
		validateDamagePipelineModifier(mod, path, collector)
	case "crit":
		validateCritPipelineModifier(mod, path, collector)
	default:
		collector.addError(model.GenericErrUnknownRef, path+".command", "unsupported pipeline modifier command", mod.Command)
	}
}

func validateDamagePipelineModifier(mod plan.CompiledModifier, path string, collector *genericCollector) {
	switch mod.Stage {
	case "outgoing_pre_mitigation", "incoming_post_mitigation":
		switch mod.ValuePolicy {
		case "multiply", "override", "subtract":
		default:
			collector.addError(model.GenericErrUnknownRef, path+".valuePolicy", "unsupported pipeline modifier valuePolicy", mod.ValuePolicy)
		}
	case "incoming_crit_part_post_mitigation":
		switch mod.ValuePolicy {
		case "multiply", "override":
		default:
			collector.addError(model.GenericErrUnknownRef, path+".valuePolicy", "unsupported pipeline modifier valuePolicy", mod.ValuePolicy)
		}
	default:
		collector.addError(model.GenericErrUnknownRef, path+".stage", "unsupported pipeline modifier stage", mod.Stage)
	}
}

func validateCritPipelineModifier(mod plan.CompiledModifier, path string, collector *genericCollector) {
	switch mod.Stage {
	case "crit_chance_pre_settlement", "crit_multiplier_forced_branch", "crit_multiplier_natural_branch":
	default:
		collector.addError(model.GenericErrUnknownRef, path+".stage", "unsupported pipeline modifier stage", mod.Stage)
	}
	switch mod.ValuePolicy {
	case "multiply", "override":
	default:
		collector.addError(model.GenericErrUnknownRef, path+".valuePolicy", "unsupported pipeline modifier valuePolicy", mod.ValuePolicy)
	}
}

func compileProviderLifecycle(lc model.ProviderLifecycle, path string, ctx *genericCompileContext) *plan.CompiledProviderLifecycle {
	collector := ctx.collector
	maxStacks, _ := ctx.freezeStatic(lc.MaxStacks, path+".maxStacks", true)
	tickInterval, _ := ctx.freezeStatic(lc.TickIntervalMs, path+".tickIntervalMs", true)
	if !validStateInteger(maxStacks) || maxStacks < 0 || maxStacks > 2147483647 {
		collector.addError(model.GenericErrFormulaTypeError, path+".maxStacks", "maxStacks must be a non-negative safe integer", "")
	}
	if !validStateInteger(tickInterval) || tickInterval < 0 {
		collector.addError(model.GenericErrFormulaTypeError, path+".tickIntervalMs", "tickIntervalMs must be a non-negative safe integer", "")
	}
	out := &plan.CompiledProviderLifecycle{
		MaxStacks:      int(maxStacks),
		RefreshPolicy:  lc.RefreshPolicy,
		TickIntervalMs: int64(tickInterval),
		InstanceScope:  lc.InstanceScope,
		DurationPath:   path + ".durationMs",
	}
	if lc.DurationMs != nil {
		instr := formula.CompileGenericFormula(*lc.DurationMs, path+".durationMs", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if len(instr) > 0 {
			key := path + ".durationMs"
			out.DurationProgram, out.HasDuration = ctx.registerFormula(key, instr)
		}
	}
	if out.RefreshPolicy == "" {
		out.RefreshPolicy = model.RefreshPolicyReplace
	}
	if out.InstanceScope != "" && out.InstanceScope != model.InstanceScopeSourceTarget {
		collector.addError(model.GenericErrUnknownRef, path+".instanceScope", "unsupported provider instanceScope", out.InstanceScope)
	}
	_ = collector
	return out
}

func compileListenerDefinition(listener model.ListenerDefinition, path, ownerCombatantKey, ownerProviderRef string, sourceAbilityIndex, ownerProviderIndex int, ctx *genericCompileContext) plan.CompiledListener {
	collector := ctx.collector
	if sourceAbilityIndex < 0 {
		sourceAbilityIndex = -1
	}
	compiled := plan.CompiledListener{
		ListenerKey:         listener.ListenerKey,
		MaxTriggersPerEvent: listener.MaxTriggersPerEvent,
		ChainLimitKey:       listener.ChainLimitKey,
		PerCastThrottleMs:   listener.PerCastThrottleMs,
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
	if listener.PerCastThrottleMs < 0 {
		collector.addError(model.GenericErrMissingRequiredField, path+".perCastThrottleMs", "perCastThrottleMs must be >= 0", listener.ListenerKey)
		compiled.PerCastThrottleMs = 0
	}
	compiled.EventMatcher = typeset.CompileGenericMatcher(listener.EventMatcher, ctx.session.Types, typeset.EntityListener, path+".eventMatcher", collector.addError)
	if compiled.PerCastThrottleMs > 0 && !listenerMatcherRequiresDamageInstance(listener.EventMatcher) {
		collector.addError(model.GenericErrMatcherDomainError, path+".perCastThrottleMs", "perCastThrottleMs requires event/damage_instance in eventMatcher.all (cast-instance event context)", listener.ListenerKey)
	}
	if listener.AbilityRef != "" {
		compiled.HasAbilityRef = true
		compiled.AbilityRef = listener.AbilityRef
	}
	prevListener := ctx.currentListener
	listenerCopy := listener
	ctx.currentListener = &listenerCopy
	validateOncePerUse(listener, path, ownerProviderIndex, ctx)
	compileListenerCondition(listener, path, &compiled, ctx)
	compileOncePerUse(listener, &compiled)
	ctx.beginOutputUnit()
	for i, op := range listener.Operations {
		if len(ctx.session.VampRules) > 0 && sourceAbilityIndex < 0 && op.Operation == "damage" {
			collector.addError(model.GenericErrMissingRequiredField, path+".operations["+itoa(i)+"]", "vamp damage requires a declared owning ability", op.Ref)
		}
		compileOperation(op, path+".operations["+itoa(i)+"]", ownerProviderIndex, ctx)
		ctx.outputUnitIndex++
	}
	ctx.endOutputUnit()
	ctx.currentListener = prevListener
	compiled.OperationCount = uint16(len(ctx.session.Operations)) - compiled.OperationStart
	return compiled
}

// listenerMatcherRequiresDamageInstance reports whether EventMatcher.All includes event/damage_instance.
// Per-cast throttle keys on castInstanceId, which damage_instance events carry.
func listenerMatcherRequiresDamageInstance(matcher model.TypeMatcher) bool {
	for _, key := range matcher.All {
		if key == "event/damage_instance" {
			return true
		}
	}
	return false
}

func compileProviderListener(listener model.ListenerDefinition, path string, ctx *genericCompileContext) plan.CompiledListener {
	return compileListenerDefinition(listener, path, "", "", -1, -1, ctx)
}

func compileListener(listener model.ListenerDefinition, path string, ctx *genericCompileContext) {
	_ = compileListenerDefinition(listener, path, "", "", -1, -1, ctx)
}

func (ctx *genericCompileContext) registerFormula(key string, instr []formula.GenericInstr, planBytes ...uint64) (formula.GenericProgramID, bool) {
	if !ctx.validateFormulaScope(instr, key) {
		return 0, false
	}
	deps := ctx.session.Formulas.InstructionDependencies(instr, nil)
	for _, dependency := range deps {
		if dependency.ReadKind == formula.ReadProcessStartState && !strings.Contains(key, ".skillHit.candidates[") {
			ctx.collector.addError(model.GenericErrFormulaTypeError, key, "process start capture requires its actual empowered payload", dependency.ReadKey)
			return 0, false
		}
		definitionRead := strings.Contains(key, ".lifecycle.") || strings.Contains(key, ".modifiers[") || strings.Contains(key, ".statusContributions[")
		if dependency.ReadKind == formula.ReadUseChargeDuration && ctx.currentProcess == nil && !strings.Contains(key, ".skillHit.candidates[") && !definitionRead {
			ctx.collector.addError(model.GenericErrFormulaTypeError, key, "charge runtime input requires an actual charge process or associated hit result", dependency.ReadKey)
			return 0, false
		}
	}
	if strings.Contains(strings.ToLower(key), "condition") || strings.Contains(key, "eventValueConditions") {
		for _, dependency := range deps {
			if dependency.ReadKind == formula.ReadAuthoredRuntimeParameter || dependency.ReadKind == formula.ReadAuthoredAbilityParameter || dependency.ReadKind == formula.ReadUseChargeDuration || dependency.ReadKind == formula.ReadProcessActualCost || dependency.ReadKind == formula.ReadProcessStartState {
				ctx.collector.addError(model.GenericErrFormulaTypeError, key, "condition cannot use runtime formula parameters", dependency.ReadKey)
				return 0, false
			}
		}
	}
	validateProcessActualCostReads(deps, key, ctx)
	validateOperationOutputReads(deps, key, ctx)
	validateResolvedContactReads(deps, key, ctx)
	hasRef := false
	for _, in := range instr {
		if in.Op == formula.GenericOpRef {
			hasRef = true
		}
	}
	if hasRef && len(deps) == 0 {
		if _, err := ctx.session.Formulas.EvaluateInstructions(instr, formula.GenericEvalContext{}, true); err != nil {
			if authored, ok := err.(*formula.AuthoredEvaluationError); ok {
				ctx.collector.addError(model.GenericErrCode(authored.Issue.Code), authored.DefinitionPath+authored.Issue.Path, authored.Error(), authored.ProgramKey)
			}
			ctx.collector.addError(model.GenericErrFormulaTypeError, key, err.Error(), key)
			return 0, false
		}
	}
	bytes := uint64(0)
	if len(planBytes) > 0 {
		bytes = planBytes[0]
	}
	id, err := ctx.session.Formulas.Register(formula.GenericProgram{Key: key, Instr: instr, PlanBytes: bytes})
	if err != nil {
		ctx.collector.addError(model.GenericErrFormulaTypeError, key, err.Error(), key)
		return 0, false
	}
	return id, true
}

func compileOperation(op model.OperationDefinition, path string, ownerProviderIndex int, ctx *genericCompileContext) {
	collector := ctx.collector
	session := ctx.session
	catalog := ctx.catalog
	if op.ValuePolicy == "complement_multiply" {
		collector.addError(model.GenericErrUnknownRef, path+".valuePolicy", "complement multiplication is only supported on total attribute modifiers", op.Operation)
	}
	if op.Operation == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".operation", "operation is required", "")
		return
	}
	if isForbiddenHPOperation(op.Operation) {
		collector.addError(model.GenericErrHPRawSetForbidden, path+".operation", "HP raw set is forbidden", op.Operation)
	}
	if op.Target == "" {
		if op.Operation != model.OperationKindRepeat {
			collector.addError(model.GenericErrOperationTargetMissing, path+".target", "operation target is required", op.Operation)
		}
	} else if _, ok := model.ValidCombatantSelectors[op.Target]; !ok && !strings.HasPrefix(op.Target, "source.") && !strings.HasPrefix(op.Target, "target.") {
		collector.addError(model.GenericErrOperationTargetMissing, path+".target", "unknown operation target", op.Target)
	}
	if op.CopyableOnHit && op.Operation != "damage" {
		collector.addError(model.GenericErrMissingRequiredField, path+".copyableOnHit", "copyableOnHit is only supported on damage operations", op.Operation)
	}
	if op.CritEligible && op.Operation != "damage" {
		collector.addError(model.GenericErrMissingRequiredField, path+".critEligible", "critEligible is only supported on damage operations", op.Operation)
	}
	validateOutputRef(op, path, ctx)
	if op.RepeatDelayMs < 0 {
		collector.addError(model.GenericErrMissingRequiredField, path+".repeatDelayMs", "repeatDelayMs must be >= 0", itoa(op.RepeatDelayMs))
	}
	if op.RepeatDelayMs != 0 && op.Operation != model.OperationKindRepeat {
		collector.addError(model.GenericErrMissingRequiredField, path+".repeatDelayMs", "repeatDelayMs is only supported on repeat operations", op.Operation)
	}
	if op.ShieldDurationMs != nil && op.Operation != "shield" {
		collector.addError(model.GenericErrMissingRequiredField, path+".shieldDurationMs", "shieldDurationMs is only supported on shield operations", op.Operation)
	}
	if op.Operation == model.OperationKindResolveSkillHit {
		collector.addError(model.GenericErrUnknownRef, path+".operation", "resolve_skill_hit is only allowed as the unique operation on an active hit ability", op.Operation)
		return
	}
	if op.ProviderRefFromEvent && op.Operation != "expire_provider" {
		collector.addError(model.GenericErrUnknownRef, path+".providerRefFromEvent", "providerRefFromEvent is only allowed on expire_provider", op.Operation)
	}
	switch op.Operation {
	case "damage":
		if op.DamageType == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".damageType", "damage operation requires damageType", "")
		} else {
			typeset.ValidateTypeKeys([]string{op.DamageType}, typeset.EntityOperationDamageType, catalog, path+".damageType", collector.addError)
			_, hasFormula := session.DamageTypeFormulas[op.DamageType]
			if _, known := catalog.Registry.LookupDomain("damage", op.DamageType); known && !hasFormula {
				collector.addError(model.GenericErrMissingDamageTypeFormula, path+".damageType", "damage operation requires a successfully registered authored formula", op.DamageType)
			}
		}
		if op.Amount == nil {
			collector.addError(model.GenericErrMissingRequiredField, path+".amount", "damage operation requires amount", "")
		}
		// Damage operation Types are cataloged damage_trait/* only; reject unknown/wrong-domain keys.
		typeset.ValidateTypeKeys(op.Types, typeset.EntityOperationDamageTrait, catalog, path+".types", collector.addError)
	case "heal", "shield", "resource_change", "attribute_change":
		if op.Amount == nil {
			collector.addError(model.GenericErrMissingRequiredField, path+".amount", op.Operation+" requires amount", "")
		}
	case "provider_duration_change":
		validateProviderDurationChangeOperation(op, path, ownerProviderIndex, ctx)
	case "apply_provider":
		ctx.validateForeignProviderRuntime(op.ProviderDefinitionRef, path)
		if op.ProviderDefinitionRef == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".providerDefinitionRef", "apply_provider requires providerDefinitionRef", "")
		}
	case "refresh_provider":
		if op.ProviderRef == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".providerRef", op.Operation+" requires providerRef", "")
		}
		if op.ProviderRefFromEvent {
			collector.addError(model.GenericErrUnknownRef, path+".providerRefFromEvent", "providerRefFromEvent is only allowed on expire_provider", op.Operation)
		}
	case "expire_provider":
		if op.ProviderRefFromEvent {
			validateProviderRefFromEvent(op, path, ownerProviderIndex, ctx.currentListener, ctx)
		} else if op.ProviderRef == "" {
			collector.addError(model.GenericErrMissingRequiredField, path+".providerRef", op.Operation+" requires providerRef", "")
		}
	case "emit_event":
		validateEmitEventNotForged(op, path, ctx)
	case "cooldown_change":
		if op.ValuePolicy == "set_remaining" && op.Amount == nil {
			collector.addError(model.GenericErrMissingRequiredField, path+".amount", "set_remaining requires amount", "")
		}
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
			collector.addError(model.GenericErrUnknownTypeKey, path+".types", "state_change "+scopeErr, strings.Join(op.Types, ","))
		}
		_ = scope
	case model.OperationKindStateDurationChange:
		validateStateDurationChangeOperation(op, path, ownerProviderIndex, ctx)
	case model.OperationKindRepeat:
		validateRepeatOperation(op, path, ownerProviderIndex, ctx)
	case model.OperationKindExecuteThreshold:
		validateExecuteThresholdOperation(op, path, ctx)
	case model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		validateLinkOperation(op, path, ctx)
	}
	compiled := plan.CompiledOperation{
		Path:                  path,
		Operation:             op.Operation,
		Target:                op.Target,
		DamageType:            op.DamageType,
		ResourceKey:           op.ResourceKey,
		OwnerProviderIndex:    ownerProviderIndex,
		AttributeKey:          op.AttributeKey,
		ValuePolicy:           op.ValuePolicy,
		ProviderDefinitionRef: op.ProviderDefinitionRef,
		ProviderRef:           op.ProviderRef,
		ShieldRef:             op.ShieldRef,
		EventType:             op.EventType,
		Types:                 append([]string(nil), op.Types...),
		CopyableOnHit:         op.CopyableOnHit,
		CritEligible:          op.CritEligible,
		RepeatScope:           op.RepeatScope,
		RepeatCount:           op.RepeatCount,
		RepeatTag:             op.RepeatTag,
		RepeatDelayMs:         op.RepeatDelayMs,
		TriggerStateKey:       op.TriggerStateKey,
		Threshold:             op.Threshold,
		ProviderRefFromEvent:  op.ProviderRefFromEvent,
	}
	compileShieldLifecycleBinding(op, path, ownerProviderIndex, &compiled, ctx)
	if op.Operation == "damage" {
		compiled.Types = normalizeDamageTraitTypes(op.Types, catalog)
	}
	compileVampOverrides(op, &compiled, path, ctx)
	compileCritFormulas(op, &compiled, path, ctx)
	if op.Operation == "state_change" || op.Operation == model.OperationKindStateDurationChange {
		if scope, errMsg := resolveProviderStateScope(op.Types); errMsg == "" {
			compiled.StateScope = scope
		}
	}
	if op.Amount != nil {
		instr := formula.CompileGenericFormula(*op.Amount, path+".amount", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if op.Operation == "state_change" && ownerProviderIndex >= 0 && ownerProviderIndex < len(session.Providers) && session.Providers[ownerProviderIndex].StateFields[op.Ref].ValueType == model.ProviderStateValueInteger {
			if value, constant := ctx.session.Formulas.FoldInstructions(instr); constant && (!validStateInteger(value) || (value < 0 && op.ValuePolicy != "add" && op.ValuePolicy != "")) {
				collector.addError(model.GenericErrFormulaTypeError, path+".amount", "integer state requires a safe integer operand; only addition accepts a negative delta", op.Ref)
			}
		}
		validateProcessActualCostReads(instr, path+".amount", ctx)
		if op.Operation == "cooldown_change" && op.ValuePolicy == "set_remaining" {
			if value, constant := ctx.session.Formulas.FoldInstructions(instr); constant && (value < 0 || (value != 0 && !formula.ValidPositiveInt64DurationMs(value))) {
				collector.addError(model.GenericErrFormulaTypeError, path+".amount", "set_remaining requires finite non-negative integer milliseconds", "")
			}
		}
		validateDamagePredicateReads(ctx.session.Formulas.InstructionDependencies(instr, nil), path+".amount", catalog, collector.addError)
		if len(instr) > 0 {
			key := path + ".amount"
			compiled.AmountProgram, compiled.HasAmount = ctx.registerFormula(key, instr)
		}
	}
	if op.Condition != nil {
		instr := formula.CompileGenericFormula(*op.Condition, path+".condition", ctx.namedFormulas, map[string]bool{}, collector.addError)
		validateDamagePredicateReads(ctx.session.Formulas.InstructionDependencies(instr, nil), path+".condition", catalog, collector.addError)
		if len(instr) > 0 {
			key := path + ".condition"
			compiled.ConditionProgram, compiled.HasCondition = ctx.registerFormula(key, instr)
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
	compiled.OutputRef = op.OutputRef
	compileShieldDuration(op, path, &compiled, ctx)
	session.Operations = append(session.Operations, compiled)
}

func compileShieldDuration(op model.OperationDefinition, path string, compiled *plan.CompiledOperation, ctx *genericCompileContext) {
	if op.ShieldDurationMs == nil || op.Operation != "shield" {
		return
	}
	collector := ctx.collector
	instr := formula.CompileGenericFormula(*op.ShieldDurationMs, path+".shieldDurationMs", ctx.namedFormulas, map[string]bool{}, collector.addError)
	if len(instr) == 0 {
		return
	}
	compiled.ShieldDurationProgram, compiled.HasShieldDuration = ctx.registerFormula(path+".shieldDurationMs", instr)
	if value, folded := ctx.session.Formulas.FoldInstructions(instr); folded && !formula.ValidPositiveInt64DurationMs(value) {
		collector.addError(model.GenericErrFormulaTypeError, path+".shieldDurationMs", "shieldDurationMs must be a positive integer within the timestamp range", op.ShieldRef)
	}
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
				return "", "requires a single state scope"
			}
			found = t
		}
	}
	if found == "" {
		return "", "requires state_scope/provider or state_scope/provider_target"
	}
	return found, ""
}

// validateStateDurationChangeOperation collect-all 校验 timed-state duration subtract 合同。
func validateStateDurationChangeOperation(op model.OperationDefinition, path string, ownerProviderIndex int, ctx *genericCompileContext) {
	collector := ctx.collector
	if ownerProviderIndex < 0 || ownerProviderIndex >= len(ctx.session.Providers) {
		collector.addError(model.GenericErrMissingRequiredField, path+".operation", "state_duration_change requires owning provider context", op.Operation)
	}
	if op.Ref == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".ref", "state_duration_change requires ref state key", "")
	}
	if op.Amount == nil {
		collector.addError(model.GenericErrMissingRequiredField, path+".amount", "state_duration_change requires amount", "")
	}
	if op.ValuePolicy != "subtract" {
		collector.addError(model.GenericErrUnknownRef, path+".valuePolicy", "state_duration_change requires valuePolicy=subtract", op.ValuePolicy)
	}
	if op.Target != model.SelectorSource && op.Target != model.SelectorSelf {
		collector.addError(model.GenericErrOperationTargetMissing, path+".target", "state_duration_change target must be source or self", op.Target)
	}
	scope, scopeErr := resolveProviderStateScope(op.Types)
	if scopeErr != "" {
		collector.addError(model.GenericErrUnknownTypeKey, path+".types", "state_duration_change "+scopeErr, strings.Join(op.Types, ","))
	}
	_ = scope
	if op.Ref == "" || ownerProviderIndex < 0 || ownerProviderIndex >= len(ctx.session.Providers) {
		return
	}
	fields := ctx.session.Providers[ownerProviderIndex].StateFields
	field, ok := fields[op.Ref]
	if !ok {
		collector.addError(model.GenericErrUnknownRef, path+".ref", "state_duration_change unknown state key", op.Ref)
		return
	}
	if field.StateKind == model.ProviderStateKindAmmo {
		if field.AmmoRecovery == nil || !field.AmmoRecovery.OneByOne || scope != "state_scope/provider" {
			collector.addError(model.GenericErrUnknownRef, path+".ref", "ammo duration subtract requires owned one-by-one provider state", op.Ref)
		}
	} else if field.DurationMs <= 0 {
		collector.addError(model.GenericErrMissingRequiredField, path+".ref", "state_duration_change requires timed state with durationMs>0", op.Ref)
	}
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
	validateOncePerUseGroups(session, ctx)
}

func validateOncePerUseGroups(session *plan.CompiledSession, ctx *genericCompileContext) {
	type groupID struct {
		owner string
		pref  string
		group string
	}
	seen := map[groupID]string{}
	for i := range session.Listeners {
		listener := session.Listeners[i]
		if !listener.HasOncePerUse {
			continue
		}
		id := groupID{owner: listener.OwnerCombatantKey, pref: listener.OwnerProviderRef, group: listener.OncePerUseGroup}
		if prev, ok := seen[id]; ok && prev != listener.OncePerUseScope {
			ctx.collector.addError(model.GenericErrUnknownRef, "listeners.oncePerUse.scope", "same oncePerUse groupKey must share one scope", listener.ListenerKey+" conflicts with "+prev)
			continue
		}
		seen[id] = listener.OncePerUseScope
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

func (ctx *genericCompileContext) resolveAbilityRef(abilityRef, path string) (plan.CompiledAbilityRef, bool) {
	collector := ctx.collector
	session := ctx.session
	parsed, ok := plan.ParseAbilityRef(abilityRef)
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "invalid abilityRef format", abilityRef)
		}
		return plan.CompiledAbilityRef{}, false
	}
	combatantKey := parsed.Combatant
	if combatantKey == model.SelectorSelf || combatantKey == model.SelectorOpponent {
		// self/opponent cannot be bound to a concrete combatant at compile time.
		// Validate that providerRef+abilityKey exist on at least one combatant mount.
		if path != "" && !ctx.abilityExistsOnAnyCombatant(parsed.ProviderRef, parsed.AbilityKey) {
			collector.addError(model.GenericErrUnknownRef, path, "unknown providerRef/abilityKey in abilityRef", abilityRef)
		}
		return plan.CompiledAbilityRef{}, false
	}
	ci, ok := ctx.combatantByKey[combatantKey]
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "unknown combatant in abilityRef", abilityRef)
		}
		return plan.CompiledAbilityRef{}, false
	}
	mounts, ok := ctx.providerMounts[combatantKey]
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "combatant has no provider mounts", abilityRef)
		}
		return plan.CompiledAbilityRef{}, false
	}
	mountIdx, ok := mounts[parsed.ProviderRef]
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "unknown providerRef in abilityRef", abilityRef)
		}
		return plan.CompiledAbilityRef{}, false
	}
	mount := session.Combatants[ci].ProviderMounts[mountIdx]
	abilityMap := ctx.providerAbilityIndex[mount.DefinitionIndex]
	ai, ok := abilityMap[parsed.AbilityKey]
	if !ok {
		if path != "" {
			collector.addError(model.GenericErrUnknownRef, path, "unknown abilityKey in abilityRef", abilityRef)
		}
		return plan.CompiledAbilityRef{}, false
	}
	return plan.CompiledAbilityRef{
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

func findProviderIndex(session *plan.CompiledSession, providerKey string) (int, bool) {
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

// validateDamagePredicateReads fail-closes unknown damage.trait.* / damage.type.* catalog bindings.
func validateDamagePredicateReads(
	instr []formula.GenericInstr,
	path string,
	catalog typeset.CatalogResult,
	addError func(code model.GenericErrCode, path, message, ref string),
) {
	for _, in := range instr {
		if in.Op != formula.GenericOpRead {
			continue
		}
		switch in.ReadKind {
		case formula.ReadDamageTrait:
			key := "damage_trait/" + in.ReadKey
			id, ok := catalog.Registry.LookupDomain("damage_trait", key)
			if !ok {
				addError(model.GenericErrUnknownTypeKey, path+".path", "unknown damage trait predicate", "damage.trait."+in.ReadKey)
				continue
			}
			if catalog.Domains[id] != "damage_trait" {
				addError(model.GenericErrMatcherDomainError, path+".path", "damage trait predicate domain mismatch", key)
			}
		case formula.ReadDamageType:
			if !damageTypePredicateDeclared(in.ReadKey, catalog) {
				addError(model.GenericErrUnknownTypeKey, path+".path", "unknown damage type predicate", "damage.type."+in.ReadKey)
			}
		case formula.ReadDamageCastOrigin:
			key := "cast_origin/" + in.ReadKey
			id, ok := catalog.Registry.LookupDomain("cast_origin", key)
			if !ok {
				addError(model.GenericErrUnknownTypeKey, path+".path", "unknown cast origin predicate", "damage.cast_origin."+in.ReadKey)
				continue
			}
			if catalog.Domains[id] != "cast_origin" {
				addError(model.GenericErrMatcherDomainError, path+".path", "cast origin predicate domain mismatch", key)
			}
		case formula.ReadDamageAbilityType:
			key := "ability/" + in.ReadKey
			id, ok := catalog.Registry.LookupDomain("ability", key)
			if !ok {
				addError(model.GenericErrUnknownTypeKey, path+".path", "unknown ability type predicate", "damage.ability_type."+in.ReadKey)
				continue
			}
			if catalog.Domains[id] != "ability" {
				addError(model.GenericErrMatcherDomainError, path+".path", "ability type predicate domain mismatch", key)
			}
		}
	}
}

func damageTypePredicateDeclared(key string, catalog typeset.CatalogResult) bool {
	_, declared := catalog.Registry.LookupDomain("damage", key)
	return declared
}

// normalizeDamageTraitTypes keeps cataloged damage_trait/* keys in declaration order.
func normalizeDamageTraitTypes(types []string, catalog typeset.CatalogResult) []string {
	if len(types) == 0 {
		return nil
	}
	out := make([]string, 0, len(types))
	seen := map[string]struct{}{}
	for _, t := range types {
		id, ok := catalog.Registry.LookupDomain("damage_trait", t)
		if !ok || catalog.Domains[id] != "damage_trait" {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
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
