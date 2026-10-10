package compile

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestFormulaPhase4OriginalFixtureRemainsUnchangedAndRejected(t *testing.T) {
	const oldName = "generic_p0_basic_damage.json"
	raw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", oldName))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != "cf597916d5200bc4f5c4328fd15bb2dd0eb5c8c521a77fc815a4dfd4704fda05" {
		t.Fatal("original input bytes changed")
	}
	result := CompileGeneric(loadGenericFixtureCompileRequest(t, oldName))
	if result.OK || len(result.Result.Errors) != 1 {
		t.Fatalf("old input result=%+v", result.Result)
	}
	issue := result.Result.Errors[0]
	if issue.Phase != model.GenericPhaseCompile || issue.Code != model.GenericErrMissingDamageTypeFormula || issue.Path != "sharedProviders[0].abilities[0].operations[0].damageType" || issue.Ref != "damage/physical" {
		t.Fatalf("original operation identity lost: %+v", issue)
	}
}

func TestFormulaPhase4EveryOperationLocationRequiresAuthorFormula(t *testing.T) {
	for _, test := range []struct {
		name  string
		build func() model.CompileRequest
		path  string
	}{
		{"ability", minimalValidCompileRequest, "sharedProviders[0].abilities[0].operations[0].damageType"},
		{"rules", func() model.CompileRequest {
			r := minimalValidCompileRequest()
			r.Rules.Operations = []model.OperationDefinition{r.SharedProviders[0].Abilities[0].Operations[0]}
			r.SharedProviders[0].Abilities[0].Operations = nil
			return r
		}, "rules.operations[0].damageType"},
		{"provider listener", func() model.CompileRequest {
			r := minimalValidCompileRequest()
			r.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "probe", EventMatcher: model.TypeMatcher{All: []string{"event/damage_dealt"}}, Operations: r.SharedProviders[0].Abilities[0].Operations}}
			r.SharedProviders[0].Abilities[0].Operations = nil
			return r
		}, "sharedProviders[0].listeners[0].operations[0].damageType"},
		{"rule listener", func() model.CompileRequest {
			r := minimalValidCompileRequest()
			r.Rules.Listeners = []model.ListenerDefinition{{ListenerKey: "probe", EventMatcher: model.TypeMatcher{All: []string{"event/damage_dealt"}}, Operations: r.SharedProviders[0].Abilities[0].Operations}}
			r.SharedProviders[0].Abilities[0].Operations = nil
			return r
		}, "rules.listeners[0].operations[0].damageType"},
		{"tick", func() model.CompileRequest {
			r := minimalValidCompileRequest()
			p := &r.SharedProviders[0]
			p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "period", Kind: "tick", TickSpec: &model.TickSpec{IntervalMs: 100, OnTick: p.Abilities[0].Operations}})
			p.Abilities[0].Operations = nil
			return r
		}, "sharedProviders[0].abilities[1].tickSpec.onTick[0].damageType"},
		{"process", func() model.CompileRequest {
			r := processCompileRequest()
			r.SharedProviders[0].Processes[0].MomentOperations[0].Operations = []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: processCompileNumber(100)}}
			return r
		}, "sharedProviders[0].processes[0].momentOperations[0].operations[0].damageType"},
		{"hit candidate", func() model.CompileRequest {
			r := minimalValidCompileRequest()
			skillHitTypes(&r)
			r.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(damageCandidate(nil))}
			return r
		}, "sharedProviders[0].abilities[0].operations[0].skillHit.candidates[0].operations[0].damageType"},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := test.build()
			if result := CompileGeneric(req); !result.OK {
				t.Fatalf("authored source invalid: %+v", result.Result.Errors)
			}
			req.Rules.DamageTypeFormulas = nil
			result := CompileGeneric(req)
			if result.OK || len(result.Result.Errors) != 1 {
				t.Fatalf("missing definition result=%+v", result.Result.Errors)
			}
			issue := result.Result.Errors[0]
			if issue.Code != model.GenericErrMissingDamageTypeFormula || issue.Path != test.path || issue.Ref != "damage/physical" {
				t.Fatalf("unexpected issue=%+v", issue)
			}
		})
	}
}

func TestFormulaPhase4ZeroStillRequiresFormulaAndUnusedTypesNeedNone(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].Abilities[0].Operations[0].Amount = processCompileNumber(0)
	req.Rules.DamageTypeFormulas = nil
	if result := CompileGeneric(req); result.OK || !hasErrorCode(result.Result.Errors, model.GenericErrMissingDamageTypeFormula) {
		t.Fatalf("zero accepted missing definition: %+v", result.Result)
	}
	for _, value := range []string{"0", "1"} {
		formuladefinition.SetDamageFormula(&req, "damage/physical", formuladefinition.ConstantDefense(value))
		if result := CompileGeneric(req); !result.OK {
			t.Fatal(result.Result.Errors)
		}
	}
	req.TypeCatalog.Types = append(req.TypeCatalog.Types, model.TypeCatalogEntry{Key: "unused.original/key", Domain: "damage"})
	if result := CompileGeneric(req); !result.OK {
		t.Fatalf("unused directory required formula: %+v", result.Result.Errors)
	}
	req.SharedProviders[0].Abilities[0].Operations = nil
	req.Rules.DamageTypeFormulas = nil
	filtered := req.TypeCatalog.Types[:0]
	for _, entry := range req.TypeCatalog.Types {
		if entry.Domain != "damage" {
			filtered = append(filtered, entry)
		}
	}
	req.TypeCatalog.Types = filtered
	if result := CompileGeneric(req); !result.OK {
		t.Fatalf("no-damage preflight failed: %+v", result.Result.Errors)
	}
	unknown := minimalValidCompileRequest()
	unknown.SharedProviders[0].Abilities[0].Operations[0].DamageType = "outside-catalog"
	result := CompileGeneric(unknown)
	if result.OK || !hasErrorCode(result.Result.Errors, model.GenericErrUnknownTypeKey) || hasErrorCode(result.Result.Errors, model.GenericErrMissingDamageTypeFormula) {
		t.Fatalf("unknown directory changed error: %+v", result.Result.Errors)
	}
}
