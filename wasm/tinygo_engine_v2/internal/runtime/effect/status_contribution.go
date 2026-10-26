package effect

// StatusContribution 是施加或刷新时保存的普通减速数值快照。
type StatusContribution struct {
	ResultRef  string
	StatusKey  string
	StatusKind string
	Strength   float64
}
