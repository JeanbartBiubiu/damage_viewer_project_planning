package runtime

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

// 独立构造通用机制数据，不读取或复制通用基准样例，也不代表真实管理数据验收。
func authoringConst(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}
func authoringRead(path string) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "read", Path: path}
}
func authoringBinary(op string, a, b model.GenericFormulaExpr) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: op, Args: []model.GenericFormulaExpr{a, b}}
}
func authoringAmount(expr model.GenericFormulaExpr) *model.GenericFormulaExpr { return &expr }
func authoringSlot(v float64) model.AttributeSlotDef {
	return model.AttributeSlotDef{Base: v, Current: v, Max: v, Resolved: v}
}
func authoringRef(key string) string { return "source.provider[attack].ability[" + key + "]" }

func authoringInput() (model.CompileRequest, model.RunRequest) {
	damage := model.OperationDefinition{CritMultiplierMin: model.Float64Ptr(1), Operation: "damage", Target: "target", Ref: "body", Amount: authoringAmount(authoringRead("source.attr.attack_damage.resolved")), DamageType: "damage/physics", CritEligible: true,
		CritChance:     authoringAmount(authoringRead("source.attr.critical_strike_chance.resolved")),
		CritMultiplier: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "test/critical_multiplier"})}
	link := model.OperationDefinition{Operation: model.OperationKindApplyHitLink, Target: "target", Ref: "hit_link", Amount: authoringAmount(authoringConst(1))}
	candidate := func(key, result string, op model.OperationDefinition) model.SkillHitCandidate {
		return model.SkillHitCandidate{CandidateKey: key, EffectOccurrenceKey: "attack_hit", EffectKey: "body_effect", ResultKey: key,
			Semantic: model.SkillHitSemantic{ResultType: result, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentInstant}, Operations: []model.OperationDefinition{op}}
	}
	process := model.ProcessDefinition{ProcessKey: "attack", SkillKey: "test_attack", Steps: []model.ProcessStepDefinition{{StepKey: "begin", StepType: "IMMEDIATE"}}, Costs: []model.ProcessCostDefinition{},
		Cooldown:         &model.ProcessCooldownDefinition{DurationMs: model.GenericFormulaExpr{Op: "round", Expr: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "test/attack_interval_ms"})}, StartMoment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}},
		MomentOperations: []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: model.OperationKindApplyAttackLink, Target: "target", Ref: "attack_link", Amount: authoringAmount(authoringConst(1))}}}}}
	c := model.CompileRequest{SchemaVersion: model.GenericSchemaVersion, SchemaHash: "authoring-schema", RulesHash: "authoring-rules"}
	for _, entry := range []model.TypeCatalogEntry{
		{Key: "combatant/champion", Domain: "combatant"}, {Key: "provider/skill", Domain: "provider"}, {Key: model.AbilityTypeBasicAttack, Domain: "ability"},
		{Key: "damage/physics", Domain: "damage"}, {Key: model.EventTypeBasicAttackStart, Domain: "event"}, {Key: model.EventTypeBasicAttackHit, Domain: "event"},
		{Key: model.EventTypeAttackLinkApplied, Domain: "event"}, {Key: model.EventTypeHitLinkApplied, Domain: "event"}, {Key: "event/source_owner", Domain: "event"},
	} {
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, entry)
	}
	c.SharedProviders = []model.ProviderDefinition{{SkillKey: "test_attack", ProviderKey: "test_attack", Kind: "skill", StableID: "test_attack", Types: []string{"provider/skill"}, Processes: []model.ProcessDefinition{process}, Abilities: []model.AbilityDefinition{
		{AbilityKey: "native_start", Kind: "active", SkillKey: "test_attack", Types: []string{model.AbilityTypeBasicAttack}},
		{AbilityKey: "initial", Kind: "active", SkillKey: "test_attack", Types: []string{model.AbilityTypeBasicAttack}, ProcessControl: &model.ProcessControlDefinition{ProcessKey: "attack", Action: "INITIAL", UseRefFromEvent: true}},
		{AbilityKey: "native_hit", Kind: "active", SkillKey: "test_attack", Params: map[string]float64{"base_critical_multiplier": 2}, Types: []string{model.AbilityTypeBasicAttack}, Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: "test_attack", Candidates: []model.SkillHitCandidate{candidate("damage", model.SkillHitResultDamage, damage), candidate("hit_link", model.SkillHitResultHitLink, link)}}}}},
	}, Listeners: []model.ListenerDefinition{{ListenerKey: "start_process", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackStart, "event/source_owner"}}, AbilityRef: authoringRef("initial")}}}}
	sourceAttrs := map[string]model.AttributeSlotDef{"hp": authoringSlot(1000), "attack_damage": authoringSlot(100), "attack_speed": authoringSlot(.7), "critical_strike_chance": authoringSlot(.25), "critical_strike_damage_bonus_percent": authoringSlot(.3), "armor_pen_percent": authoringSlot(.25), "armor_pen_flat": authoringSlot(10)}
	targetAttrs := map[string]model.AttributeSlotDef{"hp": authoringSlot(1000), "armor": authoringSlot(120)}
	c.Combatants = []model.CombatantDefinition{
		{Key: "source", Types: []string{"combatant/champion"}, Attributes: sourceAttrs, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{{ProviderRef: "attack", DefinitionRef: "test_attack"}}},
		{Key: "target", Types: []string{"combatant/champion"}, Attributes: targetAttrs, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{}},
	}
	for _, key := range []string{"armor", "armor_pen_percent", "armor_pen_flat", "attack_speed", "critical_strike_damage_bonus_percent"} {
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
	}
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "damage/physics", Formula: map[string]any{
		"inputs": []any{phase3Input("armor", "target", "armor", "TOTAL"), phase3Input("percent", "source", "armor_pen_percent", "TOTAL"), phase3Input("flat", "source", "armor_pen_flat", "TOTAL")},
		"stages": []any{
			phase3Stage("effective", phase3Binary("max", phase3Const("0"), phase3Binary("sub", phase3Binary("mul", phase3Read("armor"), phase3Binary("sub", phase3Const("1"), phase3Read("percent"))), phase3Read("flat")))),
			phase3Stage("factor", phase3Binary("div", phase3Const("100"), phase3Binary("add", phase3Const("100"), phase3Ref("effective")))),
		}, "outputStageKey": "factor",
	}}}
	c.Formulas = []model.NamedFormula{
		formuladefinition.FromExpr("test/attack_interval_ms", "test_attack", authoringBinary("div", authoringConst(1000), authoringRead("source.attr.attack_speed.resolved")), nil),
		formuladefinition.FromExpr("test/critical_multiplier", "test_attack", authoringBinary("add", authoringRead("ability.param.base_critical_multiplier"), authoringRead("source.attr.critical_strike_damage_bonus_percent.resolved")), map[string]float64{"base_critical_multiplier": 2}),
	}
	use := "attack/1"
	r := model.RunRequest{SessionID: "test-session", InitialSnapshot: model.Snapshot{SchemaHash: c.SchemaHash, RulesHash: c.RulesHash, Combatants: []model.CombatantSnapshot{
		{Key: "source", Attributes: sourceAttrs, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderSnapshot{{ProviderRef: "attack", DefinitionRef: "test_attack", Source: "source", Owner: "source", Stacks: 1}}},
		{Key: "target", Attributes: targetAttrs, Resources: map[string]model.ResourceSlotDef{}},
	}}, StopPolicy: model.StopPolicy{DurationMs: 100}, SkillUses: []model.SkillUseFact{{UseKey: use, Source: "source", SkillKey: "test_attack", HistoryState: model.SkillHitHistoryComplete}},
		AttackStartFacts: []model.AttackStartFact{{DriverEntryKey: "start", UseRef: use}}, SkillHitFacts: []model.SkillHitFact{{DriverEntryKey: "hit", UseRef: &use}},
		DriverPlan: model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "start", AbilityRef: authoringRef("native_start"), Source: "source", Target: "target", FirstAtMs: 0}, {EntryKey: "hit", AbilityRef: authoringRef("native_hit"), Source: "source", Target: "target", FirstAtMs: 25}}}}
	return c, r
}

