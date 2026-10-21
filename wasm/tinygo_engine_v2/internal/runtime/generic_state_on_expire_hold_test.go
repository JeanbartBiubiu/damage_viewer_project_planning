package runtime

import (
	"math"
	"testing"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// This synthetic source exercises the alternative explicit fact conditions; it
// is independent of the still-unselected hero authoring policy.
func firstShieldExpiryInput(secondDamage float64, end int64) (model.CompileRequest, model.RunRequest) {
	c, r := ownExpiryInput(1000, 1, 46, 2)
	p := &c.SharedProviders[2]
	p.Listeners[1].Condition = authoringAmount(authoringBinary("gt", authoringRead("event.damage.actualHpLoss"), gfConst(0)))
	first := p.Listeners[1]
	first.ListenerKey = "first_shield_starts_wait"
	first.Condition = authoringAmount(authoringBinary("mul", authoringBinary("gt", authoringRead("event.damage.mitigatedAmount"), gfConst(0)),
		authoringBinary("mul", authoringBinary("eq", authoringRead("event.damage.actualHpLoss"), gfConst(0)), authoringBinary("eq", authoringRead("provider.state.wait"), gfConst(0)))))
	p.Listeners = append(p.Listeners, first)
	c.SharedProviders[3].Listeners[0].Operations[0].Amount = authoringAmount(authoringBinary("add", gfConst(46), authoringBinary("mul", authoringRead("provider.state.count"), gfConst(secondDamage-46))))
	r.StopPolicy.DurationMs = end
	return c, r
}

func TestStateOnExpirePendingWaitDistinguishesShieldOnlyFromHPAtDeadline(t *testing.T) {
	for _, tc := range []struct {
		name         string
		secondDamage float64
		end          int64
		shield, hp   float64
		expiry       int64
	}{
		{"shield_only_keeps_old_deadline", 46, 1000, 100, 1000, 1000},
		{"hp_loss_restarts_before_new_deadline", 460, 1999, 0, 880, 0},
		{"hp_loss_new_deadline_ignores_old_callback", 460, 2000, 100, 880, 2000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, r := firstShieldExpiryInput(tc.secondDamage, tc.end)
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			s, err := newGenericRunState(compiled.Session, r)
			if err != nil {
				t.Fatal(err)
			}
			if err = s.runLoop(); err != nil {
				t.Fatal(err)
			}
			done := s.buildDoneResult()
			if math.Abs(ownShieldRemaining(done)-tc.shield) > 1e-9 || math.Abs(done.Summary.SourceFinalHp-tc.hp) > 1e-9 {
				t.Fatal(done.Summary, done.FinalSnapshot)
			}
			expiries := 0
			for _, event := range done.Evidence.Items {
				if event.Kind != "provider_state_expired" {
					continue
				}
				expiries++
				if event.TimeMs != tc.expiry {
					t.Fatal("stale or delayed expiry settled", event)
				}
			}
			bag := s.combatants["source"].providerState["own_recharge"]
			if tc.expiry == 0 {
				if expiries != 0 || bag.state["wait"] != 1 || bag.expireAt["wait"] != 2000 || bag.sourceExpiryFacts["wait"].deadline != 2000 {
					t.Fatal("HP damage failed to retain the new generation", bag, expiries)
				}
			} else if expiries != 1 || bag.state["wait"] != 0 || bag.expireAt["wait"] != 0 || bag.sourceExpiryFacts["wait"].deadline != 0 {
				t.Fatal("successful callback did not clear its wait atomically", bag, expiries)
			}
		})
	}
}

func TestSourceExpiryHoldProtectsOnlyItsExactActiveBagField(t *testing.T) {
	makeBag := func() *providerStateBag {
		bag := &providerStateBag{state: map[string]float64{"wait": 1}, expireAt: map[string]int64{"wait": 500},
			fieldDefs:         map[string]providerStateFieldDef{"wait": {hasOnExpire: true, durationMs: 500}},
			sourceExpiryFacts: map[string]sourceStateExpiryFact{"wait": {generation: 1, deadline: 500}}}
		bag.ensure()
		return bag
	}
	active := makeBag()
	active.state["ordinary"], active.expireAt["ordinary"] = 1, 500
	active.fieldDefs["ordinary"] = providerStateFieldDef{durationMs: 500}
	// Even a matching internal fact cannot grant protection to an ordinary field.
	active.sourceExpiryFacts["ordinary"] = sourceStateExpiryFact{generation: 1, deadline: 500}
	for _, tc := range []struct {
		name   string
		change func(*providerStateBag)
	}{
		{"other_instance_without_fact", func(b *providerStateBag) { b.sourceExpiryFacts = nil }},
		{"stale_deadline", func(b *providerStateBag) {
			b.sourceExpiryFacts["wait"] = sourceStateExpiryFact{generation: 2, deadline: 1000}
		}},
		{"missing_generation", func(b *providerStateBag) { b.sourceExpiryFacts["wait"] = sourceStateExpiryFact{deadline: 500} }},
		{"already_cleared", func(b *providerStateBag) { b.state["wait"] = 0 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			other := makeBag()
			tc.change(other)
			if !other.needsLazyExpiration(500) || !other.needsReadPreparation(nil, 500, providerStateReadOptions{}) {
				t.Fatal("unprotected state skipped expiry")
			}
			other.lazyExpireProviderState(500)
			if other.state["wait"] != 0 || other.expireAt["wait"] != 0 {
				t.Fatal("unrelated or inactive state was protected", other)
			}
			if active.state["wait"] != 1 || active.expireAt["wait"] != 500 {
				t.Fatal("another instance changed the pending field", active)
			}
		})
	}
	active.lazyExpireProviderState(500)
	if active.state["wait"] != 1 || active.expireAt["wait"] != 500 || active.state["ordinary"] != 0 || active.expireAt["ordinary"] != 0 {
		t.Fatal("callback hold leaked into ordinary expiry", active)
	}
	if active.needsLazyExpiration(500) || active.needsReadPreparation(nil, 500, providerStateReadOptions{}) {
		t.Fatal("exact callback hold disagreed between read paths")
	}
	active.lazyExpireProviderState(501)
	if active.state["wait"] != 0 || active.expireAt["wait"] != 0 {
		t.Fatal("callback protection extended beyond its exact deadline", active)
	}
}
