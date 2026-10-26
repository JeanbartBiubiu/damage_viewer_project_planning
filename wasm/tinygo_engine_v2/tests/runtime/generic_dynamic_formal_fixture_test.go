// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	os "os"
	filepath "path/filepath"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func TestDynamicModifiersAdditionalFormalFixtures(t *testing.T) {
	for _, name := range []string{"total-ratio", "cooldown"} {
		var input model.CompileRequest
		var run model.RunRequest
		if name == "total-ratio" {
			input, run = hitFlatFixture(t, "total", 1999, true)
			p := &input.SharedProviders[1]
			p.Modifiers[0].Stage, p.Modifiers[0].ValuePolicy, p.Modifiers[0].Value = "total", "multiply", hitConst(.7)
		} else {
			input, run = resourceMaxInput(t, 500, 1500, true)
			refs := []string{"source.provider[caster].ability[initial]"}
			input.SharedProviders[1].Modifiers = append(input.SharedProviders[1].Modifiers, model.ModifierDefinition{ModifierKey: "duration", Kind: "cooldown_duration", Target: "self", ValuePolicy: "multiply", Value: hitConst(.5), AffectedAbilityRefs: &refs})
			again := run.DriverPlan.SkillActions[0]
			again.InstructionKey = "second_cast"
			again.FirstAtMs = 1500
			run.DriverPlan.SkillActions = append(run.DriverPlan.SkillActions, again)
			run.StopPolicy.DurationMs = 2000
		}
		done := authoringRun(t, input, run)
		if name == "total-ratio" && snapshotAttribute(t, done, "target", "armor") != 70 {
			t.Fatal(done.FinalSnapshot)
		}
		if name == "cooldown" {
			if done.Summary.SkillActions.AcceptedCount != 2 || done.ResourceChangeSummary.ChangeCount != 1 {
				t.Fatal(done.Summary, done.ResourceChangeSummary)
			}
			found := false
			for _, c := range done.FinalSnapshot.Combatants {
				if c.Key == "source" {
					if c.Cooldowns["source.provider[caster].ability[initial]"].(map[string]interface{})["readyAtMs"] != int64(2000) {
						t.Fatal(c.Cooldowns)
					}
					found = true
				}
			}
			if !found {
				t.Fatal("missing cooldown owner")
			}
		}
		if os.Getenv("DAMAGE_NASUS_DUMP") == "1" {
			dir := os.Getenv("DAMAGE_NASUS_DUMP_DIR")
			if dir == "" {
				dir = filepath.Join("..", "..", "target", "nasus-mechanisms-2026-10-19", "native-v2", "fixtures")
			}
			if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			for _, item := range []struct {
				name  string
				value interface{}
			}{{"compile", input}, {"request", run}, {"done", done}} {
				raw, err := json.MarshalIndent(item.value, "", "  ")
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(dir, name+"-"+item.name+".json"), raw, 0644); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
}