func authoringCompile(t *testing.T, c model.CompileRequest) planbundle.CompiledSession {
	t.Helper()
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	return result.Session
}
func authoringRun(t *testing.T, c model.CompileRequest, r model.RunRequest) model.DoneResult {
	t.Helper()
	session := authoringCompile(t, c)
	r.ExpectedRulesHash = session.RulesHash
	done, err := RunGeneric(session, r)
	if err != nil {
		t.Fatalf("run: %+v", err)
	}
	return done
}

func TestAuthoringSingleAttackConsumesCritDefenseProcessAndLinks(t *testing.T) {
	c, r := authoringInput()
	done := authoringRun(t, c, r)
	expected := 132.5 * 100 / 180
	if math.Abs(done.Summary.SourceDamageDealt-expected) > 1e-9 || math.Abs(done.Summary.TargetFinalHp-(1000-expected)) > 1e-9 {
		t.Fatal(done.Summary)
	}
	if len(done.FinalSnapshot.ProcessInstances) != 1 || done.FinalSnapshot.ProcessInstances[0].UseKey != "attack/1" || done.FinalSnapshot.ProcessInstances[0].Status != "complete" {
		t.Fatal(done.FinalSnapshot.ProcessInstances)
	}
	counts := map[string]int{}
	for _, evidence := range done.Evidence.Items {
		if evidence.Kind == model.EvidenceKindEmittedEvent {
			counts[evidence.Ref]++
			if evidence.Ref == model.EventTypeAttackLinkApplied || evidence.Ref == model.EventTypeHitLinkApplied {
				if evidence.Data["useRef"] != "attack/1" || evidence.Data["skillKey"] != "test_attack" || evidence.Data["LINK_INDEX"] != 1 || evidence.Data["LINK_COUNT"] != 1 {
					t.Fatal(evidence)
				}
			}
		}
		if evidence.Kind == "damage" && (evidence.Data["multiplier"] != 2.3 || math.Abs(evidence.Data["resistanceFactor"].(float64)-100.0/180) > 1e-12) {
			t.Fatal(evidence)
		}
	}
	for _, event := range []string{model.EventTypeBasicAttackStart, model.EventTypeBasicAttackHit, model.EventTypeAttackLinkApplied, model.EventTypeHitLinkApplied} {
		if counts[event] != 1 {
			t.Fatalf("events=%v", counts)
		}
	}
	if value := done.FinalSnapshot.Combatants[0].Cooldowns[authoringRef("initial")]; value == nil {
		t.Fatal("missing rounded process cooldown", done.FinalSnapshot.Combatants[0].Cooldowns)
	}
}

