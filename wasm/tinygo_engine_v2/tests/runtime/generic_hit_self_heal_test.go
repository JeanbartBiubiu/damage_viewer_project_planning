package runtime_test

import (
	"testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func hitSelfHealInput() (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(.1, 1000, 100, 0, 0, 1)
	addKilledRecovery(&c, &r, 0, "event/basic_attack_hit")
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000})
	ability := &c.SharedProviders[1].Abilities[0]
	ability.Params = map[string]float64{"heal": 3}
	ability.ListenerSpec.Condition = nil
	ability.ListenerSpec.Operations = ability.ListenerSpec.Operations[:1]
	ability.ListenerSpec.Operations[0].Amount = authoringAmount(authoringRead("ability.param.heal"))
	return c, r
}

func TestHitSelfHealStaticAmountAndOverflow(t *testing.T) {
	for _, test := range []struct {
		name                             string
		before, amount, actual, overflow float64
	}{
		{"low_health", 500, 3, 3, 0}, {"full_health", 1000, 3, 0, 3}, {"zero_amount", 500, 0, 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			c, r := hitSelfHealInput()
			setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: test.before, Max: 1000, Resolved: 1000})
			c.SharedProviders[1].Abilities[0].Params["heal"] = test.amount
			done := authoringRun(t, c, r)
			if done.Summary.SourceFinalHp != test.before+test.actual || done.Summary.BasicAttack.CompletedCount != 1 {
				t.Fatal("actual hit self recovery failed", done.Summary)
			}
			heals := recoveryEvidence(done, model.EvidenceKindHeal)
			if test.amount > 0 {
				if len(heals) != 1 {
					t.Fatal("one real hit must publish one request", heals)
				}
				vampAmount(t, heals[0].Data, "healingBeforeModifiers", test.amount)
				vampAmount(t, heals[0].Data, "actualHealing", test.actual)
				vampAmount(t, heals[0].Data, "overheal", test.overflow)
				assertRecoveryProvenance(t, heals[0], "restore_hp", "basic:native-test:1")
			}
		})
	}
}

func TestHitSelfHealRejectsUnownedAndRuntimeAmounts(t *testing.T) {
	for _, mode := range []string{"event_amount", "attribute_amount", "negative", "opponent", "target_owner", "attack_start", "resource", "wrong_mount", "missing_hp"} {
		t.Run(mode, func(t *testing.T) {
			c, r := hitSelfHealInput()
			listener := c.SharedProviders[1].Abilities[0].ListenerSpec
			switch mode {
			case "event_amount":
				listener.Operations[0].Amount = authoringAmount(authoringRead("event.damage.mitigatedAmount"))
			case "attribute_amount":
				listener.Operations[0].Amount = authoringAmount(authoringRead("source.attr.hp.current"))
			case "negative":
				c.SharedProviders[1].Abilities[0].Params["heal"] = -1
			case "opponent":
				listener.Operations[0].Target = "target"
			case "target_owner":
				listener.EventMatcher.All = []string{"event/basic_attack_hit", "event/target_owner"}
			case "attack_start":
				listener.EventMatcher.All = []string{"event/basic_attack_start", "event/source_owner"}
			case "resource":
				listener.Operations[0].Operation, listener.Operations[0].ResourceKey = "resource_change", "mana"
			case "missing_hp":
				delete(c.Combatants[0].Attributes, "hp")
				delete(r.InitialSnapshot.Combatants[0].Attributes, "hp")
			}
			compiled := compilebundle.CompileGeneric(c)
			if !compiled.OK {
				return
			}
			if mode == "wrong_mount" {
				for i := range compiled.Session.Operations {
					if compiled.Session.Operations[i].Ref == "restore_hp" {
						compiled.Session.Operations[i].OwnerProviderIndex = 0
					}
				}
			}
			if done, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil {
				t.Fatal("unsupported hit self recovery admitted", mode, done.Summary)
			}
		})
	}
}
