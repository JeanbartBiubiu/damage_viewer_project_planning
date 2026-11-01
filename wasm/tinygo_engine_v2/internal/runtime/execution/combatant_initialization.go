package execution

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
)

func materializeCombatants(snapshot model.Snapshot, compiled planbundle.CompiledSession, formulas formula.GenericRegistry, sessionID string) (map[string]combatantRuntime, *model.EngineError) {
	if err := validateShieldLifecycleSnapshot(snapshot, compiled, sessionID); err != nil {
		return nil, err
	}
	if err := validateProviderElapsedSnapshot(snapshot, compiled, sessionID); err != nil {
		return nil, err
	}
	out := make(map[string]combatantRuntime, len(snapshot.Combatants))
	layout := compiled.AttributeLayout
	var additional []string
	for _, c := range snapshot.Combatants {
		for key := range c.Attributes {
			additional = append(additional, key)
		}
	}
	if layout == nil {
		layout = attribute.NewLayout(additional)
	} else {
		layout = layout.Extend(additional)
	}
	combatantKeys := make(map[string]bool, len(snapshot.Combatants))
	for _, c := range snapshot.Combatants {
		combatantKeys[c.Key] = true
	}
	for i, c := range snapshot.Combatants {
		attrs := c.Attributes
		resources := c.Resources
		if resources == nil {
			resources = map[string]model.ResourceSlotDef{}
		}
		path := "initialSnapshot.combatants[" + itoa(uint32(i)) + "]"
		providers, resolver, err := effectpkg.RestoreProviders(c.Providers, c.Key, compiled, combatantKeys, path, compiled.SchemaHash, compiled.RulesHash, sessionID)
		if err != nil {
			return nil, err
		}
		shields := effectpkg.RestoreShields(c.Shields, c.Key)
		out[c.Key] = combatantRuntime{
			instances:     effectpkg.NewInstances(providers, shields, resolver, effectpkg.DamageResolver{}, effectpkg.ResourceContributions{}),
			numbers:       actor.New(c.Key, attribute.FromMap(attrs, layout), resources),
			cooldowns:     materializeCooldowns(c.Cooldowns, c.Key),
			providerState: effectpkg.RestoreBags(c.ProviderState),
		}
	}

	remountAllProviderModifiers(out, compiled)
	for key, c := range out {
		resolver := c.instances.Attributes()
		damageResolver := c.instances.Damage()
		mountRuleModifiers(&resolver, &damageResolver, key, compiled)
		c.instances.SetAttributes(resolver)
		c.instances.SetDamage(damageResolver)
		out[key] = c
	}
	// Resolve with same-combatant eval first, then cross-combatant context.
	for key, c := range out {
		evalCtx := formula.GenericEvalContext{
			SourceAttrs: c.attributesView(),
			TargetAttrs: c.attributesView(),
		}
		resolvedAttributes, resolveErr := c.instances.Attributes().ResolveAttributesWithProviderContext(
			c.attributesView(), evalCtx, formulas,
			materializedProviderFormulaContext(out, compiled, key, "", snapshot.TimeMs),
		)
		c.setAttributes(resolvedAttributes)

		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}
		out[key] = c
	}
	// Re-resolve with cross-combatant eval context after both sides exist.
	sourceAttrs := attribute.Table{}
	targetAttrs := attribute.Table{}
	if src, ok := out[model.SelectorSource]; ok {
		sourceAttrs = src.attributesView()
	}
	if tgt, ok := out[model.SelectorTarget]; ok {
		targetAttrs = tgt.attributesView()
	}
	for key, c := range out {
		evalCtx := formula.GenericEvalContext{
			SourceAttrs: sourceAttrs,
			TargetAttrs: targetAttrs,
		}
		// Same-combatant cast-proxy default remains target (historical materialize semantics).
		castProxy := model.SelectorTarget
		resolvedAttributes, resolveErr := c.instances.Attributes().ResolveAttributesWithProviderContext(
			c.attributesView(), evalCtx, formulas,
			materializedProviderFormulaContext(out, compiled, key, castProxy, snapshot.TimeMs),
		)
		c.setAttributes(resolvedAttributes)

		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}
		out[key] = c
	}
	for _, key := range []string{"source", "target"} {
		actor, exists := out[key]
		if !exists {
			continue
		}
		var providerContext pipeline.ProviderFormulaContextFunc
		if compiled.HasProviderElapsedReads || compiled.HasFiniteModifierExpiry {
			providerContext = materializedProviderFormulaContext(out, compiled, key, model.SelectorTarget, snapshot.TimeMs)
		}
		resolved, resolveErr := evaluation.ResolveDerivedAttributes(compiled.AttributeDerivations, formulas, key, actor.attributesView(), actor.instances.Attributes(), out["source"].attributesView(), out["target"].attributesView(), providerContext)
		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}

		actor.setAttributes(resolved)
		out[key] = actor
	}
	return out, nil
}