func TestAuthoringLinkCountsAndNumericEventValues(t *testing.T) {
	for _, count := range []float64{0, 2} {
		c, r := authoringInput()
		candidate := &c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[1]
		candidate.Operations[0].Amount = authoringAmount(authoringConst(count))
		c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners, model.ListenerDefinition{ListenerKey: "read_link", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeHitLinkApplied, "event/source_owner"}}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "source", Amount: authoringAmount(authoringRead("event.link.index"))}}})
		slot := r.InitialSnapshot.Combatants[0].Attributes["hp"]
		slot.Current = 500
		r.InitialSnapshot.Combatants[0].Attributes["hp"] = slot
		done := authoringRun(t, c, r)
		expectedHeal := count * (count + 1) / 2
		if done.Summary.SourceFinalHp != 500+expectedHeal {
			t.Fatal(done.Summary)
		}
		emitted := 0
		zeroSeen := false
		for _, e := range done.Evidence.Items {
			if e.Kind == model.EvidenceKindEmittedEvent && e.Ref == model.EventTypeHitLinkApplied {
				emitted++
				if e.Data["LINK_COUNT"] != int(count) || e.Data["LINK_INDEX"] != emitted {
					t.Fatal(e)
				}
			}
			if e.Kind == "link_application" && e.Data["eventType"] == model.EventTypeHitLinkApplied && e.Data["count"] == 0 {
				zeroSeen = true
			}
		}
		if emitted != int(count) || count == 0 && !zeroSeen {
			t.Fatalf("count=%v events=%d zero=%v", count, emitted, zeroSeen)
		}
	}
}

