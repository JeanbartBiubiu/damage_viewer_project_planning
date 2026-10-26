package execution

import (
	json "encoding/json"
	os "os"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func loadBasicFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.CompileRequest, fixture.RunRequest
}

func TestNormalizeAbilityRef(t *testing.T) {
	got := normalizeAbilityRef("self.provider[champion:source_demo].ability[basic_attack]", "source", "target")
	want := "source.provider[champion:source_demo].ability[basic_attack]"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	got = normalizeAbilityRef("opponent.provider[champion:source_demo].ability[basic_attack]", "source", "target")
	want = "target.provider[champion:source_demo].ability[basic_attack]"
	if got != want {
		t.Fatalf("opponent from source got %q want %q", got, want)
	}
	got = normalizeAbilityRef("opponent.provider[champion:source_demo].ability[basic_attack]", "target", "source")
	want = "source.provider[champion:source_demo].ability[basic_attack]"
	if got != want {
		t.Fatalf("opponent from target got %q want %q", got, want)
	}
}
