package execution

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func groupedDamageDefinition(key string, value float64) model.ModifierDefinition {
	group := "amplification_one"
	return model.ModifierDefinition{ModifierKey: key, Kind: "pipeline", Command: "damage", Channel: "all_damage", Stage: "outgoing_pre_mitigation", Bucket: "first_per_cast", ValuePolicy: "multiply", Value: authoringConst(value), MultiplierGroupKey: &group}
}

func groupedFrameInput() (model.CompileRequest, model.RunRequest) {
	c, r := frameCommitInput(frameCommitDamage(100))
	for _, key := range []string{"flag", "multiplier"} {
		value := 0.0
		if key == "multiplier" {
			value = 1.3
		}
		c.Combatants[0].Attributes[key] = authoringSlot(value)
		r.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(value)
	}
	return c, r
}

func setGroupedFrameAttribute(f *Frame, key string, value float64) {
	staged := f.stageFor("source")
	staged.setAttributes(staged.attributesView().With(key, authoringSlot(value)))
}

func groupedFrameAmount(f *Frame, ability planbundle.CompiledAbility, amount float64) (float64, *model.EngineError) {
	value, _, err := f.applyPipelineDamageModifiers("source", "source", "target", "damage", "outgoing_pre_mitigation", amount, ability, "damage/physical", nil, nil)
	return value, err
}

func TestGroupedDamageFirstPerCastConsumesQualifiedMembersAndResetsPerFrame(t *testing.T) {
	c, r := groupedFrameInput()
	a, b := groupedDamageDefinition("a", 1.2), groupedDamageDefinition("b", 1.3)
	a.Condition = authoringAmount(authoringRead("source.attr.flag.current"))
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
	s := frameCommitState(t, c, r)
	f, ability, _ := frameCommitFrame(s)
	for index, want := range []float64{130, 120, 100} {
		if index == 1 {
			setGroupedFrameAttribute(f, "flag", 1)
		}
		got, err := groupedFrameAmount(f, ability, 100)
		if err != nil || math.Abs(got-want) > 1e-10 {
			t.Fatal(index, got, want, err)
		}
		if count := len(f.numeric.FirstPerCast()); count != []int{1, 2, 2}[index] {
			t.Fatal(index, count)
		}
	}
	next, nextAbility, _ := frameCommitFrame(s)
	setGroupedFrameAttribute(next, "flag", 1)
	if value, err := groupedFrameAmount(next, nextAbility, 100); err != nil || value != 150 {
		t.Fatal(value, err)
	}
}

func TestGroupedDamageDynamicFailurePublishesNoPartialConsumption(t *testing.T) {
	c, r := groupedFrameInput()
	a, b := groupedDamageDefinition("a", 1.2), groupedDamageDefinition("b", 1.3)
	b.Value = authoringRead("source.attr.multiplier.current")
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
	s := frameCommitState(t, c, r)
	f, ability, _ := frameCommitFrame(s)
	for _, value := range []float64{.8, math.Inf(1)} {
		setGroupedFrameAttribute(f, "multiplier", value)
		_, err := groupedFrameAmount(f, ability, 100)
		if err == nil || err.Code != model.GenericErrFormulaTypeError || !strings.Contains(err.Ref, "modifier[b]") || !strings.Contains(err.Path, ".value") || len(f.numeric.FirstPerCast()) != 0 {
			t.Fatal(value, err, f.numeric.FirstPerCast())
		}
	}
	setGroupedFrameAttribute(f, "multiplier", 1.3)
	if value, err := groupedFrameAmount(f, ability, 100); err != nil || value != 150 || len(f.numeric.FirstPerCast()) != 2 {
		t.Fatal(value, err, f.numeric.FirstPerCast())
	}
}