func TestAuthoringEachResultOwnsItsCritMultiplier(t *testing.T) {
	c, r := authoringInput()
	plan := c.SharedProviders[0].Abilities[2].Operations[0].SkillHit
	other := plan.Candidates[0]
	other.CandidateKey, other.ResultKey = "other", "other"
	other.Operations = append([]model.OperationDefinition(nil), other.Operations...)
	other.Operations[0].CritMultiplier = authoringAmount(authoringConst(1))
	plan.Candidates = append(plan.Candidates, other)
	c.Combatants[0].Attributes["crit_damage"] = authoringSlot(99)
	r.InitialSnapshot.Combatants[0].Attributes["crit_damage"] = authoringSlot(99)
	done := authoringRun(t, c, r)
	if math.Abs(done.Summary.SourceDamageDealt-(132.5+100)*100/180) > 1e-9 || done.FinalSnapshot.Combatants[0].Attributes["crit_damage"].Resolved != 99 {
		t.Fatal(done.Summary, done.FinalSnapshot.Combatants[0].Attributes)
	}
}

func TestAuthoringConfiguredKnownTypeReplacesNativeDefense(t *testing.T) {
	c, r := authoringInput()
	c.TypeCatalog.Types[3].Key = "damage/physical"
	c.Rules.DamageTypeFormulas[0].DamageType = "damage/physical"
	c.Rules.DamageTypeFormulas[0].Formula = phase3ConstantDefinition("0.2")
	c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0].Operations[0].DamageType = "damage/physical"
	done := authoringRun(t, c, r)
	if math.Abs(done.Summary.SourceDamageDealt-26.5) > 1e-9 {
		t.Fatal("configured factor was ignored or native defense was applied twice", done.Summary)
	}
}

func TestAuthoringPhantomKeepsCritAndEntryDefenseWithoutDoubleSettlement(t *testing.T) {
	c, r := authoringInput()
	// 允许真实改变防御与暴击属性，避免配置最大值夹取使冻结断言无效。
	for _, key := range []string{"armor_pen_flat", "critical_strike_damage_bonus_percent"} {
		slot := c.Combatants[0].Attributes[key]
		slot.Max = 1000
		c.Combatants[0].Attributes[key] = slot
		r.InitialSnapshot.Combatants[0].Attributes[key] = slot
	}
	slot := c.Combatants[1].Attributes["armor"]
	slot.Max = 1000
	c.Combatants[1].Attributes["armor"] = slot
	r.InitialSnapshot.Combatants[1].Attributes["armor"] = slot
	c.SharedProviders[0].InitialStateSchema = map[string]interface{}{"copy_ready": 1.0}
	ab := &c.SharedProviders[0].Abilities[2]
	damage := ab.Operations[0].SkillHit.Candidates[0].Operations[0]
	damage.CopyableOnHit = true
	ab.Operations[0].SkillHit.Candidates = nil
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "copy_effect", Kind: "active", SkillKey: "test_attack", Types: []string{model.AbilityTypeBasicAttack}, Params: map[string]float64{"base_critical_multiplier": 2}, Operations: []model.OperationDefinition{
		damage,
		{Operation: "attribute_change", Target: "target", AttributeKey: "armor", ValuePolicy: "add_flat", Amount: authoringAmount(authoringConst(120))},
		{Operation: "attribute_change", Target: "source", AttributeKey: "armor_pen_flat", ValuePolicy: "add_flat", Amount: authoringAmount(authoringConst(10))},
		{Operation: "attribute_change", Target: "source", AttributeKey: "critical_strike_damage_bonus_percent", ValuePolicy: "add_flat", Amount: authoringAmount(authoringConst(.5))},
		{Operation: model.OperationKindRepeat, RepeatScope: model.RepeatScopeCopyableOnHit, RepeatCount: 1, RepeatTag: "copy", TriggerStateKey: "copy_ready", Threshold: 1},
	}})
	c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners, model.ListenerDefinition{ListenerKey: "copy_effect", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}}, AbilityRef: authoringRef("copy_effect")})
	done := authoringRun(t, c, r)
	if math.Abs(done.Summary.SourceDamageDealt-2*132.5*100/180) > 1e-9 {
		t.Fatal("phantom repeated crit or used changed defense", done.Summary)
	}
	if done.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved != 240 || done.FinalSnapshot.Combatants[0].Attributes["armor_pen_flat"].Resolved != 20 || done.FinalSnapshot.Combatants[0].Attributes["critical_strike_damage_bonus_percent"].Resolved != .8 {
		t.Fatal("defense and crit did not actually change", done.FinalSnapshot.Combatants)
	}
	rows := 0
	for _, e := range done.Evidence.Items {
		if e.Kind == "damage" {
			rows++
			if e.Data["rawAmount"] != 132.5 || e.Data["multiplier"] != 2.3 {
				t.Fatal(e)
			}
			phase3AssertNear(t, e.Data["resistanceFactor"].(float64), 100.0/180)
		}
	}
	if rows != 2 {
		t.Fatalf("expected real and copied damage, got %d", rows)
	}
}

