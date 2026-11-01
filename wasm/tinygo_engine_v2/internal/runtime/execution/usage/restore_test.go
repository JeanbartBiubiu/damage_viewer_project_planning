package usage

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
)

func restoreFixture() (model.UseTriggerLedgerEntry, RestoreFacts) {
	target := "target"
	row := model.UseTriggerLedgerEntry{Owner: "source", ProviderRef: "item", GroupKey: "once", Scope: model.OncePerUseScopeProviderTarget,
		UseSource: "source", UseSkillKey: "author:q", UseKey: "use", Target: &target}
	facts := RestoreFacts{ActorKeys: []string{"source", "target"}, Groups: []GroupAuthorization{
		{Owner: "source", ProviderRef: "item", GroupKey: "once", Scope: model.OncePerUseScopeProviderTarget, SkillKeys: []string{"author:q"}},
	}, Uses: []UseIdentity{{UseKey: "use", Source: "source", SkillKey: "author:q"}}}
	return row, facts
}

func TestRestorePreservesValidationOrderAndExactErrors(t *testing.T) {
	cases := []struct {
		name    string
		change  func(*model.UseTriggerLedgerEntry, *RestoreFacts)
		code    model.GenericErrCode
		suffix  string
		ref     string
		message string
	}{
		{"missing owner", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.Owner = " " }, model.GenericErrMissingRequiredField, "", "use", "useTriggerLedger fields must be complete"},
		{"missing mount", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.ProviderRef = "" }, model.GenericErrMissingRequiredField, "", "use", "useTriggerLedger fields must be complete"},
		{"missing group", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.GroupKey = "" }, model.GenericErrMissingRequiredField, "", "use", "useTriggerLedger fields must be complete"},
		{"missing scope", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.Scope = "" }, model.GenericErrMissingRequiredField, "", "use", "useTriggerLedger fields must be complete"},
		{"missing source", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.UseSource = "" }, model.GenericErrMissingRequiredField, "", "use", "useTriggerLedger fields must be complete"},
		{"missing skill", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.UseSkillKey = "" }, model.GenericErrMissingRequiredField, "", "use", "useTriggerLedger fields must be complete"},
		{"missing use", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.UseKey = "" }, model.GenericErrMissingRequiredField, "", "", "useTriggerLedger fields must be complete"},
		{"invalid scope before actor", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) {
			row.Scope, row.UseSource = "other", "absent"
		}, model.GenericErrUnknownRef, ".scope", "other", "useTriggerLedger.scope must be provider or provider_target"},
		{"source before target", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) {
			row.UseSource, *row.Target = "absent_source", "absent_target"
		}, model.GenericErrUnknownRef, ".useSource", "absent_source", "useTriggerLedger.useSource is not a snapshot actor"},
		{"target actor", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { *row.Target = "absent" }, model.GenericErrUnknownRef, ".target", "absent", "useTriggerLedger.target is not a snapshot actor"},
		{"empty target actor before missing target", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { *row.Target = "" }, model.GenericErrUnknownRef, ".target", "", "useTriggerLedger.target is not a snapshot actor"},
		{"missing target", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.Target = nil }, model.GenericErrMissingRequiredField, ".target", "use", "provider_target ledger rows require target"},
		{"provider target", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.Scope = model.OncePerUseScopeProvider }, model.GenericErrUnknownRef, ".target", "use", "provider-scope ledger rows cannot carry a target"},
		{"unmounted group", func(_ *model.UseTriggerLedgerEntry, facts *RestoreFacts) { facts.Groups = nil }, model.GenericErrUnknownRef, "", "once", "useTriggerLedger must match a currently mounted oncePerUse listener or hit-rule group"},
		{"foreign source", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.UseSource = "target" }, model.GenericErrUnknownRef, "", "use", "hit-rule ledger row must match its actual parent source and skill"},
		{"foreign skill", func(row *model.UseTriggerLedgerEntry, _ *RestoreFacts) { row.UseSkillKey = "author:w" }, model.GenericErrUnknownRef, "", "use", "hit-rule ledger row must match its actual parent source and skill"},
		{"reused source", func(_ *model.UseTriggerLedgerEntry, facts *RestoreFacts) { facts.Uses[0].Source = "target" }, model.GenericErrUnknownRef, ".useKey", "use", "reused useTriggerLedger useKey must match skillUses source and skillKey"},
		{"reused skill", func(_ *model.UseTriggerLedgerEntry, facts *RestoreFacts) { facts.Uses[0].SkillKey = "author:w" }, model.GenericErrUnknownRef, ".useKey", "use", "reused useTriggerLedger useKey must match skillUses source and skillKey"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			row, facts := restoreFixture()
			test.change(&row, &facts)
			ledger := New(testIdentity())
			err := ledger.Restore([]model.UseTriggerLedgerEntry{row}, facts)
			if err == nil || err.Code != test.code || err.Message != test.message || err.Path != "initialSnapshot.useTriggerLedger[0]"+test.suffix || err.Ref != test.ref || err.BudgetCause != "" {
				t.Fatalf("restore error changed: %+v", err)
			}
			checkErrorIdentity(t, err)
			if ledger.Len() != 0 || ledger.Pending() != 0 {
				t.Fatal("invalid row reserved quota", ledger.Len(), ledger.Pending())
			}
		})
	}
}

