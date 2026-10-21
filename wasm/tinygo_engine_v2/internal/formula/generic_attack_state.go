package formula

// ProviderStateBeforeValue is a frozen field of the concrete provider mounted on
// the original attack owner. The runtime chooses that mount, never the formula.
type ProviderStateBeforeValue struct {
	StateKey string
	Value    float64
}
