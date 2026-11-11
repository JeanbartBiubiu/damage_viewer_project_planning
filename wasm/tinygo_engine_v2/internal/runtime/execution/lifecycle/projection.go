package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// ProjectedEffectPublication 仅在原发布阶段接收已投影效果的期限与生命周期事实。
type ProjectedEffectPublication interface {
	ExpiryRequests
	// RecordEffect 观察本次已发布的实际实例，不更改投影或触发新的效果规则。
	RecordEffect(kind model.EvidenceKind, instance effectpkg.Provider)
}

// ProjectionAPI 定义一次帧内的效果投影状态；嵌套读取借用同一对象，不能覆盖外层事实。
type ProjectionAPI interface {
	// Begin 在确需投影且没有重入时进入阶段，返回是否首次读取及是否实际进入。
	Begin() (bool, bool)
	// Complete 只在投影成功后登记到期已检查及操作已处理，不提前结束整个读取阶段。
	Complete()
	// End 在数值与属性后续阶段结束时解除重入保护，失败也须调用。
	End()
	// MarkDirty 标记同帧追加的效果操作，不建立另一份操作列表。
	MarkDirty()
	// Publish 按原投影顺序先交出有效到期请求，再观察对应实例事实；不重跑实例变更。
	// 唯一队列的延后错误仍由原发布拥有者保留，不在逐项回调后额外停止或回滚。
	Publish(publication ProjectedEffectPublication)
}

type Projection struct {
	changes                  []ProjectedChange
	flushing, dirty, checked bool
}

var _ ProjectionAPI = (*Projection)(nil)

func (p *Projection) Begin() (bool, bool) {
	if p.flushing || p.checked && !p.dirty {
		return false, false
	}
	p.flushing = true
	return !p.checked, true
}

func (p *Projection) Complete() { p.checked, p.dirty = true, false }

func (p *Projection) End() { p.flushing = false }

func (p *Projection) MarkDirty() { p.dirty = true }

func (p *Projection) Publish(publication ProjectedEffectPublication) {
	for index := 0; index < len(p.changes); index++ {
		change := p.changes[index]
		instance := change.Instance
		if change.EnqueueExpiry && instance.ExpireAt > 0 {
			publication.EnqueueExpiry(instance.ExpireAt, effectpkg.ExpiryPayload{CombatantKey: instance.Owner, ProviderRef: instance.ProviderRef, Kind: "provider"})
		}
		publication.RecordEffect(change.Kind, instance)
	}
}
