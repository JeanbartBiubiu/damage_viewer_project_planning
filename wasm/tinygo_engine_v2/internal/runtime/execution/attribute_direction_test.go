package execution

import (
	"math"
	"reflect"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func attributeDirectionFrame(t *testing.T, direction string, damage float64) (*Engine, *Frame, planbundle.CompiledAbility, []planbundle.CompiledOperation) {
	t.Helper()
	c, r := frameCommitInput(frameCommitDamage(damage))
	setCombatantAttr(&c, &r, "source", "hp", authoringSlot(100))
	setCombatantAttr(&c, &r, "target", "hp", authoringSlot(200))
	setCombatantAttr(&c, &r, "source", "armor", authoringSlot(0))
	c.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{{
		CombatantKey: "source", AttributeKey: "attack_speed", ValuePolicy: "set", ValueType: "DECIMAL", Value: authoringConst(1),
	}}
	modifierOwner := "target"
	sourceKey, targetKey := "source", "source"
	if direction == "reverse" {
		modifierOwner = "source"
		sourceKey, targetKey = "target", "source"
	}
	c.Rules.Modifiers = []model.ModifierDefinition{{
		ModifierKey: "inverse_health", Kind: "attribute", Target: modifierOwner + ".attr.armor", ValuePolicy: "add",
		Value: authoringBinary("div", authoringConst(1), authoringRead("source.attr.hp.current")),
	}}
	compiled := authoringCompile(t, c)
	r.ExpectedRulesHash = compiled.RulesHash
	state, err := newGenericRunState(compiled, r)
	if err != nil {
		t.Fatal(err)
	}
	ability, ref, found := state.lookupDriverAbility(r.DriverPlan.Entries[0])
	if !found {
		t.Fatal("missing compiled direction-test ability")
	}
	frame := state.newExecutionFrame(sourceKey, targetKey, ref)
	// 常量派生本身不读取生命，但原补算路径仍核对全局双方普通修正。
	// 重复刷新让本帧及单项缓存都先经历稳定、有效的结果。
	for pass := 0; pass < 3; pass++ {
		frame.reResolveStagedAttributesTwoPass(ability)
		if frame.fatal || frame.stageFor("source").attributesView().At("attack_speed").Resolved != 1 {
			t.Fatalf("stable %s refresh %d: error=%v source=%+v", direction, pass, frame.fatalErr, frame.stageFor("source").attributesView())
		}
	}
	start := int(ability.OperationStart)
	return state, frame, ability, compiled.Operations[start : start+int(ability.OperationCount)]
}

func TestAttributeDirectionRefreshDoesNotHideForcedGlobalFormulaError(t *testing.T) {
	for _, direction := range []string{"self", "reverse"} {
		t.Run(direction, func(t *testing.T) {
			state, frame, ability, ops := attributeDirectionFrame(t, direction, 100)
			beforeSource := state.combatants["source"].attributesView()
			beforeTarget := state.combatants["target"].attributesView()
			err := frame.executeOperations(ability, ops)
			if err == nil {
				err = frame.fatalErr
			}
			if !frame.fatal || err == nil || err.Code != model.GenericErrFormulaTypeError || !strings.Contains(err.Message, "division by zero") {
				t.Fatalf("%s refresh hid global source HP=0: error=%v staged=%+v", direction, err, frame.stageFor("source").attributesView())
			}
			modifierOwner := "target"
			if direction == "reverse" {
				modifierOwner = "source"
			}
			if !strings.Contains(err.Path, "combatants."+modifierOwner+".attributes") {
				t.Fatalf("error lost the actual modifier owner: %+v", err)
			}
			if frame.stageFor("source").attributesView().At("hp").Current != 0 {
				t.Fatal("failure happened before the intended lethal health change")
			}
			frame.commit()
			if frame.committed || !reflect.DeepEqual(state.combatants["source"].attributesView(), beforeSource) || !reflect.DeepEqual(state.combatants["target"].attributesView(), beforeTarget) {
				t.Fatalf("failed %s refresh published staged attributes", direction)
			}
		})
	}
}

func TestAttributeDirectionValidRefreshKeepsConstantDerivationAndCommitsHealth(t *testing.T) {
	for _, direction := range []string{"self", "reverse"} {
		t.Run(direction, func(t *testing.T) {
			state, frame, ability, ops := attributeDirectionFrame(t, direction, 50)
			if err := frame.executeOperations(ability, ops); err != nil {
				t.Fatal(err)
			}
			if state.combatantHp("source") != 100 || frame.stageFor("source").attributesView().At("hp").Current != 50 || frame.stageFor("source").attributesView().At("attack_speed").Resolved != 1 {
				t.Fatal("valid refresh changed its constant output or published health early")
			}
			// 反向帧的普通 source 读取仍沿帧 source(target) 求值，
			// 全局补算只为派生准备独立视图，不重映射原普通结果。
			if direction == "reverse" && math.Abs(frame.stageFor("source").attributesView().At("armor").Resolved-1.0/200) > 1e-12 {
				t.Fatalf("ordinary reverse-frame source changed meaning: %+v", frame.stageFor("source").attributesView())
			}
			frame.commit()
			if frame.fatal || !frame.committed || state.combatantHp("source") != 50 || state.combatantHp("target") != 200 || state.combatants["source"].attributesView().At("attack_speed").Resolved != 1 {
				t.Fatalf("valid %s refresh failed to commit: error=%v combatants=%+v", direction, frame.fatalErr, state.combatants)
			}
		})
	}
}