func mountRuleModifiers(resolver *effectpkg.AttributeResolver, damageResolver *effectpkg.DamageResolver, combatantKey string, compiled planbundle.CompiledSession) {
	for _, mod := range compiled.RuleModifiers {
		if mod.Kind == "pipeline" {
			mountRulePipelineModifier(damageResolver, combatantKey, mod)
			continue
		}
		if mod.Kind != "attribute" && mod.Kind != "" {
			continue
		}
		selector := pipeline.ModifierTargetCombatantSelector(mod.Target)
		switch selector {
		case "":
			// Bare attribute key: apply to both combatants is too broad; skip unless path is explicit.
			// Provider-mounted bare keys remain supported via MountProviderModifiers.
			continue
		case model.SelectorSource:
			if combatantKey != model.SelectorSource {
				continue
			}
		case model.SelectorTarget:
			if combatantKey != model.SelectorTarget {
				continue
			}
		case model.SelectorSelf, model.SelectorOpponent:
			// Rule-level self/opponent has no entry context; treat as source/target aliases.
			if selector == model.SelectorSelf && combatantKey != model.SelectorSource {
				continue
			}
			if selector == model.SelectorOpponent && combatantKey != model.SelectorTarget {
				continue
			}
		default:
			if combatantKey != selector {
				continue
			}
		}
		resolver.MountCompiledModifier("rules", mod)
	}
}

// mountRulePipelineModifier mounts rules pipeline modifiers by stage ownership:
// command=crit + outgoing_pre_mitigation → source;
// incoming_crit_part_post_mitigation + incoming_post_mitigation → target.
func mountRulePipelineModifier(damageResolver *effectpkg.DamageResolver, combatantKey string, mod planbundle.CompiledModifier) {
	if damageResolver == nil {
		return
	}
	switch mod.Command {
	case "crit":
		switch mod.Stage {
		case "crit_chance_pre_settlement", "crit_multiplier_forced_branch", "crit_multiplier_natural_branch":
			if combatantKey != model.SelectorSource {
				return
			}
		default:
			return
		}
	case "damage":
		switch mod.Stage {
		case "outgoing_pre_mitigation":
			if combatantKey != model.SelectorSource {
				return
			}
		case "incoming_crit_part_post_mitigation", "incoming_post_mitigation":
			if combatantKey != model.SelectorTarget {
				return
			}
		default:
			return
		}
	case "heal":
	default:
		return
	}
	damageResolver.MountCompiledModifierOwned("", "rules", mod)
}

func cloneAttributeMap(src map[string]model.AttributeSlotDef) map[string]model.AttributeSlotDef {
	dst := make(map[string]model.AttributeSlotDef, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func cloneResourceMap(src map[string]model.ResourceSlotDef) map[string]model.ResourceSlotDef {
	dst := make(map[string]model.ResourceSlotDef, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func cloneSnapshot(src model.Snapshot) model.Snapshot {
	dst := src
	dst.Combatants = make([]model.CombatantSnapshot, len(src.Combatants))
	for i, c := range src.Combatants {
		dst.Combatants[i] = c
		if c.Attributes != nil {
			dst.Combatants[i].Attributes = cloneAttributeMap(c.Attributes)
		}
		if c.Resources != nil {
			dst.Combatants[i].Resources = cloneResourceMap(c.Resources)
		}
	}
	if src.UseTriggerLedger != nil {
		dst.UseTriggerLedger = append([]model.UseTriggerLedgerEntry(nil), src.UseTriggerLedger...)
	} else {
		dst.UseTriggerLedger = []model.UseTriggerLedgerEntry{}
	}
	return dst
}
