package attribute

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

// Editor 只在局部批量写入时持有私有可写页，Finish 后发布不可变表。
// 已开始写入的值副本共享编辑状态，发布后均从新版本重新复制写页。
type Editor struct {
	base  Table
	state *editorState
}

type editorState struct {
	base       Table
	work       *tableData
	owned      uint64
	ownedExtra []uint64
}

func (s *editorState) ownsPage(index int) bool {
	if index < 64 {
		return s.owned&(uint64(1)<<uint(index)) != 0
	}
	word := (index - 64) / 64
	return word < len(s.ownedExtra) && s.ownedExtra[word]&(uint64(1)<<uint((index-64)%64)) != 0
}

func (s *editorState) setPageOwned(index int, owned bool) {
	word := &s.owned
	if index >= 64 {
		if s.ownedExtra == nil {
			if !owned {
				return
			}
			s.ownedExtra = make([]uint64, (len(s.work.pages)-64+63)/64)
		}
		word = &s.ownedExtra[(index-64)/64]
	}
	mask := uint64(1) << uint(index%64)
	if owned {
		*word |= mask
	} else {
		*word &^= mask
	}
}

func (t Table) Edit() Editor { return Editor{base: t} }

func (e Editor) LookupIndex(index int) (model.AttributeSlotDef, bool) {
	if e.state == nil {
		return e.base.LookupIndex(index)
	}
	if e.state.work == nil {
		return e.state.base.LookupIndex(index)
	}
	work := e.state.work
	if index < 0 || index >= work.layout.Len() {
		return model.AttributeSlotDef{}, false
	}
	page, offset := work.pages[index/PageSize], index%PageSize
	if page == nil || page.present&(1<<uint(offset)) == 0 {
		return model.AttributeSlotDef{}, false
	}
	return page.slots[offset], true
}

// SetIndex 仅使用原目录；非法编号不操作，缺槽写入零值仍插入。
func (e *Editor) SetIndex(index int, slot model.AttributeSlotDef) {
	base := e.base
	if e.state != nil {
		base = e.state.base
	}
	if index < 0 || index >= base.Layout().Len() {
		return
	}
	if old, exists := e.LookupIndex(index); exists && sameSlot(old, slot) {
		return
	}
	state := e.prepareWork()
	pageIndex, offset := index/PageSize, index%PageSize
	if !state.ownsPage(pageIndex) {
		page := &slotPage{}
		if old := state.work.pages[pageIndex]; old != nil {
			*page = *old
		}
		state.work.pages[pageIndex] = page
		state.setPageOwned(pageIndex, true)
	}
	page := state.work.pages[pageIndex]
	bit := uint8(1 << uint(offset))
	if page.present&bit == 0 {
		state.work.length++
	}
	page.slots[offset] = slot
	page.present |= bit
}

func (e *Editor) prepareWork() *editorState {
	if e.state == nil {
		e.state = &editorState{base: e.base}
	}
	state := e.state
	if state.work == nil {
		base := state.base
		state.work = newTableData(base.Layout(), base.Len())
		if base.data != nil {
			copy(state.work.pages, base.data.pages)
		}
	}
	return state
}

// ReuseResolvedPage 只恢复mask覆盖槽的Resolved；其它字段、存在位及未覆盖值必须完全一致。
// 成功时借用已发布的不可变页，后续编辑仍复制；失败时不改变当前编辑内容。
func (e *Editor) ReuseResolvedPage(cached Table, pageIndex int, mask uint8) bool {
	current := e.base
	if e.state != nil {
		current = e.state.base
		if e.state.work != nil {
			current = Table{data: e.state.work}
		}
	}
	if current.Layout() != cached.Layout() || pageIndex < 0 || pageIndex >= current.PageCount() || pageIndex >= cached.PageCount() {
		return false
	}
	page, source := current.data.pages[pageIndex], cached.data.pages[pageIndex]
	if page == nil || source == nil || page.present != source.present || mask&^page.present != 0 {
		return false
	}
	remaining := current.Layout().Len() - pageIndex*PageSize
	if remaining <= 0 {
		return false
	}
	if remaining < PageSize && page.present>>uint(remaining) != 0 {
		return false
	}
	changed := false
	for offset := 0; offset < PageSize; offset++ {
		bit := uint8(1 << uint(offset))
		if page.present&bit == 0 {
			continue
		}
		before, after := page.slots[offset], source.slots[offset]
		if mask&bit != 0 {
			changed = changed || math.Float64bits(before.Resolved) != math.Float64bits(after.Resolved)
			before.Resolved = after.Resolved
		}
		if !sameSlot(before, after) {
			return false
		}
	}
	if !changed {
		return true
	}
	state := e.prepareWork()
	state.work.pages[pageIndex] = source
	state.setPageOwned(pageIndex, false)
	return true
}

// Finish 发布当前页目录，并在共享编辑状态中撤销全部写权限。
func (e *Editor) Finish() Table {
	if e.state == nil {
		return e.base
	}
	state := e.state
	if state.work != nil {
		state.base = Table{data: state.work}
		state.work = nil
		state.owned = 0
		state.ownedExtra = nil
	}
	e.base = state.base
	return state.base
}
