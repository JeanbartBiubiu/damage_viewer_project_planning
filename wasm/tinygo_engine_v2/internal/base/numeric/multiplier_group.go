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

// AmplificationGroupsAPI 集中声明有界分组增幅计算，不读取战斗身份或生命周期。
// 声明用于阅读与编译检查；实际调用继续使用具体类型。
type AmplificationGroupsAPI interface {
	// Add 加入有限且不小于 1 的倍率，同组按参与顺序加算增量；非法值返回错误。
	Add(id uint16, value float64) error
	// Factor 查询指定组当前因子，未参与的组按既有单位因子返回。
	Factor(id uint16) float64
	// Product 按组首次出现顺序连乘组因子；溢出或非法结果返回错误。
	Product() (float64, error)
}

// AmplificationGroups 属于本次数值结算，不与递归子帧共享可写空间。
// 无分组路径不构造此容器；容量来自已编译成员数，追加只登记实际参与的组。
type AmplificationGroups struct{ factors []amplificationFactor }

var _ AmplificationGroupsAPI = (*AmplificationGroups)(nil)

func (e AmplificationGroupError) Error() string { return fmt.Sprintf("group %d %s", e.ID, e.Reason) }

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
