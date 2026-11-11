package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func targetRemainingCompileInput() model.CompileRequest {
	r := minimalValidCompileRequest()
	r.TypeCatalog.Types = append(r.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	r.SharedProviders[0].InitialStateSchema = map[string]any{"mark": map[string]any{
		"valueType": "integer", "defaultValue": 0, "maxValue": 1, "durationMs": 6000, "refreshPolicy": "refresh_on_write"}}
	op := sdcValidOp("mark")
	op.Target, op.Types, op.ValuePolicy = "self", []string{"state_scope/provider_target"}, "ensure_remaining"
	value := 1250.0
	op.Amount = &model.GenericFormulaExpr{Op: "const", Value: &value}
	r.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	r.SharedProviders[0].Abilities[0].Operations[0].Condition = &model.GenericFormulaExpr{Op: "read", Path: "provider.target_state_remaining_ms.mark"}
	return r
}

func TestCompileTargetStateRemainingOwnConditions(t *testing.T) {
	r := targetRemainingCompileInput()
	result := CompileGeneric(r)
	if !result.OK || !result.Session.HasTargetStateTimeReads {
		t.Fatal(result.Result.Errors)
	}
	op := r.SharedProviders[0].Abilities[0].Operations[0]
	r.SharedProviders[0].Abilities[0].Operations = nil
	r.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "protect", EventMatcher: model.TypeMatcher{All: []string{"event/source_owner"}},
		Condition: op.Condition, Operations: []model.OperationDefinition{op}}}
	if got := CompileGeneric(r); !got.OK {
		t.Fatal(got.Result.Errors)
	}
}

func TestCompileTargetStateRemainingRejectsInvalidFieldAndConsumption(t *testing.T) {
	for _, mutation := range []string{"missing", "decimal", "untimed", "cooldown", "ammo", "foreign", "amount", "modifier", "lifecycle", "driver_global", "active_condition"} {
		t.Run(mutation, func(t *testing.T) {
			r := targetRemainingCompileInput()
			p := &r.SharedProviders[0]
			field := p.InitialStateSchema["mark"].(map[string]any)
			read := *p.Abilities[0].Operations[0].Condition
			switch mutation {
			case "missing":
				delete(p.InitialStateSchema, "mark")
			case "decimal":
				field["valueType"] = "number"
			case "untimed":
				field["durationMs"] = 0
				delete(field, "refreshPolicy")
			case "cooldown":
				field["stateKind"] = "cooldown"
				field["refreshPolicy"] = "start_on_first_write"
			case "ammo":
				field["stateKind"] = "ammo"
			case "foreign":
				foreign := *p
				foreign.ProviderKey, foreign.Abilities, foreign.Listeners, foreign.Processes = "foreign_field_owner", nil, nil, nil
				r.SharedProviders = append(r.SharedProviders, foreign)
				r.SharedProviders[0].InitialStateSchema = nil
			case "amount":
				p.Abilities[0].Operations[0].Amount = &read
			case "modifier":
				p.Modifiers = []model.ModifierDefinition{{ModifierKey: "bad", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: read}}
			case "lifecycle":
				p.Lifecycle = &model.ProviderLifecycle{DurationMs: &read}
			case "driver_global":
				r.Rules.Operations = []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "mark", Types: []string{"state_scope/provider_target"}, ValuePolicy: "set", Amount: &model.GenericFormulaExpr{Op: "const", Value: floatPtr(1)}, Condition: &read}}
			case "active_condition":
				p.Abilities[0].CastCondition = &read
			}
			got := CompileGeneric(r)
			if got.OK {
				t.Fatal("accepted unauthorized target timer", mutation)
			}
			found := false
			for _, issue := range got.Result.Errors {
				found = found || strings.Contains(issue.Message, "target state remaining") || strings.Contains(issue.Message, "ensure_remaining")
			}
			if !found {
				t.Fatal("failed without the new timer guard", got.Result.Errors)
			}
		})
	}
}

func TestCompileEnsureTargetStateRemainingStaticPositiveAmount(t *testing.T) {
	for _, mutation := range []string{"zero", "negative", "fraction", "unsafe", "dynamic", "hidden_read", "source_target", "provider_scope"} {
		t.Run(mutation, func(t *testing.T) {
			r := targetRemainingCompileInput()
			op := &r.SharedProviders[0].Abilities[0].Operations[0]
			switch mutation {
			case "zero":
				op.Amount.Value = floatPtr(0)
			case "negative":
				op.Amount.Value = floatPtr(-1)
			case "fraction":
				op.Amount.Value = floatPtr(1.25)
			case "unsafe":
				op.Amount.Value = floatPtr(9007199254740992)
			case "dynamic":
				op.Amount = &model.GenericFormulaExpr{Op: "read", Path: "source.attr.hp.current"}
			case "hidden_read":
				op.Amount = &model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{{Op: "const", Value: floatPtr(1)}, {Op: "const", Value: floatPtr(1250)}, {Op: "read", Path: "source.attr.hp.current"}}}
			case "source_target":
				op.Target = "source"
			case "provider_scope":
				op.Types = []string{"state_scope/provider"}
			}
			if got := CompileGeneric(r); got.OK {
				t.Fatal("accepted invalid ensure", mutation)
			}
		})
	}
}

