package usage

import (
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
)

func (s *Ledger) Restore(rows []model.UseTriggerLedgerEntry, facts RestoreFacts) *model.EngineError {
	if len(rows) > MaxEntries {
		return s.error(model.GenericErrRuntimeInvariantFailed, "useTriggerLedger exceeded dedicated budget", "initialSnapshot.useTriggerLedger", "")
	}
	seen := make(map[uint64]int)
	previous := make([]int, len(rows))
	for index, row := range rows {
		path := "initialSnapshot.useTriggerLedger[" + strconv.Itoa(index) + "]"
		if err := s.validateRow(row, path, facts); err != nil {
			return err
		}
		key := keyFromEntry(row)
		hash := keyHash(key)
		for cursor := seen[hash]; cursor != 0; cursor = previous[cursor-1] {
			prior := cursor - 1
			if keyFromEntry(rows[prior]) == key {
				return s.error(model.GenericErrUnknownRef, "duplicate useTriggerLedger key", path, "previously "+strconv.Itoa(prior))
			}
		}
		previous[index], seen[hash] = seen[hash], index+1
		if entry := s.lookup(hash, key); entry != nil {
			entry.useSkillKey, entry.reserved, entry.committed = row.UseSkillKey, false, true
			continue
		}
		if s.count >= MaxEntries {
			err := s.error(model.GenericErrRuntimeInvariantFailed, "useTriggerLedger exceeded dedicated budget", path, "")
			err.BudgetCause = model.BudgetCauseMaxUseTriggerLedger
			return err
		}
		if s.buckets == nil {
			s.buckets = make(map[uint64]*record)
		}
		s.buckets[hash] = &record{key: key, useSkillKey: row.UseSkillKey, committed: true, next: s.buckets[hash]}
		s.count++
	}
	return nil
}

func (s *Ledger) validateRow(row model.UseTriggerLedgerEntry, path string, facts RestoreFacts) *model.EngineError {
	if strings.TrimSpace(row.Owner) == "" || strings.TrimSpace(row.ProviderRef) == "" || strings.TrimSpace(row.GroupKey) == "" ||
		strings.TrimSpace(row.Scope) == "" || strings.TrimSpace(row.UseSource) == "" || strings.TrimSpace(row.UseSkillKey) == "" || strings.TrimSpace(row.UseKey) == "" {
		return s.error(model.GenericErrMissingRequiredField, "useTriggerLedger fields must be complete", path, row.UseKey)
	}
	if _, ok := model.ValidOncePerUseScope[row.Scope]; !ok {
		return s.error(model.GenericErrUnknownRef, "useTriggerLedger.scope must be provider or provider_target", path+".scope", row.Scope)
	}
	if !containsActor(facts.ActorKeys, row.UseSource) {
		return s.error(model.GenericErrUnknownRef, "useTriggerLedger.useSource is not a snapshot actor", path+".useSource", row.UseSource)
	}
	if row.Target != nil && !containsActor(facts.ActorKeys, *row.Target) {
		return s.error(model.GenericErrUnknownRef, "useTriggerLedger.target is not a snapshot actor", path+".target", *row.Target)
	}
	if row.Scope == model.OncePerUseScopeProviderTarget && (row.Target == nil || strings.TrimSpace(*row.Target) == "") {
		return s.error(model.GenericErrMissingRequiredField, "provider_target ledger rows require target", path+".target", row.UseKey)
	}
	if row.Scope == model.OncePerUseScopeProvider && row.Target != nil {
		return s.error(model.GenericErrUnknownRef, "provider-scope ledger rows cannot carry a target", path+".target", row.UseKey)
	}
	mounted, anyUse, matchesSkill := false, false, false
	for _, group := range facts.Groups {
		if group.Owner != row.Owner || group.ProviderRef != row.ProviderRef || group.GroupKey != row.GroupKey || group.Scope != row.Scope {
			continue
		}
		mounted = true
		anyUse = anyUse || group.AnyUse
		for _, skillKey := range group.SkillKeys {
			if skillKey == row.UseSkillKey {
				matchesSkill = true
			}
		}
	}
	if !mounted {
		return s.error(model.GenericErrUnknownRef, "useTriggerLedger must match a currently mounted oncePerUse listener or hit-rule group", path, row.GroupKey)
	}
	if !anyUse && (row.UseSource != row.Owner || !matchesSkill) {
		return s.error(model.GenericErrUnknownRef, "hit-rule ledger row must match its actual parent source and skill", path, row.UseKey)
	}
	for _, use := range facts.Uses {
		if use.UseKey != row.UseKey {
			continue
		}
		if use.Source != row.UseSource || use.SkillKey != row.UseSkillKey {
			return s.error(model.GenericErrUnknownRef, "reused useTriggerLedger useKey must match skillUses source and skillKey", path+".useKey", row.UseKey)
		}
		break
	}
	return nil
}

func keyFromEntry(row model.UseTriggerLedgerEntry) Key {
	key := Key{Owner: row.Owner, ProviderRef: row.ProviderRef, GroupKey: row.GroupKey, Scope: row.Scope, UseSource: row.UseSource, UseKey: row.UseKey}
	if row.Scope == model.OncePerUseScopeProviderTarget && row.Target != nil {
		key.Target = *row.Target
	}
	return key
}

func containsActor(actors []string, key string) bool {
	for _, actor := range actors {
		if actor == key {
			return true
		}
	}
	return false
}
