// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	os "os"
	filepath "path/filepath"
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func resourceMaxInput(t *testing.T, current, maximum float64, apply bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, run := singleSkillInput(false)
	p := hitFlatProvider("health_window", "armor", 40)
	p.Lifecycle.DurationMs = timedShieldExpr(15000)
	p.Modifiers = append(p.Modifiers, model.ModifierDefinition{ModifierKey: "health", Kind: "resource_max", Target: "self.attr.hp", ValuePolicy: "add", Value: hitConst(300), CurrentValuePolicy: "grant_positive_delta_clamp"})
	input.SharedProviders = append(input.SharedProviders, p)
	for _, actor := range []map[string]model.AttributeSlotDef{input.Combatants[0].Attributes, run.InitialSnapshot.Combatants[0].Attributes} {
		hp := actor["hp"]
		hp.Base, hp.Max, hp.Current, hp.Resolved = maximum, maximum, current, current
		actor["hp"] = hp
	}
	if apply {
		input.SharedProviders[0].Processes[0].MomentOperations = append(input.SharedProviders[0].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: p.ProviderKey}}})
	}
	return input, run
}

func TestResourceMaxActualRunAndRetention(t *testing.T) {
	input, run := resourceMaxInput(t, 500, 1500, true)
	full := authoringRun(t, input, run)
	if full.Summary.SourceFinalHp != 800 || full.FinalSnapshot.Combatants[0].Attributes["hp"].Max != 1800 || full.ResourceChangeSummary.ChangeCount != 1 || len(*full.ResourceChangeRecords) != 1 {
		t.Fatal(full.Summary, full.ResourceChangeSummary, full.FinalSnapshot)
	}
	row := (*full.ResourceChangeRecords)[0]
	if row.CurrentDelta != 300 || row.MaxDelta != 300 || row.CurrentBefore != 500 || row.MaxBefore != 1500 || row.Contributors[0].UseRef != "skill:cast_once" || row.HealthOrder >= full.DamageRecords[0]["healthOrder"].(uint64) {
		t.Fatal(row, full.DamageRecords)
	}
	for _, mode := range []model.RunOutputMode{"", model.RunOutputSummary} {
		for _, budget := range []int{0, 1} {
			r := run
			r.OutputMode = mode
			r.RecordBudget = &model.RecordBudget{MaxResourceChangeRecords: &budget}
			done := authoringRun(t, input, r)
			if !reflect.DeepEqual(full.Summary, done.Summary) || !reflect.DeepEqual(full.ResourceChangeSummary, done.ResourceChangeSummary) || !reflect.DeepEqual(full.FinalSnapshot, done.FinalSnapshot) {
				t.Fatal("retention changed battle", mode, budget)
			}
			want := budget
			if mode == model.RunOutputSummary {
				want = 0
			}
			if len(*done.ResourceChangeRecords) != want || *done.Recording.ReturnedResourceChangeRecords != want || *done.Recording.ResourceChangeRecordsTruncated != (budget == 0) {
				t.Fatal(done.Recording)
			}
		}
	}
	if os.Getenv("DAMAGE_NASUS_DUMP") == "1" {
		dir := filepath.Join("..", "..", "target", "nasus-mechanisms-2026-10-19", "native-v1", "fixtures")
		if configured := os.Getenv("DAMAGE_NASUS_DUMP_DIR"); configured != "" {
			dir = configured
		}
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		for _, item := range []struct {
			name  string
			value interface{}
		}{{"compile", input}, {"request", run}, {"done", full}} {
			raw, err := json.MarshalIndent(item.value, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "resource-"+item.name+".json"), raw, 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
}
