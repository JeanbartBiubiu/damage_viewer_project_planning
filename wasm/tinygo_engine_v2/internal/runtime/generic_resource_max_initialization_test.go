package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestResourceMaxHalfHealthFreshSourceInitialization(t *testing.T) {
	input, request := resourceMaxInput(t, 1209, 2418, true)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
	for _, attributes := range []map[string]model.AttributeSlotDef{input.Combatants[0].Attributes, request.InitialSnapshot.Combatants[0].Attributes} {
		hp := attributes["hp"]
		hp.Resolved = hp.Max
		attributes["hp"] = hp
	}
	for repeat := 0; repeat < 2; repeat++ {
		done := authoringRun(t, input, request)
		if done.Summary.SourceFinalHp != 1509 || done.ResourceChangeSummary.ChangeCount != 1 {
			t.Fatal(done.Summary, done.ResourceChangeSummary)
		}
		initialized := map[string]int{}
		for _, evidence := range done.Evidence.Items {
			if evidence.Kind == "source_initialized" {
				initialized[evidence.Ref]++
			}
		}
		if initialized["source"] != 1 || initialized["target"] != 1 {
			t.Fatal(initialized)
		}
		hp := done.FinalSnapshot.Combatants[0].Attributes["hp"]
		if hp.Current != 1509 || hp.Resolved != hp.Current || hp.Max != 2718 {
			t.Fatal(hp)
		}
	}
}
