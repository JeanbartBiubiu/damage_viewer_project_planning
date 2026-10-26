package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func uniqueResolveSkillHit(ops []model.OperationDefinition) (model.OperationDefinition, bool) {
	if len(ops) != 1 || ops[0].Operation != model.OperationKindResolveSkillHit {
		return model.OperationDefinition{}, false
	}
	return ops[0], true
}

func lastSkillHitOperationIndex(session *planbundle.CompiledSession) int {
	for i := len(session.Operations) - 1; i >= 0; i-- {
		if session.Operations[i].Operation == model.OperationKindResolveSkillHit {
			return i
		}
	}
	return -1
}

func compileSkillHitAbility(ability model.AbilityDefinition, op model.OperationDefinition, path string, ownerProviderIndex int, ctx *genericCompileContext) {
	collector := ctx.collector
	session := ctx.session
	opPath := path + ".operations[0]"
	if op.CritChance != nil || op.CritMultiplier != nil {
		collector.addError(model.GenericErrFormulaTypeError, opPath+".critChance", "result crit formulas only belong to damage operations", op.Operation)
	}
	if op.ShieldDurationMs != nil {
		collector.addError(model.GenericErrMissingRequiredField, opPath+".shieldDurationMs", "shieldDurationMs is only supported on shield operations", op.Operation)
	}
	if op.ShieldLifecycleProviderDefinitionRef != "" {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".shieldLifecycleProviderDefinitionRef", "resolve_skill_hit entry cannot declare a shield lifecycle binding", op.ShieldLifecycleProviderDefinitionRef)
	}
	if op.SkillHit == nil {
		collector.addError(model.GenericErrMissingRequiredField, opPath+".skillHit", "resolve_skill_hit requires skillHit", ability.AbilityKey)
		session.Operations = append(session.Operations, planbundle.CompiledOperation{Operation: model.OperationKindResolveSkillHit, Target: op.Target})
		return
	}
	if op.Payload != nil {
		collector.addError(model.GenericErrUnknownRef, opPath+".payload", "resolve_skill_hit cannot carry free payload", ability.AbilityKey)
	}
	if strings.TrimSpace(op.SkillHit.SkillKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, opPath+".skillHit.skillKey", "skillHit.skillKey is required", ability.AbilityKey)
	}
	if op.Target != model.SelectorTarget {
		collector.addError(model.GenericErrOperationTargetMissing, opPath+".target", "resolve_skill_hit must address the actual driver target", ability.AbilityKey)
	}
	wasBasic := ctx.compilingBasicAttack
	ctx.compilingBasicAttack = abilityIsBasicAttack(ability, ctx)
	defer func() { ctx.compilingBasicAttack = wasBasic }()
	if ctx.compilingBasicAttack {
		requireEventType(ctx, model.EventTypeBasicAttackHit, opPath+".skillHit", "basic attack resolve_skill_hit requires event/basic_attack_hit in typeCatalog")
	} else {
		requireEventType(ctx, model.EventTypeSkillHit, opPath+".skillHit", "resolve_skill_hit requires event/skill_hit in typeCatalog")
	}

	seenCandidate := map[string]int{}
	plan := &planbundle.CompiledSkillHit{SkillKey: op.SkillHit.SkillKey, PrimaryCandidate: -1, OwnerProviderIndex: ownerProviderIndex}
	inboundNonNull := 0
	for i, cand := range op.SkillHit.Candidates {
		cpath := opPath + ".skillHit.candidates[" + itoa(i) + "]"
		compiled := compileSkillHitCandidate(cand, cpath, ownerProviderIndex, ctx)
		if compiled.AttackDamageRole == planbundle.AttackDamageRolePrimary {
			if !ctx.compilingBasicAttack || plan.PrimaryCandidate >= 0 {
				collector.addError(model.GenericErrUnknownRef, cpath+".attackDamageRole", "PRIMARY requires one unique native basic-attack candidate", cand.CandidateKey)
			}
			plan.PrimaryCandidate = i
			if cand.SpellShieldBlockScope != nil {
				collector.addError(model.GenericErrUnknownRef, cpath+".spellShieldBlockScope", "PRIMARY requires an explicit null spell-shield scope", cand.CandidateKey)
			}
		}
		if compiled.AttackDamageRole == planbundle.AttackDamageRoleReplacePrimary {
			if ctx.compilingBasicAttack || len(op.SkillHit.Candidates) != 1 {
				collector.addError(model.GenericErrUnknownRef, cpath+".attackDamageRole", "REPLACE_PRIMARY requires one complete non-basic empowered payload", cand.CandidateKey)
			}
			plan.ReplacesPrimary = true
		}
		if cand.CandidateKey != "" {
			if prev, ok := seenCandidate[cand.CandidateKey]; ok {
				collector.addError(model.GenericErrUnknownRef, cpath+".candidateKey", "duplicate candidateKey", cand.CandidateKey)
				collector.addError(model.GenericErrUnknownRef, opPath+".skillHit.candidates["+itoa(prev)+"].candidateKey", "duplicate candidateKey", cand.CandidateKey)
			} else {
				seenCandidate[cand.CandidateKey] = i
			}
		}
		if compiled.HasBlockScope {
			inboundNonNull++
		}
		plan.Candidates = append(plan.Candidates, compiled)
	}
	compileSkillHitRuleGroups(op.SkillHit.RuleGroups, op.SkillHit.Candidates, plan, opPath+".skillHit.ruleGroups", ownerProviderIndex, ctx)
	validateSkillHitHealingCandidates(ability, op, plan, ctx)
	if plan.PrimaryCandidate >= 0 {
		for i, candidate := range op.SkillHit.Candidates {
			if candidate.SpellShieldBlockScope != nil {
				collector.addError(model.GenericErrUnknownRef, opPath+".skillHit.candidates["+itoa(i)+"].spellShieldBlockScope", "a PRIMARY hit requires null spell-shield scope on every parent candidate", candidate.CandidateKey)
			}
		}
	}
	_ = inboundNonNull
	if op.Target != "" {
		if _, ok := model.ValidCombatantSelectors[op.Target]; !ok && !strings.HasPrefix(op.Target, "source.") && !strings.HasPrefix(op.Target, "target.") {
			collector.addError(model.GenericErrOperationTargetMissing, opPath+".target", "unknown operation target", op.Target)
		}
	}
	session.Operations = append(session.Operations, planbundle.CompiledOperation{
		Operation:          model.OperationKindResolveSkillHit,
		OwnerProviderIndex: ownerProviderIndex,
		Target:             op.Target,
		Ref:                op.Ref,
		SkillHit:           plan,
	})
}