func TestRestoreRequiresAllMountedGroupIdentityParts(t *testing.T) {
	changes := []func(*GroupAuthorization){
		func(group *GroupAuthorization) { group.Owner = "target" },
		func(group *GroupAuthorization) { group.ProviderRef = "different_mount" },
		func(group *GroupAuthorization) { group.GroupKey = "different_group" },
		func(group *GroupAuthorization) { group.Scope = model.OncePerUseScopeProvider },
	}
	for index, change := range changes {
		row, facts := restoreFixture()
		change(&facts.Groups[0])
		ledger := New(testIdentity())
		err := ledger.Restore([]model.UseTriggerLedgerEntry{row}, facts)
		if err == nil || err.Message != "useTriggerLedger must match a currently mounted oncePerUse listener or hit-rule group" {
			t.Fatal("partial mounted group identity authorized a restored quota", index, err)
		}
	}
}

func TestRestoreMergesCurrentAuthorizationsAndAcceptsHistoricalUses(t *testing.T) {
	for _, anyUse := range []bool{false, true} {
		row, facts := restoreFixture()
		facts.Uses = nil
		group := facts.Groups[0]
		facts.Groups[0].SkillKeys = []string{"another_skill"}
		facts.Groups = append(facts.Groups, group)
		if anyUse {
			row.UseSource, row.UseSkillKey = "target", "historical_skill"
			authorization := group
			authorization.AnyUse, authorization.SkillKeys = true, nil
			facts.Groups = append(facts.Groups, authorization)
		}
		ledger := New(testIdentity())
		if err := ledger.Restore([]model.UseTriggerLedgerEntry{row}, facts); err != nil {
			t.Fatal("current shared group or historical use was rejected", anyUse, err)
		}
		if ledger.Pending() != 0 || !reflect.DeepEqual(ledger.Snapshot(), []model.UseTriggerLedgerEntry{row}) {
			t.Fatal("restored history was not committed once", ledger.Pending(), ledger.Snapshot())
		}
		if _, skip, err := ledger.Reserve(keyFromEntry(row), row.UseSkillKey); err != nil || !skip {
			t.Fatal("restored quota could run again", skip, err)
		}
	}
}