func TestAuthoringCompileRejectsMissingOrMisboundDeclarations(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*model.CompileRequest)
		path   string
	}{
		{"missing custom defense", func(c *model.CompileRequest) { c.Rules.DamageTypeFormulas = nil }, ".damageType"},
		{"partial crit", func(c *model.CompileRequest) {
			c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0].Operations[0].CritMultiplier = nil
		}, ".critMultiplier"},
		{"other event control", func(c *model.CompileRequest) {
			c.SharedProviders[0].Listeners[0].EventMatcher.All = []string{model.EventTypeBasicAttackHit, "event/source_owner"}
		}, ".abilityRef"},
		{"not source owner", func(c *model.CompileRequest) {
			c.SharedProviders[0].Listeners[0].EventMatcher.All = []string{model.EventTypeBasicAttackStart}
		}, ".abilityRef"},
		{"link masquerades damage", func(c *model.CompileRequest) {
			c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[1].Semantic.ResultType = model.SkillHitResultDamage
		}, ".operations"},
		{"forged link", func(c *model.CompileRequest) {
			c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners, model.ListenerDefinition{ListenerKey: "forged", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit}}, Operations: []model.OperationDefinition{{Operation: "emit_event", Target: "target", EventType: model.EventTypeHitLinkApplied}}})
		}, ".eventType"},
	} {
		t.Run(test.name, func(t *testing.T) {
			c, _ := authoringInput()
			test.change(&c)
			result := compile.CompileGeneric(c)
			if result.OK {
				t.Fatal("invalid declaration compiled")
			}
			for _, err := range result.Result.Errors {
				if strings.Contains(err.Path, test.path) {
					return
				}
			}
			t.Fatalf("missing expected path %q: %+v", test.path, result.Result.Errors)
		})
	}
}

func TestAuthoringRejectsIllegalOrHugeLinkCounts(t *testing.T) {
	for _, count := range []float64{-1, .5, 1e20} {
		c, _ := authoringInput()
		c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[1].Operations[0].Amount = authoringAmount(authoringConst(count))
		if compile.CompileGeneric(c).OK {
			t.Fatalf("illegal constant count %v compiled", count)
		}
	}
	for _, count := range []float64{-1, .5, 1e20} {
		c, r := authoringInput()
		c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[1].Operations[0].Amount = authoringAmount(authoringRead("source.attr.link_count.resolved"))
		c.Combatants[0].Attributes["link_count"] = authoringSlot(count)
		r.InitialSnapshot.Combatants[0].Attributes["link_count"] = authoringSlot(count)
		session := authoringCompile(t, c)
		r.ExpectedRulesHash = session.RulesHash
		_, err := RunGeneric(session, r)
		if err == nil || !strings.HasSuffix(err.Path, ".amount") {
			t.Fatalf("illegal runtime count %v accepted or path missing: %+v", count, err)
		}
	}
}

