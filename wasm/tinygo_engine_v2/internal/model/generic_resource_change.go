package model

type ResourceChangeContributor struct {
	Source        string `json:"source"`
	ProviderRef   string `json:"providerRef"`
	DefinitionRef string `json:"definitionRef"`
	ModifierKey   string `json:"modifierKey"`
	Reason        string `json:"reason"`
	UseRef        string `json:"useRef,omitempty"`
}

type ResourceChangeRecord struct {
	HealthOrder   uint64                      `json:"healthOrder"`
	TimeMs        int64                       `json:"timeMs"`
	Target        string                      `json:"target"`
	ResourceKey   string                      `json:"resourceKey"`
	CurrentBefore float64                     `json:"currentBefore"`
	CurrentAfter  float64                     `json:"currentAfter"`
	CurrentDelta  float64                     `json:"currentDelta"`
	MaxBefore     float64                     `json:"maxBefore"`
	MaxAfter      float64                     `json:"maxAfter"`
	MaxDelta      float64                     `json:"maxDelta"`
	Contributors  []ResourceChangeContributor `json:"contributors"`
}

type ResourceChangeTotals struct {
	CurrentIncrease float64 `json:"currentIncrease"`
	CurrentDecrease float64 `json:"currentDecrease"`
	MaxIncrease     float64 `json:"maxIncrease"`
	MaxDecrease     float64 `json:"maxDecrease"`
	FinalMax        float64 `json:"finalMax"`
}

type ResourceChangeSummary struct {
	ChangeCount int                  `json:"changeCount"`
	Source      ResourceChangeTotals `json:"source"`
	Target      ResourceChangeTotals `json:"target"`
}