func TestRestoreRejectsDuplicateAfterRowValidationAndKeepsPrefix(t *testing.T) {
	row, facts := restoreFixture()
	facts.Uses = nil
	facts.Groups[0].AnyUse = true
	second := row
	second.UseSkillKey = "another_skill"
	ledger := New(testIdentity())
	err := ledger.Restore([]model.UseTriggerLedgerEntry{row, second}, facts)
	if err == nil || err.Code != model.GenericErrUnknownRef || err.Message != "duplicate useTriggerLedger key" ||
		err.Path != "initialSnapshot.useTriggerLedger[1]" || err.Ref != "previously 0" {
		t.Fatal("use skill silently became part of the common quota key", err)
	}
	checkErrorIdentity(t, err)
	if ledger.Len() != 1 || ledger.Pending() != 0 || !reflect.DeepEqual(ledger.Snapshot(), []model.UseTriggerLedgerEntry{row}) {
		t.Fatal("duplicate failure changed the prior restored prefix", ledger.Snapshot(), ledger.Pending())
	}
	second.UseSource = "absent"
	ledger = New(testIdentity())
	err = ledger.Restore([]model.UseTriggerLedgerEntry{row, second}, facts)
	if err == nil || err.Message != "useTriggerLedger.useSource is not a snapshot actor" || err.Path != "initialSnapshot.useTriggerLedger[1].useSource" || ledger.Len() != 1 {
		t.Fatal("duplicate handling reordered the earlier row validation", err, ledger.Len())
	}
}

func TestRestoreDoesNotConfuseDelimitedMountIdentity(t *testing.T) {
	first, facts := restoreFixture()
	first.Owner, first.ProviderRef = "a\x00b", "c"
	second := first
	second.Owner, second.ProviderRef = "a", "b\x00c"
	facts.Groups = []GroupAuthorization{
		{Owner: first.Owner, ProviderRef: first.ProviderRef, GroupKey: first.GroupKey, Scope: first.Scope, AnyUse: true},
		{Owner: second.Owner, ProviderRef: second.ProviderRef, GroupKey: second.GroupKey, Scope: second.Scope, AnyUse: true},
	}
	ledger := New(testIdentity())
	if err := ledger.Restore([]model.UseTriggerLedgerEntry{first, second}, facts); err != nil || ledger.Len() != 2 {
		t.Fatal("different complete mount identities shared a restored quota", err, ledger.Snapshot())
	}
	ledger = New(testIdentity())
	err := ledger.Restore([]model.UseTriggerLedgerEntry{first, second, first}, facts)
	if err == nil || err.Path != "initialSnapshot.useTriggerLedger[2]" || err.Ref != "previously 0" || ledger.Len() != 2 {
		t.Fatal("colliding lookup lost the original duplicate row index", err, ledger.Len())
	}
}

func TestRestoreBudgetPrecedesIndividualValidation(t *testing.T) {
	ledger := New(testIdentity())
	err := ledger.Restore(make([]model.UseTriggerLedgerEntry, MaxEntries+1), RestoreFacts{})
	if err == nil || err.Code != model.GenericErrRuntimeInvariantFailed || err.Message != "useTriggerLedger exceeded dedicated budget" ||
		err.Path != "initialSnapshot.useTriggerLedger" || err.Ref != "" || err.BudgetCause != "" {
		t.Fatal("restore overflow changed its original error boundary", err)
	}
	checkErrorIdentity(t, err)
	if ledger.Len() != 0 || ledger.Pending() != 0 {
		t.Fatal("oversized recovery published rows", ledger.Len(), ledger.Pending())
	}
}

func TestRestoreDoesNotBorrowWritableRows(t *testing.T) {
	row, facts := restoreFixture()
	rows := []model.UseTriggerLedgerEntry{row}
	ledger := New(testIdentity())
	if err := ledger.Restore(rows, facts); err != nil {
		t.Fatal(err)
	}
	expectedTarget := "target"
	want := row
	want.Target = &expectedTarget
	rows[0].UseKey = "changed"
	*rows[0].Target = "changed"
	facts.Groups[0].SkillKeys[0] = "changed"
	facts.Uses[0].Source = "changed"
	if !reflect.DeepEqual(ledger.Snapshot(), []model.UseTriggerLedgerEntry{want}) {
		t.Fatal("caller mutation changed the restored private quota", ledger.Snapshot())
	}
}
