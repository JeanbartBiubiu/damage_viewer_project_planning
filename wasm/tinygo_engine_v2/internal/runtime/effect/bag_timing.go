package effect

// Facts are bounded by the compiled source's at most three phases and one
// reservation. No owner/provider/target string composite is hashed per event.
type TimingFact struct {
	Key                       string
	Generation                uint64
	Origin, Expiry, Scheduled int64
	Active, Protect           bool
}
type timingState [4]TimingFact

func (b *bagData) writableTargetTiming() *timingState {
	if b.timing == nil {
		b.timing = &timingState{}
		b.timingShared = false
	} else if b.timingShared {
		copy := *b.timing
		b.timing = &copy
		b.timingShared = false
	}
	return b.timing
}