func TestGroupedDamageNeutralAndZeroAreAppliedMembers(t *testing.T) {
	for _, value := range []float64{1, 1.2} {
		c, r := groupedFrameInput()
		c.SharedProviders[0].Modifiers = []model.ModifierDefinition{groupedDamageDefinition("a", value), groupedDamageDefinition("b", 1.3)}
		s := frameCommitState(t, c, r)
		f, ability, _ := frameCommitFrame(s)
		if amount, err := groupedFrameAmount(f, ability, 0); err != nil || amount != 0 || len(f.numeric.FirstPerCast()) != 2 {
			t.Fatal(value, amount, err)
		}
		if amount, err := groupedFrameAmount(f, ability, 100); err != nil || amount != 100 {
			t.Fatal(amount, err)
		}
	}
}

func TestGroupedDamageSourceIdentityAndDualChannelDeduplicate(t *testing.T) {
	c, r := groupedFrameInput()
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{groupedDamageDefinition("shared_name", 1.2)}
	s := frameCommitState(t, c, r)
	f, ability, _ := frameCommitFrame(s)
	basic, ok := s.compiled.Types.LookupForEntity(model.AbilityTypeBasicAttack, typeset.EntityAbility)
	if !ok {
		t.Fatal("fixture missing basic attack type")
	}
	ability.TypeSet = typeset.TypeSet{}
	ability.TypeSet.Add(basic)
	staged := f.stageFor("source")
	provider := s.req.InitialSnapshot.Combatants[0].Providers[0].ProviderRef
	modifier := s.compiled.Providers[0].Modifiers[0]
	modifier.Channel = "basic_damage"
	staged.instances.MountDamageCompiled("source", provider, modifier)
	staged.instances.AppendProvider(effectpkg.Provider{ProviderRef: "second_source", DefinitionRef: s.compiled.Providers[0].ProviderKey, DefinitionIndex: 0, Source: "source", Owner: "source", Stacks: 1})
	staged.instances.MountDamageCompiled("source", "second_source", modifier)
	value, err := groupedFrameAmount(f, ability, 100)
	if err != nil || math.Abs(value-140) > 1e-10 || len(f.numeric.FirstPerCast()) != 2 {
		t.Fatal(value, err, f.numeric.FirstPerCast())
	}
}

func TestGroupedDamageExactExpiryBeforeCleanupAndIndependentBandPosition(t *testing.T) {
	c, r := groupedFrameInput()
	b := groupedDamageDefinition("permanent", 1.3)
	b.Bucket = "all_instances"
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{b}
	s := frameCommitState(t, c, r)
	for _, at := range []int64{999, 1000} {
		f, ability, _ := frameCommitFrame(s)
		s.loop.Advance(at)
		staged := f.stageFor("source")
		staged.instances.AppendProvider(effectpkg.Provider{ProviderRef: "finite_source", DefinitionRef: s.compiled.Providers[0].ProviderKey, DefinitionIndex: 0, Source: "source", Owner: "source", Stacks: 1, ExpireAt: 1000})
		mod := s.compiled.Providers[0].Modifiers[0]
		mod.ModifierKey = "finite"
		mod.ValueProgram = 0
		// 注册一个真实常量程序，期限由实例决定，不能以缺少清理事件继续参与。
		id, regErr := fixtureRegister(&s.formulas, formula.GenericProgram{Key: "test/finite", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1.2}}})
		if regErr != nil {
			t.Fatal(regErr)
		}
		mod.ValueProgram = id
		staged.instances.MountDamageCompiled("source", "finite_source", mod)
		value, err := groupedFrameAmount(f, ability, 100)
		want := 150.0
		if at == 1000 {
			want = 130
		}
		if err != nil || math.Abs(value-want) > 1e-10 {
			t.Fatal(at, value, err)
		}
	}
}

