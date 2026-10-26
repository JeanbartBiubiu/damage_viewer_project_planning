package execution

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
			done := s.buildDoneResult(false)
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
			bag := s.combatants["source"].providerState.Lookup("own_recharge")
			if tc.expiry == 0 {
				if expiries != 0 || bag.State().At("wait") != 1 || bag.ExpireAt().At("wait") != 2000 || bag.SourceExpiry("wait").Deadline != 2000 {
					t.Fatal("HP damage failed to retain the new generation", bag, expiries)
				}
			} else if expiries != 1 || bag.State().At("wait") != 0 || bag.ExpireAt().At("wait") != 0 || bag.SourceExpiry("wait").Deadline != 0 {
				t.Fatal("successful callback did not clear its wait atomically", bag, expiries)
			}
		})
	}
}

// Even a matching internal fact cannot grant protection to an ordinary field.
