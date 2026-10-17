package compile

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestProcessResolvedCountCannotBeForgedOrReadOutsideNativeEvent(t *testing.T) {
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeProcessResolved, Domain: "event"})
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "read", Path: "event.skill_use.contactCount"}}}
	if result := CompileGeneric(req); result.OK {
		t.Fatal("native history read allowed without native event")
	}
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "emit_event", Target: "self", EventType: model.EventTypeProcessResolved}}
	if result := CompileGeneric(req); result.OK {
		t.Fatal("native process result could be forged")
	}
}