func TestGroupedDamageDynamicSumAndProductOverflowIsAtomicEvenAtZero(t *testing.T) {
	for _, kind := range []string{"sum", "product"} {
		c, r := groupedFrameInput()
		a, b := groupedDamageDefinition("a", 1.2), groupedDamageDefinition("b", 1.3)
		b.Value = authoringRead("source.attr.multiplier.current")
		mods := []model.ModifierDefinition{a, b}
		if kind == "sum" {
			other := b
			other.ModifierKey = "c"
			mods = append(mods, other)
		} else {
			otherGroup := "amplification_two"
			mods[1].MultiplierGroupKey = &otherGroup
		}
		c.SharedProviders[0].Modifiers = mods
		s := frameCommitState(t, c, r)
		f, ability, _ := frameCommitFrame(s)
		setGroupedFrameAttribute(f, "multiplier", math.MaxFloat64)
		_, err := groupedFrameAmount(f, ability, 0)
		if err == nil || !strings.Contains(err.Message, "overflow") || err.Ref == "" || len(f.numeric.FirstPerCast()) != 0 {
			t.Fatal(kind, err, f.numeric.FirstPerCast())
		}
	}
}

func TestGroupedDamageFullShieldStillConsumesAppliedMembers(t *testing.T) {
	c, r := groupedFrameInput()
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{groupedDamageDefinition("a", 1.2), groupedDamageDefinition("b", 1.3)}
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "shield", Target: "target", ShieldRef: "grouped_shield", Amount: authoringAmount(authoringConst(150))},
		frameCommitDamage(100), frameCommitDamage(100),
	}
	done, err := runForTest(authoringCompile(t, c), r)
	if err != nil || done.Summary.SourceDamageDealt != 250 || done.Summary.TargetFinalHp != 900 {
		t.Fatal(done.Summary, err)
	}
}

// 原生数值组合探针；作者生产用例由Web固定机制另行验证。
func TestGroupedDamageCritDefensePriorityAndShieldHandCalculation(t *testing.T) {
	c, r := cappedFlatInput(t, .5)
	setCombatantAttr(&c, &r, "source", "attack_damage", authoringSlot(200))
	setCombatantAttr(&c, &r, "target", "armor", authoringSlot(100))
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "damage/physics", Formula: formuladefinition.ConstantDefense("0.5")}}
	for pi := range c.SharedProviders {
		for mi := range c.SharedProviders[pi].Modifiers {
			mod := &c.SharedProviders[pi].Modifiers[mi]
			if mod.MaximumReductionRatio != nil {
				mod.Value = authoringConst(20)
				mod.MaximumReductionRatio = model.Float64Ptr(.2)
			}
		}
	}
	for _, stage := range []string{"outgoing_pre_mitigation", "incoming_post_mitigation"} {
		for index, value := range []float64{1.2, 1.3} {
			mod := groupedDamageDefinition(stage+string(rune('a'+index)), value)
			mod.Bucket = "all_instances"
			mod.Stage = stage
			c.Rules.Modifiers = append(c.Rules.Modifiers, mod)
		}
	}
	c.Rules.Modifiers = append(c.Rules.Modifiers,
		c2PipelineMod("critical_part", "damage", "all_damage", "incoming_crit_part_post_mitigation", "multiply", .8, 0),
		c2PipelineMod("before_group", "damage", "all_damage", "incoming_post_mitigation", "subtract", 10, -10),
	)
	numbers := cappedNumbers(t, c, r)
	for label, values := range map[string][2]float64{"raw": {numbers.RawAmount, 450}, "normal_defense": {numbers.NormalPartPostResistance, 70}, "critical_defense": {numbers.CritPartPostResistance, 145}, "mitigated": {numbers.MitigatedAmount, 264}} {
		if math.Abs(values[0]-values[1]) > 1e-9 {
			t.Fatal(label, values, numbers)
		}
	}
	shields := effectpkg.ShieldList{}.Append(effectpkg.Shield{ShieldRef: "hand_shield", Source: "target", Owner: "target", Remaining: 30})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(1000)})
	out, after, _ := shields.ApplyDamage(numbers.RawAmount, numbers.MitigatedAmount, attrs, 0, true)
	if math.Abs(out.HPDamage-234) > 1e-9 || out.ShieldAbsorbed != 30 || math.Abs(attribute.ReadHP(after)-766) > 1e-9 {
		t.Fatal(out, after)
	}
}