func TestCompileTargetStateRemainingNamedIfCannotAuthorizeAmount(t *testing.T) {
	for _, amountUse := range []bool{false, true} {
		registry := formula.Builder{}
		register := func(p formula.GenericProgram) formula.GenericProgramID {
			id, err := registry.Register(p)
			if err != nil {
				t.Fatal(err)
			}
			return id
		}
		named := register(formula.GenericProgram{Key: "declared/timer", DeclaredNamed: true,
			Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderTargetStateRemainingMs, ReadKey: "mark"}}})
		condition := register(formula.GenericProgram{Key: "owned.condition", Instr: []formula.GenericInstr{{Op: formula.GenericOpRef, RefIndex: uint16(named)}}})
		session := plan.CompiledSession{Providers: []plan.CompiledProvider{{StateFields: map[string]plan.CompiledProviderStateField{
			"mark": {ValueType: "integer", DurationMs: 6000}}, Listeners: []plan.CompiledListener{{HasCondition: true, ConditionProgram: condition}}}}}
		if amountUse {
			// 运行只会选常量1250，但依赖展开仍必须看到未选分支中的具名读取。
			amount, err := registry.Register(formula.GenericProgram{Key: "owned.amount", Instr: []formula.GenericInstr{
				{Op: formula.GenericOpConst, Value: 1}, {Op: formula.GenericOpJumpIfZero, JumpTarget: 4},
				{Op: formula.GenericOpConst, Value: 1250}, {Op: formula.GenericOpJump, JumpTarget: 5}, {Op: formula.GenericOpRef, RefIndex: uint16(named)}}})
			if err != nil {
				t.Fatal(err)
			}
			session.Operations = []plan.CompiledOperation{{OwnerProviderIndex: 0, Operation: "heal", HasAmount: true, AmountProgram: amount}}
		}
		ctx := &genericCompileContext{session: &session, formulas: registry, collector: newGenericCollector("schema", "rules")}
		finalizeTargetStateRemaining(ctx)
		if !amountUse {
			if len(ctx.collector.errors) != 0 || !session.HasTargetStateTimeReads || !ctx.formulas.Instructions(named)[0].ReferenceBound {
				t.Fatal(ctx.collector.errors)
			}
		} else {
			found := false
			for _, issue := range ctx.collector.errors {
				found = found || issue.Path == "owned.amount" && strings.Contains(issue.Message, "only available")
			}
			if !found {
				t.Fatal("legal condition authorized a named read hidden in amount", ctx.collector.errors)
			}
		}
	}
}

func TestCompileEnsureTargetStateRemainingRejectsActualTickAnchor(t *testing.T) {
	for _, target := range []string{"mark", "ordinary"} {
		t.Run(target, func(t *testing.T) {
			r := targetRemainingCompileInput()
			p := &r.SharedProviders[0]
			p.InitialStateSchema["ordinary"] = map[string]any{"valueType": "integer", "defaultValue": 0, "maxValue": 1, "durationMs": 6000, "refreshPolicy": "refresh_on_write"}
			p.Abilities[0].Operations[0].Ref = target
			// 条件仍读取锚字段mark；只禁止改它的期限，不禁止真实余时读取。
			p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "real_anchored_expiry", Kind: "tick", TickSpec: &model.TickSpec{
				IntervalMs: 6000, AnchorScope: "state_scope/provider_target", AnchorStateKey: "mark", OnTick: []model.OperationDefinition{{
					Operation: "state_change", Target: "self", Ref: "mark", Types: []string{"state_scope/provider_target"}, ValuePolicy: "set", Amount: &model.GenericFormulaExpr{Op: "const", Value: floatPtr(0)},
				}},
			}})
			result := CompileGeneric(r)
			if target == "ordinary" {
				if !result.OK {
					t.Fatal("unrelated ordinary field or remaining read was rejected", result.Result.Errors)
				}
			} else {
				found := false
				for _, issue := range result.Result.Errors {
					found = found || strings.Contains(issue.Message, "anchored tick field")
				}
				if result.OK || !found {
					t.Fatal("actual tick anchor accepted or wrong guard rejected it", result.Result.Errors)
				}
			}
		})
	}
}
