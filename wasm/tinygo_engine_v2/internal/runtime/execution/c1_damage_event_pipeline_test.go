package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func ensureC1CatalogTypes(req *model.CompileRequest, keys ...model.TypeCatalogEntry) {
	seen := map[string]struct{}{}
	for _, t := range req.TypeCatalog.Types {
		seen[t.Key] = struct{}{}
	}
	for _, t := range keys {
		if _, ok := seen[t.Key]; ok {
			continue
		}
		req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		seen[t.Key] = struct{}{}
	}
}

func c1Run(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := runForTest(result.Session, runReq)
	if err != nil {
		t.Fatalf("runForTest err=%+v", err)
	}
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}
	return done
}

func emittedEventsByRef(done model.DoneResult, ref string) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == ref {
			out = append(out, item)
		}
	}
	return out
}
