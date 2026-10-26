package effect

type SourceExpiryFact struct {
	Generation uint64
	Deadline   int64
}

// A committed fact has a real callback in the queue: its state write and queue
// capacity are preflighted together. Keep the active value only at that exact
// deadline, until the callback commits or a real new write replaces its fact.
func (b *bagData) holdsSourceExpiryAt(key string, def FieldDefinition, nowMs, expireAt int64) bool {
	if !def.HasOnExpire || expireAt <= 0 || nowMs != expireAt || b.state[key] == def.DefaultValue {
		return false
	}
	fact := b.sourceExpiryFacts[key]
	return fact.Generation > 0 && fact.Deadline == expireAt
}

func (b *bagData) writableSourceExpiryFacts() map[string]SourceExpiryFact {
	if b.sourceExpiryFacts == nil || b.sourceExpiryFactsShared {
		copy := make(map[string]SourceExpiryFact, len(b.sourceExpiryFacts))
		for key, fact := range b.sourceExpiryFacts {
			copy[key] = fact
		}
		b.sourceExpiryFacts, b.sourceExpiryFactsShared = copy, false
	}
	return b.sourceExpiryFacts
}

func (b *bagData) rearmSourceExpiry(key string, Deadline int64) uint64 {
	fact := b.sourceExpiryFacts[key]
	fact.Generation++
	fact.Deadline = Deadline
	b.writableSourceExpiryFacts()[key] = fact
	return fact.Generation
}
