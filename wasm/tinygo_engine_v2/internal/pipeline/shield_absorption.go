package pipeline

// A non-nil snapshot is an explicit completed collection, even with no rows.
// Runtime binds linked-provider indices before publishing this immutable value.
type ShieldAbsorptionSnapshot struct {
	Rows []ShieldAbsorption
}

type ShieldAbsorption struct {
	ShieldRef            string  `json:"shieldRef"`
	DefinitionRef        string  `json:"definitionRef"`
	LifecycleProviderRef string  `json:"lifecycleProviderRef"`
	Source               string  `json:"source"`
	Owner                string  `json:"owner"`
	RemainingBefore      float64 `json:"remainingBefore"`
	RemainingAfter       float64 `json:"remainingAfter"`
	Absorbed             float64 `json:"absorbed"`
	ExpireAt             int64   `json:"-"`
	LifecycleIndex       uint16  `json:"-"`
	LifecycleBound       bool    `json:"-"`
}
