package lifecycle

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
	// ChangeCount 返回当前投影事实数量，供根层组合真实预检容量。
	ChangeCount() int
	// ChangeAt 借用一个投影事实值；其所属实例的嵌套状态仍只读。
	ChangeAt(index int) ProjectedChange
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

func (p *Projection) ChangeCount() int { return len(p.changes) }

func (p *Projection) ChangeAt(index int) ProjectedChange { return p.changes[index] }
