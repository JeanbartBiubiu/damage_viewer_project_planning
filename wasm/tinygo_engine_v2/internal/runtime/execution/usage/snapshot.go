package usage

import "tinygo_engine_v2/internal/model"

func (s *Ledger) Snapshot() []model.UseTriggerLedgerEntry {
	out := make([]model.UseTriggerLedgerEntry, 0, s.triggerCount)
	// 空次数账不创建映射迭代器。
	if s.triggerCount == 0 {
		return out
	}
	for _, first := range s.buckets {
		for entry := first; entry != nil; entry = entry.next {
			if !entry.committed {
				continue
			}
			row := model.UseTriggerLedgerEntry{
				Owner: entry.key.Owner, ProviderRef: entry.key.ProviderRef, GroupKey: entry.key.GroupKey, Scope: entry.key.Scope,
				UseSource: entry.key.UseSource, UseSkillKey: entry.useSkillKey, UseKey: entry.key.UseKey,
			}
			if entry.key.Scope == model.OncePerUseScopeProviderTarget {
				target := entry.key.Target
				row.Target = &target
			}
			out = append(out, row)
		}
	}
	sortRows(out)
	return out
}

func sortRows(rows []model.UseTriggerLedgerEntry) {
	for index := 0; index < len(rows); index++ {
		for other := index + 1; other < len(rows); other++ {
			if rowLess(rows[other], rows[index]) {
				rows[index], rows[other] = rows[other], rows[index]
			}
		}
	}
}

func rowLess(a, b model.UseTriggerLedgerEntry) bool {
	if a.Owner != b.Owner {
		return a.Owner < b.Owner
	}
	if a.ProviderRef != b.ProviderRef {
		return a.ProviderRef < b.ProviderRef
	}
	if a.GroupKey != b.GroupKey {
		return a.GroupKey < b.GroupKey
	}
	if a.Scope != b.Scope {
		return a.Scope < b.Scope
	}
	if a.UseSource != b.UseSource {
		return a.UseSource < b.UseSource
	}
	if a.UseKey != b.UseKey {
		return a.UseKey < b.UseKey
	}
	if a.UseSkillKey != b.UseSkillKey {
		return a.UseSkillKey < b.UseSkillKey
	}
	at, bt := "", ""
	if a.Target != nil {
		at = *a.Target
	}
	if b.Target != nil {
		bt = *b.Target
	}
	return at < bt
}
