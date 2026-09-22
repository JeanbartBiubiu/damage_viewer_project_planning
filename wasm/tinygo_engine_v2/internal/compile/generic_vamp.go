package compile

import (
	"math"
	"sort"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

type CompiledVampRule struct {
	VampType           string
	SourceAttributeKey string
	BasisOutputKind    string
	DefaultEfficiency  float64
	TargetMatcher      typeset.Matcher
	AbilityMatcher     typeset.Matcher
	DamageMatcher      typeset.Matcher
}

type CompiledVampOverride struct {
	VampType          string
	Mode              string
	BasisOutputKind   string
	EfficiencyProgram formula.GenericProgramID
	Path              string
}

func vampTypeIndex(kind string) int {
	for i, known := range model.VampTypeOrder {
		if kind == known {
			return i
		}
	}
	return -1
}

func validVampBasis(basis string) bool {
	return basis == model.VampPostDefense || basis == model.VampActualHPLoss
}

func compileVampRules(rules []model.VampRuleDefinition, combatants []model.CombatantDefinition, ctx *genericCompileContext) {
	if len(rules) > 0 {
		for i, c := range combatants {
			found := false
			for _, key := range c.Types {
				if strings.HasPrefix(key, "combatant/") {
					found = true
				}
			}
			if !found {
				ctx.collector.addError(model.GenericErrMissingRequiredField, "combatants["+itoa(i)+"].types", "vamp rules require an explicit combatant classification", c.Key)
			}
		}
	}
	seen := map[string]bool{}
	for i, rule := range rules {
		path := "rules.vampRules[" + itoa(i) + "]"
		add := ctx.collector.addError
		if vampTypeIndex(rule.VampType) < 0 || seen[rule.VampType] {
			add(model.GenericErrUnknownRef, path+".vampType", "unknown or duplicate vamp type", rule.VampType)
		}
		seen[rule.VampType] = true
		if !validVampBasis(rule.BasisOutputKind) {
			add(model.GenericErrUnknownRef, path+".basisOutputKind", "unsupported vamp basis", rule.BasisOutputKind)
		}
		efficiency := 0.0
		if rule.DefaultEfficiency == nil {
			add(model.GenericErrMissingRequiredField, path+".defaultEfficiency", "vamp efficiency is required; explicit zero is allowed", rule.VampType)
		} else {
			efficiency = *rule.DefaultEfficiency
		}
		if math.IsNaN(efficiency) || math.IsInf(efficiency, 0) || efficiency < 0 {
			add(model.GenericErrFormulaTypeError, path+".defaultEfficiency", "vamp efficiency must be finite and non-negative", rule.VampType)
		}
		found := false
		for _, c := range combatants {
			if _, ok := c.Attributes[rule.SourceAttributeKey]; ok {
				found = true
			}
		}
		if strings.TrimSpace(rule.SourceAttributeKey) == "" {
			add(model.GenericErrMissingRequiredField, path+".sourceAttributeKey", "vamp source attribute is required", "")
		} else if !found {
			add(model.GenericErrUnknownRef, path+".sourceAttributeKey", "vamp source attribute is not declared on any combatant", rule.SourceAttributeKey)
		}
		compiled := CompiledVampRule{
			VampType: rule.VampType, SourceAttributeKey: rule.SourceAttributeKey,
			BasisOutputKind: rule.BasisOutputKind, DefaultEfficiency: efficiency,
			TargetMatcher:  compileVampMatcher(rule.TargetMatcher, "combatant", path+".targetMatcher", ctx),
			AbilityMatcher: compileVampMatcher(rule.AbilityMatcher, "ability", path+".abilityMatcher", ctx),
			DamageMatcher:  compileVampMatcher(rule.DamageMatcher, "damage_trait", path+".damageMatcher", ctx),
		}
		ctx.session.VampRules = append(ctx.session.VampRules, compiled)
	}
	sort.SliceStable(ctx.session.VampRules, func(i, j int) bool {
		return vampTypeIndex(ctx.session.VampRules[i].VampType) < vampTypeIndex(ctx.session.VampRules[j].VampType)
	})
}

func validateVampAbilityInputs(def model.AbilityDefinition, ability CompiledAbility, path string, ctx *genericCompileContext) {
	if len(ctx.session.VampRules) == 0 {
		return
	}
	for _, op := range ctx.session.Operations[int(ability.OperationStart):] {
		if op.Operation != "damage" {
			continue
		}
		found := false
		for _, key := range def.Types {
			if strings.HasPrefix(key, "ability/") {
				found = true
			}
		}
		if !found {
			ctx.collector.addError(model.GenericErrMissingRequiredField, path+".types", "vamp damage requires an explicit ability classification", def.AbilityKey)
		}
		for _, override := range op.VampOverrides {
			if override.Mode != model.VampOverride {
				continue
			}
			for _, instr := range ctx.session.Formulas.Programs[override.EfficiencyProgram].Instr {
				if instr.Op == formula.GenericOpRead && instr.ReadKind == formula.ReadAbilityParam {
					if _, ok := def.Params[instr.ReadKey]; !ok {
						ctx.collector.addError(model.GenericErrUnknownRef, override.Path, "missing ability parameter: "+instr.ReadKey, instr.ReadKey)
					}
				}
			}
		}
	}
}

func compileVampMatcher(input model.TypeMatcher, domain, path string, ctx *genericCompileContext) typeset.Matcher {
	add := ctx.collector.addError
	if len(input.Any)+len(input.All) == 0 {
		add(model.GenericErrMissingRequiredField, path, "vamp matcher requires a positive type constraint", "")
	}
	for _, part := range []struct {
		suffix string
		keys   []string
	}{{"any", input.Any}, {"all", input.All}, {"none", input.None}} {
		seen := map[string]bool{}
		for i, key := range part.keys {
			p := path + "." + part.suffix + "[" + itoa(i) + "]"
			id, ok := ctx.catalog.Registry.Lookup(key)
			if !ok {
				add(model.GenericErrUnknownTypeKey, p, "unknown vamp matcher type", key)
				continue
			}
			if ctx.catalog.Domains[id] != domain {
				add(model.GenericErrMatcherDomainError, p, "vamp matcher requires domain "+domain, key)
			}
			if seen[key] {
				add(model.GenericErrUnknownTypeKey, p, "duplicate vamp matcher type", key)
			}
			seen[key] = true
		}
	}
	matcher, _ := typeset.CompileMatcher(model.TypeMatcherV2{Any: input.Any, All: input.All, None: input.None}, ctx.catalog.Registry)
	return matcher
}

func compileVampOverrides(op model.OperationDefinition, out *CompiledOperation, path string, ctx *genericCompileContext) {
	add := ctx.collector.addError
	out.VampQualification = op.VampQualification
	if op.Operation != "damage" {
		if op.VampQualification != "" || len(op.VampOverrides) != 0 {
			add(model.GenericErrUnknownRef, path, "vamp fields require a damage operation", op.Operation)
		}
		return
	}
	if op.VampQualification != "" && op.VampQualification != model.VampResolved {
		add(model.GenericErrMissingRequiredField, path+".vampQualification", "damage vamp qualification must be RESOLVED before compilation", op.VampQualification)
	}
	if len(ctx.session.VampRules) > 0 && op.VampQualification != model.VampResolved {
		add(model.GenericErrMissingRequiredField, path+".vampQualification", "game vamp rules require resolved damage qualification", op.Ref)
	}
	if len(ctx.session.VampRules) == 0 && (op.VampQualification == model.VampResolved || len(op.VampOverrides) > 0) {
		add(model.GenericErrMissingRequiredField, path+".vampQualification", "resolved vamp damage requires configured game rules", op.Ref)
	}
	if len(ctx.session.VampRules) > 0 {
		for _, pair := range [][2]string{{"damage_trait/delivery_skill", "damage_trait/delivery_basic_attack"}, {"damage_trait/origin_direct", "damage_trait/origin_reflected"}} {
			count := 0
			for _, key := range op.Types {
				if key == pair[0] || key == pair[1] {
					count++
				}
			}
			if count != 1 {
				add(model.GenericErrMissingRequiredField, path+".types", "vamp damage requires exactly one of "+pair[0]+" and "+pair[1], op.Ref)
			}
		}
	}
	seen := map[string]bool{}
	for i, item := range op.VampOverrides {
		p := path + ".vampOverrides[" + itoa(i) + "]"
		if vampTypeIndex(item.VampType) < 0 || seen[item.VampType] {
			add(model.GenericErrUnknownRef, p+".vampType", "unknown or duplicate vamp override type", item.VampType)
		}
		seen[item.VampType] = true
		found := false
		for _, rule := range ctx.session.VampRules {
			if rule.VampType == item.VampType {
				found = true
			}
		}
		if !found {
			add(model.GenericErrUnknownRef, p+".vampType", "vamp override requires the corresponding game rule", item.VampType)
		}
		v := CompiledVampOverride{VampType: item.VampType, Mode: item.Mode, BasisOutputKind: item.BasisOutputKind, Path: p + ".efficiency"}
		switch item.Mode {
		case model.VampDisabled:
			if item.BasisOutputKind != "" || item.Efficiency != nil {
				add(model.GenericErrUnknownRef, p, "DISABLED forbids basis and efficiency", item.VampType)
			}
		case model.VampOverride:
			if !validVampBasis(item.BasisOutputKind) {
				add(model.GenericErrUnknownRef, p+".basisOutputKind", "OVERRIDE requires a valid basis", item.VampType)
			}
			if item.Efficiency == nil {
				add(model.GenericErrMissingRequiredField, p+".efficiency", "OVERRIDE requires efficiency", item.VampType)
			} else {
				instr := formula.CompileGenericFormula(*item.Efficiency, p+".efficiency", ctx.namedFormulas, map[string]bool{}, add)
				validateDamagePredicateReads(instr, p+".efficiency", ctx.catalog, add)
				if item.Efficiency.Op == "const" && item.Efficiency.Value != nil && *item.Efficiency.Value < 0 {
					add(model.GenericErrFormulaTypeError, p+".efficiency", "vamp efficiency must be non-negative", item.VampType)
				}
				v.EfficiencyProgram = ctx.registerFormula(p+".efficiency", instr)
			}
		default:
			add(model.GenericErrUnknownRef, p+".mode", "unsupported vamp override mode", item.Mode)
		}
		out.VampOverrides = append(out.VampOverrides, v)
	}
	sort.SliceStable(out.VampOverrides, func(i, j int) bool {
		return vampTypeIndex(out.VampOverrides[i].VampType) < vampTypeIndex(out.VampOverrides[j].VampType)
	})
}

func validateHealPipelineModifier(mod CompiledModifier, path string, collector *genericCollector) {
	add := collector.addError
	if mod.HealDirection != model.HealDone && mod.HealDirection != model.HealReceived {
		add(model.GenericErrUnknownRef, path+".healDirection", "heal direction must be DONE or RECEIVED", mod.HealDirection)
	}
	if mod.HealCategory != model.HealAny && mod.HealCategory != model.HealVamp && mod.HealCategory != model.HealDirect {
		add(model.GenericErrUnknownRef, path+".healCategory", "heal category must be ANY, VAMP or DIRECT", mod.HealCategory)
	}
	if strings.TrimSpace(mod.HealGroupKey) == "" {
		add(model.GenericErrMissingRequiredField, path+".healGroupKey", "heal group key is required", mod.ModifierKey)
	}
	if mod.ValuePolicy != "add_percent" {
		add(model.GenericErrUnknownRef, path+".valuePolicy", "heal valuePolicy must be add_percent", mod.ValuePolicy)
	}
	mode := normalizeHealGroupMode(mod.HealGroupCalculationMode)
	if mode != model.HealGroupRatioAdd && mode != model.HealGroupRatioMax {
		add(model.GenericErrUnknownRef, path+".healGroupCalculationMode", "healGroupCalculationMode must be ratio_add or ratio_max", mod.HealGroupCalculationMode)
	}
	if mode == model.HealGroupRatioMax && mod.HealDirection != model.HealReceived {
		add(model.GenericErrUnknownRef, path+".healDirection", "ratio_max requires healDirection=RECEIVED", mod.HealDirection)
	}
	if !mod.HasValue {
		add(model.GenericErrMissingRequiredField, path+".value", "heal modifier value is required", mod.ModifierKey)
	}
	if mod.Channel != "" || mod.Stage != "" || mod.Bucket != "" {
		add(model.GenericErrUnknownRef, path, "heal modifiers use healDirection, healCategory and healGroupKey; damage channel/stage/bucket are forbidden", mod.ModifierKey)
	}
}
