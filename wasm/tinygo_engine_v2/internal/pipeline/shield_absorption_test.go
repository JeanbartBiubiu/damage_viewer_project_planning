package pipeline

import (
	"encoding/json"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
)

func TestShieldAbsorptionRowsFollowActualPriorityAndConserveDamage(t *testing.T) {
	for _, amount := range []float64{0, 40, 70, 150, 170} {
		view := CombatantView{Attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}}), Shields: []ShieldInstance{
			{ShieldRef: "own#1", DefinitionRef: "own", LifecycleProviderRef: "life#1", Source: "target", Owner: "target", Remaining: 100, Priority: 10},
			{ShieldRef: "expired", Source: "target", Owner: "target", Remaining: 999, Priority: -1, ExpireAt: 100},
			{ShieldRef: "foreign#1", Source: "source", Owner: "target", Remaining: 50, Priority: 0},
		}}
		out, next := ApplyMitigatedDamage(amount, amount, view, 100, true)
		if out.ShieldAbsorptions == nil || out.ShieldAbsorptions.Rows == nil {
			t.Fatal("completed empty collection lost its presence")
		}
		wantOther, wantOwn, wantHP := amount, 0.0, 0.0
		if wantOther > 50 {
			wantOther, wantOwn = 50, amount-50
		}
		if wantOwn > 100 {
			wantOwn, wantHP = 100, amount-150
		}
		if out.ShieldAbsorbed != wantOther+wantOwn || out.HPDamage != wantHP || attribute.ReadHP(next.Attributes) != 1000-wantHP {
			t.Fatal("collection changed actual shield/health settlement", amount, out, next)
		}
		rows := out.ShieldAbsorptions.Rows
		wantRows := 0
		if wantOther > 0 {
			wantRows++
			if rows[0].ShieldRef != "foreign#1" || rows[0].Source != "source" || rows[0].Owner != "target" || rows[0].RemainingBefore != 50 || rows[0].RemainingAfter != 50-wantOther || rows[0].Absorbed != wantOther {
				t.Fatal("another shield was attributed to the own shield", amount, rows)
			}
		}
		if wantOwn > 0 {
			wantRows++
			own := rows[1]
			if own.ShieldRef != "own#1" || own.DefinitionRef != "own" || own.LifecycleProviderRef != "life#1" || own.RemainingBefore != 100 || own.RemainingAfter != 100-wantOwn || own.Absorbed != wantOwn {
				t.Fatal("own shield fact was not captured before depletion", amount, rows)
			}
		}
		if len(rows) != wantRows {
			t.Fatal("expired or untouched shield acquired a damage fact", rows)
		}
		before := append([]ShieldAbsorption(nil), rows...)
		ApplyMitigatedDamage(1, 1, next, 101, true)
		if !reflect.DeepEqual(before, rows) && len(rows) > 0 {
			t.Fatal("a later settlement mutated an older receipt", before, rows)
		}
	}
}

func TestShieldAbsorptionCollectionIsOptInAndEvidenceHasOnlyContractFields(t *testing.T) {
	view := CombatantView{Attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}}), Shields: []ShieldInstance{{ShieldRef: "s", Source: "target", Owner: "target", Remaining: 30}}}
	plain, a := ApplyMitigatedDamage(10, 10, view, 0, false)
	captured, b := ApplyMitigatedDamage(10, 10, view, 0, true)
	if plain.ShieldAbsorptions != nil || captured.ShieldAbsorptions == nil || plain.ShieldAbsorbed != captured.ShieldAbsorbed || !reflect.DeepEqual(a, b) {
		t.Fatal("unrequested collection allocated facts or altered old damage", plain, captured)
	}
	row := captured.ShieldAbsorptions.Rows[0]
	row.ExpireAt, row.LifecycleIndex, row.LifecycleBound = 42, 3, true
	bytes, err := json.Marshal(row)
	var fields map[string]interface{}
	if err != nil || json.Unmarshal(bytes, &fields) != nil || len(fields) != 8 {
		t.Fatal("internal binding fields leaked into the shared receipt", string(bytes), err)
	}
	for _, key := range []string{"shieldRef", "definitionRef", "lifecycleProviderRef", "source", "owner", "remainingBefore", "remainingAfter", "absorbed"} {
		if _, exists := fields[key]; !exists {
			t.Fatal("missing contract receipt field", key, string(bytes))
		}
	}
}