func TestAuthoringRejectsMissingNumbersAndBorrowedUse(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*model.CompileRequest, *model.RunRequest)
		path   string
	}{
		{"crit chance absent", func(c *model.CompileRequest, r *model.RunRequest) {
			delete(c.Combatants[0].Attributes, "critical_strike_chance")
			delete(r.InitialSnapshot.Combatants[0].Attributes, "critical_strike_chance")
		}, ".critChance"},
		{"defense absent", func(c *model.CompileRequest, r *model.RunRequest) {
			delete(c.Combatants[1].Attributes, "armor")
			delete(r.InitialSnapshot.Combatants[1].Attributes, "armor")
		}, "/inputKey"},
		{"divide zero", func(c *model.CompileRequest, r *model.RunRequest) {
			c.Rules.DamageTypeFormulas[0].Formula = phase3Definition(nil, []any{phase3Stage("factor", phase3Binary("div", phase3Const("1"), phase3Const("0")))}, "factor")
		}, "/expression"},
		{"event control driver", func(c *model.CompileRequest, r *model.RunRequest) {
			r.DriverPlan.Entries[0].AbilityRef = authoringRef("initial")
			r.AttackStartFacts = nil
			r.ProcessCommandFacts = []model.ProcessCommandFact{{DriverEntryKey: "start", UseRef: "attack/1"}}
		}, ".abilityRef"},
		{"other skill", func(c *model.CompileRequest, r *model.RunRequest) {
			c.SharedProviders[0].Abilities[0].SkillKey = "other"
			r.SkillUses[0].SkillKey = "other"
			r.SkillHitFacts = nil
			r.DriverPlan.Entries = r.DriverPlan.Entries[:1]
		}, "processControl.useRefFromEvent"},
		{"missing start", func(c *model.CompileRequest, r *model.RunRequest) {
			r.DriverPlan.Entries = r.DriverPlan.Entries[1:]
			r.AttackStartFacts = nil
		}, ".useRef"},
		{"different hit target", func(c *model.CompileRequest, r *model.RunRequest) {
			r.DriverPlan.Entries[0].Target = "source"
		}, ".useRef"},
		{"past native driver", func(c *model.CompileRequest, r *model.RunRequest) {
			r.InitialSnapshot.TimeMs = 1
		}, ".firstAtMs"},
		{"other owner", func(c *model.CompileRequest, r *model.RunRequest) {
			c.Combatants[1].Providers = []model.CombatantProviderMount{{ProviderRef: "attack", DefinitionRef: "test_attack"}}
			r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "attack", DefinitionRef: "test_attack", Source: "target", Owner: "target", Stacks: 1}}
			c.SharedProviders[0].Listeners[0].AbilityRef = "target.provider[attack].ability[initial]"
		}, "processControl.useRefFromEvent"},
	} {
		t.Run(test.name, func(t *testing.T) {
			c, r := authoringInput()
			test.change(&c, &r)
			if test.name == "other skill" {
				result := compile.CompileGeneric(c)
				if result.OK || !strings.Contains(result.Result.Errors[0].Path, ".skillKey") {
					t.Fatalf("foreign skill must fail independent compile ownership: %+v", result.Result.Errors)
				}
				return
			}
			session := authoringCompile(t, c)
			r.ExpectedRulesHash = session.RulesHash
			_, err := RunGeneric(session, r)
			if err == nil || !strings.Contains(err.Path, test.path) {
				t.Fatalf("expected %s: %+v", test.path, err)
			}
		})
	}
}