func compileSkillHitCandidate(cand model.SkillHitCandidate, path string, ownerProviderIndex int, ctx *genericCompileContext) planbundle.CompiledSkillHitCandidate {
	collector := ctx.collector
	out := planbundle.CompiledSkillHitCandidate{
		RuleGroupIndex:           -1,
		CandidateKey:             cand.CandidateKey,
		EffectOccurrenceKey:      cand.EffectOccurrenceKey,
		EffectKey:                cand.EffectKey,
		ResultKey:                cand.ResultKey,
		Semantic:                 cand.Semantic,
		Path:                     path,
		ParticipationProviderRef: cand.ParticipationProviderRef,
	}
	if cand.AttackDamageRole != "" {
		switch cand.AttackDamageRole {
		case model.AttackDamageRolePrimary:
			out.AttackDamageRole = planbundle.AttackDamageRolePrimary
		case model.AttackDamageRoleReplacePrimary:
			out.AttackDamageRole = planbundle.AttackDamageRoleReplacePrimary
		default:
			collector.addError(model.GenericErrUnknownRef, path+".attackDamageRole", "unknown attack damage role", string(cand.AttackDamageRole))
		}
		if cand.Semantic.ResultType != model.SkillHitResultDamage || cand.Semantic.Target != model.SkillHitTargetTARGET || cand.Semantic.Moment != model.SkillHitMomentInstant || cand.ParticipationCondition != nil || cand.ParticipationProviderRef != "" || len(cand.EventValueConditions) != 0 || len(cand.Operations) != 1 || cand.Operations[0].Operation != "damage" || cand.Operations[0].Condition != nil {
			collector.addError(model.GenericErrUnknownRef, path+".attackDamageRole", "attack damage role requires one unconditional instantaneous target damage", cand.CandidateKey)
		}
		if len(cand.Operations) == 1 && (cand.Operations[0].RepeatCount != 0 || cand.Operations[0].RepeatScope != "" || cand.Operations[0].RepeatDelayMs != 0 || cand.Operations[0].RepeatTag != "") {
			collector.addError(model.GenericErrUnknownRef, path+".operations", "attack damage roles cannot carry repeat metadata", cand.CandidateKey)
		}
	}
	if strings.TrimSpace(cand.CandidateKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".candidateKey", "candidateKey is required", "")
	}
	if strings.TrimSpace(cand.EffectOccurrenceKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".effectOccurrenceKey", "effectOccurrenceKey is required", cand.CandidateKey)
	}
	if strings.TrimSpace(cand.EffectKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".effectKey", "effectKey is required", cand.CandidateKey)
	}
	if strings.TrimSpace(cand.ResultKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".resultKey", "resultKey is required", cand.CandidateKey)
	}
	if msg := validateSkillHitSemantic(cand.Semantic, path+".semantic"); msg != "" {
		collector.addError(model.GenericErrUnknownRef, path+".semantic", msg, cand.CandidateKey)
	}
	if msg := model.ValidateSpellShieldScope(cand.Semantic, cand.SpellShieldBlockScope); msg != "" {
		collector.addError(model.GenericErrUnknownRef, path+".spellShieldBlockScope", msg, cand.CandidateKey)
	}
	if cand.SpellShieldBlockScope != nil && *cand.SpellShieldBlockScope != "" {
		out.HasBlockScope = true
		out.BlockScope = *cand.SpellShieldBlockScope
	}
	if out.HasBlockScope && !candidateCanHoldOnUnblocked(cand) {
		collector.addError(model.GenericErrUnknownRef, path+".eventValueConditions", "non-null inbound result must be able to hold on blocked=0; blocked=1-only results cannot form this hit's block unit", cand.CandidateKey)
	} else if out.HasBlockScope {
		out.InboundBlockEligible = true
	}
	if cand.ParticipationCondition != nil {
		instr := formula.CompileGenericFormula(*cand.ParticipationCondition, path+".participationCondition", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if formulaHasForbiddenHitReads(ctx.session.Formulas.InstructionDependencies(instr, nil)) {
			collector.addError(model.GenericErrFormulaTypeError, path+".participationCondition", "participationCondition cannot read skill hit values, event snapshots that are not yet produced, or damage pipeline writes", cand.CandidateKey)
		}
		if len(instr) > 0 {
			out.ParticipationProgram, out.HasParticipation = ctx.registerFormula(path+".participationCondition", instr)
		}
	}
	if cand.ParticipationProviderRef != "" && cand.ParticipationCondition == nil {
		collector.addError(model.GenericErrMissingRequiredField, path+".participationCondition", "participation provider requires an explicit candidate condition", cand.CandidateKey)
	}
	for j, cond := range cand.EventValueConditions {
		cpath := path + ".eventValueConditions[" + itoa(j) + "]"
		compiled := planbundle.CompiledSkillHitValueCond{Key: cond.Key, Comparator: cond.Comparator, Path: cpath}
		if cond.Key != model.SkillHitValueFirstContact && cond.Key != model.SkillHitValueBlocked {
			collector.addError(model.GenericErrUnknownRef, cpath+".key", "eventValueConditions key must be first_contact or blocked", cond.Key)
		}
		if ctx.compilingBasicAttack && cond.Key == model.SkillHitValueFirstContact {
			collector.addError(model.GenericErrUnknownRef, cpath+".key", "basic_attack_hit cannot use firstContact eventValueConditions", cond.Key)
		}
		if _, ok := model.ValidSkillHitComparator[cond.Comparator]; !ok {
			collector.addError(model.GenericErrUnknownRef, cpath+".comparator", "unsupported eventValueConditions comparator", cond.Comparator)
		}
		instr := formula.CompileGenericFormula(cond.Value, cpath+".value", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if formulaReadsKind(ctx.session.Formulas.InstructionDependencies(instr, nil), formula.ReadEventSkillHit) {
			collector.addError(model.GenericErrFormulaTypeError, cpath+".value", "eventValueConditions value cannot reverse-read unproduced skill hit values", cand.CandidateKey)
		}
		if len(instr) > 0 {
			compiled.ValueProg, compiled.HasValue = ctx.registerFormula(cpath+".value", instr)
		} else {
			collector.addError(model.GenericErrMissingRequiredField, cpath+".value", "eventValueConditions value is required", cand.CandidateKey)
		}
		out.EventValueConds = append(out.EventValueConds, compiled)
	}
	if msg := operationsMatchSemantic(cand.Operations, cand.Semantic, cand.SpellShieldBlockScope, ctx); msg != "" {
		collector.addError(model.GenericErrUnknownRef, path+".operations", msg, cand.CandidateKey)
	}
	out.OperationStart = uint16(len(ctx.session.Operations))
	damageCount := 0
	ctx.beginOutputUnit()
	for k, cop := range cand.Operations {
		if cop.Operation == model.OperationKindResolveSkillHit {
			collector.addError(model.GenericErrUnknownRef, path+".operations["+itoa(k)+"].operation", "candidate operations cannot recurse resolve_skill_hit", cand.CandidateKey)
			ctx.outputUnitIndex++
			continue
		}
		if cop.Operation == "damage" {
			damageCount++
		}
		compileOperation(cop, path+".operations["+itoa(k)+"]", ownerProviderIndex, ctx)
		ctx.outputUnitIndex++
	}
	ctx.endOutputUnit()
	if cand.Semantic.ResultType == model.SkillHitResultDamage && damageCount > 1 {
		collector.addError(model.GenericErrUnknownRef, path+".operations", "a damage candidate allows exactly one damage operation", cand.CandidateKey)
	}
	out.OperationCount = uint16(len(ctx.session.Operations)) - out.OperationStart
	return out
}

func candidateCanHoldOnUnblocked(cand model.SkillHitCandidate) bool {
	for _, cond := range cand.EventValueConditions {
		if cond.Key != model.SkillHitValueBlocked {
			continue
		}
		if cond.Value.Op == "const" && cond.Value.Value != nil {
			match, valid := model.CompareSkillHitValue(cond.Comparator, 0, *cond.Value.Value)
			if !valid || !match {
				return false
			}
		}
	}
	return true
}

func validateSkillHitSemantic(sem model.SkillHitSemantic, path string) string {
	_ = path
	switch sem.ResultType {
	case model.SkillHitResultDamage, model.SkillHitResultAttributeChange, model.SkillHitResultResourceChange,
		model.SkillHitResultCooldownChange, model.SkillHitResultStatusOperation, model.SkillHitResultLifecycleOp,
		model.SkillHitResultSpellShield, model.SkillHitResultDamageModifier, model.SkillHitResultHealingModifier,
		model.SkillHitResultDamageImmunity, model.SkillHitResultHealthFloor, model.SkillHitResultAttackLink, model.SkillHitResultHitLink:
	case "":
		return "semantic.resultType is required"
	default:
		return "unknown semantic.resultType"
	}
	if _, ok := model.SemanticSelector(sem.Target); !ok {
		return "semantic.target must be TARGET, SOURCE or SELF"
	}
	if sem.Moment != model.SkillHitMomentInstant && sem.Moment != model.SkillHitMomentPersistent {
		return "semantic.moment must be INSTANT or PERSISTENT"
	}
	if (sem.ResultType == model.SkillHitResultAttackLink || sem.ResultType == model.SkillHitResultHitLink) && sem.Moment != model.SkillHitMomentInstant {
		return "link application moment must be INSTANT"
	}
	if sem.ResultType == model.SkillHitResultStatusOperation {
		if sem.StatusOperation != model.StatusOperationApply && sem.StatusOperation != model.StatusOperationRemove {
			return "STATUS_OPERATION requires statusOperation APPLY or REMOVE"
		}
		if strings.TrimSpace(sem.StatusKind) == "" {
			return "STATUS_OPERATION requires statusKind"
		}
		if sem.StatusKind != model.StatusKindMovementSlow {
			if _, ok := model.ClosedStatusKindProviderType[sem.StatusKind]; !ok {
				return "unknown control statusKind"
			}
		}
		if strings.TrimSpace(sem.StatusKey) == "" {
			return "STATUS_OPERATION requires statusKey"
		}
	}
	return ""
}

func operationsMatchSemantic(ops []model.OperationDefinition, sem model.SkillHitSemantic, scope *string, ctx *genericCompileContext) string {
	wantTarget, ok := model.SemanticSelector(sem.Target)
	if !ok {
		return "semantic.target is invalid"
	}
	if len(ops) == 0 {
		return "candidate operations are required"
	}
	switch sem.ResultType {
	case model.SkillHitResultAttackLink, model.SkillHitResultHitLink:
		kind := model.OperationKindApplyHitLink
		if sem.ResultType == model.SkillHitResultAttackLink {
			kind = model.OperationKindApplyAttackLink
		}
		if len(ops) != 1 || !allOpsAre(ops, kind, wantTarget) || sem.Moment != model.SkillHitMomentInstant {
			return "link semantic requires exactly one matching native link operation with INSTANT moment"
		}
	case model.SkillHitResultDamage:
		count := 0
		for _, op := range ops {
			if op.Operation != "damage" {
				return "DAMAGE semantic requires damage operations only"
			}
			if op.Target != wantTarget {
				return "DAMAGE operation target must match semantic.target"
			}
			count++
		}
		if count != 1 {
			return "DAMAGE candidate requires exactly one damage operation"
		}
		if sem.Moment != model.SkillHitMomentInstant {
			return "DAMAGE moment must be INSTANT"
		}
	case model.SkillHitResultAttributeChange:
		if !allOpsAre(ops, "attribute_change", wantTarget) {
			if sem.Target != model.SkillHitTargetTARGET || sem.Moment != model.SkillHitMomentPersistent || len(ops) != 1 || !allOpsAre(ops, "apply_provider", wantTarget) {
				return "ATTRIBUTE_CHANGE requires matching attribute_change operations or one pure PERSISTENT TARGET attribute provider"
			}
		}
	case model.SkillHitResultResourceChange:
		if !allOpsAre(ops, "resource_change", wantTarget) {
			return "RESOURCE_CHANGE requires resource_change operations matching semantic.target"
		}
	case model.SkillHitResultCooldownChange:
		if !allOpsAre(ops, "cooldown_change", wantTarget) {
			return "COOLDOWN_CHANGE requires cooldown_change operations matching semantic.target"
		}
	case model.SkillHitResultLifecycleOp:
		for _, op := range ops {
			if op.Operation != "expire_provider" && op.Operation != "refresh_provider" {
				return "LIFECYCLE_OPERATION requires expire_provider or refresh_provider"
			}
			if op.Target != wantTarget {
				return "LIFECYCLE_OPERATION target must match semantic.target"
			}
		}
	case model.SkillHitResultSpellShield:
		if scope != nil && *scope != "" {
			return "SPELL_SHIELD result must use null spellShieldBlockScope"
		}
		for _, op := range ops {
			if op.Operation != "apply_provider" {
				return "SPELL_SHIELD semantic requires apply_provider"
			}
			if !providerHasTypeKey(ctx, op.ProviderDefinitionRef, model.ProviderTypeSpellShield) {
				return "SPELL_SHIELD apply_provider must reference provider/spell_shield"
			}
			if op.Target != wantTarget {
				return "SPELL_SHIELD target must match semantic.target"
			}
		}
	case model.SkillHitResultStatusOperation:
		if sem.StatusOperation == model.StatusOperationApply {
			for _, op := range ops {
				if op.Operation != "apply_provider" {
					return "STATUS_OPERATION APPLY requires apply_provider"
				}
				if op.Target != wantTarget {
					return "status apply target must match semantic.target"
				}
				if !providerMatchesStatusKind(ctx, op.ProviderDefinitionRef, sem.StatusKind, sem.StatusKey) {
					return "apply_provider identity does not match semantic.statusKind"
				}
			}
		} else {
			return "STATUS_OPERATION REMOVE has no verified status-key-to-instance mapping in skill hit candidates"
		}
	case model.SkillHitResultHealingModifier:
		if sem.Target != model.SkillHitTargetTARGET || sem.Moment != model.SkillHitMomentPersistent || scope != nil || len(ops) != 1 || !allOpsAre(ops, "apply_provider", model.SelectorTarget) {
			return "HEALING_MODIFIER requires one PERSISTENT TARGET apply_provider with null spell-shield scope"
		}
	case model.SkillHitResultDamageModifier, model.SkillHitResultDamageImmunity, model.SkillHitResultHealthFloor:
		return "this resultType does not yet have a verified operation mapping in skill hit candidates"
	default:
		return "operations cannot match unknown resultType"
	}
	for _, op := range ops {
		if op.Operation == "shield" {
			return "numeric shield operations are not spell_shield and cannot stand in for this semantic"
		}
		if op.Operation == "emit_event" && (model.IsEngineProducedEvent(op.EventType) || model.IsEngineProducedEvent(op.Ref)) {
			return "candidate operations cannot forge engine skill hit events"
		}
	}
	return ""
}

// 在全部能力、监听与过程编译后检查真实定义，不能在候选编译时检查尚未填齐的供值器。
func finalizeSkillHitPersistentAttributeProviders(ctx *genericCompileContext) {
	for _, op := range ctx.session.Operations {
		if op.SkillHit == nil {
			continue
		}
		for _, candidate := range op.SkillHit.Candidates {
			if candidate.Semantic.ResultType != model.SkillHitResultAttributeChange || candidate.Semantic.Moment != model.SkillHitMomentPersistent || candidate.Semantic.Target != model.SkillHitTargetTARGET {
				continue
			}
			start, end := int(candidate.OperationStart), int(candidate.OperationStart)+int(candidate.OperationCount)
			if start < 0 || end > len(ctx.session.Operations) || end-start != 1 {
				continue // 直接属性操作沿原语义检查；非法范围由原编译错误负责。
			}
			operation := ctx.session.Operations[start]
			if operation.Operation != "apply_provider" {
				continue
			}
			if operation.Target != model.SelectorTarget || operation.HasAmount || operation.HasCondition || operation.ProviderRef != "" || operation.ProviderRefFromEvent || !pureFiniteTargetAttributeProvider(operation.ProviderDefinitionRef, ctx) {
				ctx.collector.addError(model.GenericErrUnknownRef, candidate.Path+".operations", "PERSISTENT TARGET attribute result requires one complete pure finite source_target attribute provider", operation.ProviderDefinitionRef)
			}
		}
	}
}

func pureFiniteTargetAttributeProvider(reference string, ctx *genericCompileContext) bool {
	if pureSnapshotAttributeProvider(reference, ctx) {
		return true
	}
	index, exists := ctx.providerKeyIndex[reference]
	if !exists || int(index) >= len(ctx.session.Providers) {
		return false
	}
	provider := ctx.session.Providers[index]
	if provider.Kind != "status" || !provider.TypeSet.Empty() || provider.AbilityCount != 0 || len(provider.Listeners)+len(provider.StateFields)+len(provider.Processes)+len(provider.StatusContributions) != 0 || provider.ShieldDefinitionRef != "" || provider.AmmoBinding != nil || provider.NeedsElapsedTime || len(provider.Modifiers) == 0 {
		return false
	}
	lifecycle := provider.Lifecycle
	if lifecycle == nil || !lifecycle.HasDuration || lifecycle.MaxStacks != 1 || lifecycle.RefreshPolicy != model.RefreshPolicyReplace || lifecycle.InstanceScope != model.InstanceScopeSourceTarget || lifecycle.TickIntervalMs != 0 {
		return false
	}
	duration, static := ctx.session.Formulas.FoldStatic(lifecycle.DurationProgram)
	if !static || !formula.ValidPositiveInt64DurationMs(duration) {
		return false
	}
	for _, modifier := range provider.Modifiers {
		key, own := strings.CutPrefix(modifier.Target, "self.attr.")
		flat := modifier.ValuePolicy == "add" && modifier.Stage == ""
		total := modifier.ValuePolicy == "multiply" && modifier.Stage == "total"
		if !own || key == "" || key == "hp" || strings.Contains(key, ".") || modifier.Kind != "attribute" || (!flat && !total) || modifier.HasCondition || !modifier.HasValue || modifier.Command != "" || modifier.Channel != "" || modifier.HealDirection != "" || modifier.HealCategory != "" || modifier.HealGroupKey != "" || modifier.HealGroupCalculationMode != "" {
			return false
		}
		value, fixed := ctx.session.Formulas.FoldStatic(modifier.ValueProgram)
		validTotal := !total || modifier.HasMultiplierGroup && value >= 1 || !modifier.HasMultiplierGroup && value >= 0 && value <= 1
		if !fixed || math.IsNaN(value) || math.IsInf(value, 0) || !validTotal {
			return false
		}
	}
	return true
}

func allOpsAre(ops []model.OperationDefinition, kind, target string) bool {
	if len(ops) == 0 {
		return false
	}
	for _, op := range ops {
		if op.Operation != kind || op.Target != target {
			return false
		}
	}
	return true
}

func providerHasTypeKey(ctx *genericCompileContext, definitionRef, typeKey string) bool {
	if ctx == nil || ctx.session == nil || definitionRef == "" {
		return false
	}
	idx, ok := ctx.providerKeyIndex[definitionRef]
	if !ok || int(idx) >= len(ctx.session.Providers) {
		return false
	}
	id, found := ctx.session.Types.Registry.LookupDomain("provider", typeKey)
	if !found {
		return false
	}
	return ctx.session.Providers[idx].TypeSet.Contains(id)
}

func providerMatchesStatusKind(ctx *genericCompileContext, definitionRef, statusKind, statusKey string) bool {
	if ctx == nil || ctx.session == nil || definitionRef == "" {
		return false
	}
	idx, ok := ctx.providerKeyIndex[definitionRef]
	if !ok || int(idx) >= len(ctx.session.Providers) {
		return false
	}
	provider := ctx.session.Providers[idx]
	if statusKind == model.StatusKindMovementSlow {
		for _, item := range provider.StatusContributions {
			if item.StatusKind == model.StatusKindMovementSlow && item.StatusKey == statusKey {
				return true
			}
		}
		return false
	}
	want, ok := model.ClosedStatusKindProviderType[statusKind]
	if !ok {
		return false
	}
	return providerHasTypeKey(ctx, definitionRef, want)
}

func formulaReadsKind(instr []formula.GenericInstr, kind formula.GenericReadKind) bool {
	for _, item := range instr {
		if item.Op == formula.GenericOpRead && item.ReadKind == kind {
			return true
		}
	}
	return false
}

func formulaHasForbiddenHitReads(instr []formula.GenericInstr) bool {
	for _, item := range instr {
		if item.Op != formula.GenericOpRead {
			continue
		}
		switch item.ReadKind {
		case formula.ReadEventSkillHit, formula.ReadEventDamage, formula.ReadDamageAmount, formula.ReadDamageSelf,
			formula.ReadDamageTrait, formula.ReadDamageType, formula.ReadDamageCastOrigin, formula.ReadDamageAbilityType,
			formula.ReadEventSourceAttr, formula.ReadEventTargetAttr, formula.ReadEventSourceResource, formula.ReadEventTargetResource,
			formula.ReadEventEntrySourceAttr, formula.ReadEventEntryTargetAttr, formula.ReadEventEntrySourceResource, formula.ReadEventEntryTargetResource:
			return true
		}
	}
	return false
}

func requireEventType(ctx *genericCompileContext, key, path, message string) {
	if ctx == nil || ctx.session == nil {
		return
	}
	if _, ok := ctx.session.Types.Registry.LookupDomain("event", key); ok {
		return
	}
	ctx.collector.addError(model.GenericErrUnknownTypeKey, path, message, key)
}

func validateProviderRefFromEvent(op model.OperationDefinition, path string, ownerProviderIndex int, listener *model.ListenerDefinition, ctx *genericCompileContext) {
	if !op.ProviderRefFromEvent {
		return
	}
	if op.Operation != "expire_provider" {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".providerRefFromEvent", "providerRefFromEvent is only allowed on expire_provider", op.Operation)
		return
	}
	if op.ProviderRef != "" {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".providerRef", "providerRefFromEvent cannot combine with static providerRef", op.ProviderRef)
	}
	if op.Target != model.SelectorSelf {
		ctx.collector.addError(model.GenericErrOperationTargetMissing, path+".target", "providerRefFromEvent expire_provider target must be self", op.Target)
	}
	if ownerProviderIndex < 0 || listener == nil {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".providerRefFromEvent", "providerRefFromEvent is only allowed on a provider-owned listener", "")
		return
	}
	hasBlocked := false
	for _, key := range listener.EventMatcher.All {
		if key == model.EventTypeSpellShieldBlocked {
			hasBlocked = true
			break
		}
	}
	if !hasBlocked {
		ctx.collector.addError(model.GenericErrMatcherDomainError, path+".providerRefFromEvent", "providerRefFromEvent requires eventMatcher.all to include event/spell_shield_blocked", "")
	}
	requireEventType(ctx, model.EventTypeSpellShieldBlocked, path+".providerRefFromEvent", "providerRefFromEvent requires event/spell_shield_blocked in typeCatalog")
}

func validateEmitEventNotForged(op model.OperationDefinition, path string, ctx *genericCompileContext) {
	if op.Operation != "emit_event" {
		return
	}
	eventType := op.EventType
	if eventType == "" {
		eventType = op.Ref
	}
	if model.IsEngineProducedEvent(eventType) {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".eventType", "emit_event cannot forge engine-produced events", eventType)
	}
}
