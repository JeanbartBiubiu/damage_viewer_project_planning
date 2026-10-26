package model

// ShieldAbsorptionRecord is the committed display projection; lifecycle guards
// remain in the damage pipeline and are not part of the report's state.
type ShieldAbsorptionRecord struct {
	ShieldRef            string  `json:"shieldRef"`
	DefinitionRef        string  `json:"definitionRef"`
	LifecycleProviderRef string  `json:"lifecycleProviderRef"`
	Source               string  `json:"source"`
	Owner                string  `json:"owner"`
	RemainingBefore      float64 `json:"remainingBefore"`
	RemainingAfter       float64 `json:"remainingAfter"`
	Absorbed             float64 `json:"absorbed"`
}
