package numeric

import (
	"fmt"
	"math"
)

type amplificationFactor struct {
	id     uint16
	factor float64
}

// AmplificationGroupError 保留失败组的编号，调用方再绑定真实来源与公式路径。
type AmplificationGroupError struct {
	ID     uint16
	Reason string
}

func (e AmplificationGroupError) Error() string { return fmt.Sprintf("group %d %s", e.ID, e.Reason) }

// AmplificationGroups 属于本次数值结算，不与递归子帧共享可写空间。
// 无分组路径不构造此容器；容量来自已编译成员数，追加只登记实际参与的组。
type AmplificationGroups struct{ factors []amplificationFactor }

func NewAmplificationGroups(capacity int) AmplificationGroups {
	return AmplificationGroups{factors: make([]amplificationFactor, 0, capacity)}
}

func (g *AmplificationGroups) Add(id uint16, value float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 1 {
		return AmplificationGroupError{ID: id, Reason: "multiplier must be finite and >=1"}
	}
	for index := range g.factors {
		if g.factors[index].id != id {
			continue
		}
		factor := g.factors[index].factor + (value - 1)
		if math.IsNaN(factor) || math.IsInf(factor, 0) {
			return AmplificationGroupError{ID: id, Reason: "amplification sum overflow"}
		}
		g.factors[index].factor = factor
		return nil
	}
	g.factors = append(g.factors, amplificationFactor{id: id, factor: value})
	return nil
}

func (g AmplificationGroups) Product() (float64, error) {
	product := 1.0
	for _, factor := range g.factors {
		product *= factor.factor
		if math.IsNaN(product) || math.IsInf(product, 0) {
			return 0, AmplificationGroupError{ID: factor.id, Reason: "amplification product overflow"}
		}
	}
	return product, nil
}

func (g AmplificationGroups) Factor(id uint16) float64 {
	for _, factor := range g.factors {
		if factor.id == id {
			return factor.factor
		}
	}
	return 1
}
