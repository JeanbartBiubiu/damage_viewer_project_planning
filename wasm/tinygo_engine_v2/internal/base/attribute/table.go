package attribute

import (
	"math"
	"sort"

	"tinygo_engine_v2/internal/model"
)

const PageSize = 8

// Layout 保存只读属性编号；扩充目录不会改变已有编号或旧目录。
type Layout struct {
	keys  []string
	index map[string]int
	hp    int
}

func NewLayout(keys []string) *Layout {
	return (*Layout)(nil).Extend(keys)
}

func (l *Layout) Extend(keys []string) *Layout {
	added := make([]string, 0, len(keys))
	seen := make(map[string]bool, len(keys))
	for _, key := range keys {
		if _, exists := l.Lookup(key); exists || seen[key] {
			continue
		}
		seen[key] = true
		added = append(added, key)
	}
	if len(added) == 0 && l != nil {
		return l
	}
	sort.Strings(added)
	out := &Layout{keys: make([]string, l.Len()+len(added)), index: make(map[string]int, l.Len()+len(added)), hp: -1}
	if l != nil {
		copy(out.keys, l.keys)
	}
	copy(out.keys[l.Len():], added)
	for index, key := range out.keys {
		out.index[key] = index
		if key == "hp" {
			out.hp = index
		}
	}
	return out
}

func (l *Layout) Lookup(key string) (int, bool) {
	if l == nil {
		return -1, false
	}
	index, exists := l.index[key]
	if !exists {
		return -1, false
	}
	return index, true
}

func (l *Layout) Key(index int) string {
	if l == nil || index < 0 || index >= len(l.keys) {
		return ""
	}
	return l.keys[index]
}

func (l *Layout) Len() int {
	if l == nil {
		return 0
	}
	return len(l.keys)
}

// HPIndex 保存目录中生命槽的真实编号；缺失为 -1，扩充目录仍保留旧编号。
func (l *Layout) HPIndex() int {
	if l == nil {
		return -1
	}
	return l.hp
}

type slotPage struct {
	slots   [PageSize]model.AttributeSlotDef
	present uint8
}

// Table 是不可变属性表；值复制就是冻结视图，写入只复制目录和命中页。
type Table struct {
	data *tableData
}

type tableData struct {
	layout *Layout
	pages  []*slotPage
	length int
}

// 小表的头和目录共用一个新对象；页独立分配，不反向保活旧版本目录。
type smallTableData struct {
	data  tableData
	pages [4]*slotPage
}

func newTableData(layout *Layout, length int) *tableData {
	pageCount := (layout.Len() + PageSize - 1) / PageSize
	var out *tableData
	if pageCount > 0 && pageCount <= 4 {
		block := &smallTableData{}
		out = &block.data
		out.pages = block.pages[:pageCount]
	} else {
		out = &tableData{pages: make([]*slotPage, pageCount)}
	}
	out.layout, out.length = layout, length
	return out
}

func FromMap(raw map[string]model.AttributeSlotDef, layout ...*Layout) Table {
	keys := make([]string, 0, len(raw))
	for key := range raw {
		keys = append(keys, key)
	}
	var selected *Layout
	if len(layout) != 0 {
		selected = layout[0]
	}
	selected = selected.Extend(keys)
	out := newTableData(selected, len(raw))
	for key, slot := range raw {
		index, _ := selected.Lookup(key)
		pageIndex, offset := index/PageSize, index%PageSize
		if out.pages[pageIndex] == nil {
			out.pages[pageIndex] = &slotPage{}
		}
		out.pages[pageIndex].slots[offset] = slot
		out.pages[pageIndex].present |= 1 << uint(offset)
	}
	return Table{data: out}
}

func (t Table) Layout() *Layout {
	if t.data == nil {
		return nil
	}
	return t.data.layout
}

func (t Table) Index(key string) int {
	index, _ := t.Layout().Lookup(key)
	return index
}

func (t Table) At(key string) model.AttributeSlotDef {
	slot, _ := t.Lookup(key)
	return slot
}

func (t Table) Lookup(key string) (model.AttributeSlotDef, bool) {
	return t.LookupIndex(t.Index(key))
}

func (t Table) AtIndex(index int) model.AttributeSlotDef {
	slot, _ := t.LookupIndex(index)
	return slot
}

func (t Table) LookupIndex(index int) (model.AttributeSlotDef, bool) {
	if t.data == nil || index < 0 || index >= t.data.layout.Len() {
		return model.AttributeSlotDef{}, false
	}
	page, offset := t.data.pages[index/PageSize], index%PageSize
	if page == nil || page.present&(1<<uint(offset)) == 0 {
		return model.AttributeSlotDef{}, false
	}
	return page.slots[offset], true
}

func (t Table) With(key string, slot model.AttributeSlotDef) Table {
	index, exists := t.Layout().Lookup(key)
	if exists {
		return t.WithIndex(index, slot)
	}
	layout := t.Layout().Extend([]string{key})
	index, _ = layout.Lookup(key)
	return t.withIndex(layout, index, slot)
}

// WithIndex 对非法编号明确不操作；合法编号即使原槽不存在也会插入。
func (t Table) WithIndex(index int, slot model.AttributeSlotDef) Table {
	if t.data == nil || index < 0 || index >= t.data.layout.Len() {
		return t
	}
	if old, exists := t.LookupIndex(index); exists && sameSlot(old, slot) {
		return t
	}
	return t.withIndex(t.data.layout, index, slot)
}

func (t Table) withIndex(layout *Layout, index int, slot model.AttributeSlotDef) Table {
	out := newTableData(layout, t.Len())
	if t.data != nil {
		copy(out.pages, t.data.pages)
	}
	pageIndex, offset := index/PageSize, index%PageSize
	page := &slotPage{}
	if old := out.pages[pageIndex]; old != nil {
		*page = *old
	}
	bit := uint8(1 << uint(offset))
	if page.present&bit == 0 {
		out.length++
	}
	page.slots[offset] = slot
	page.present |= bit
	out.pages[pageIndex] = page
	return Table{data: out}
}

func sameSlot(a, b model.AttributeSlotDef) bool {
	return a == b && math.Float64bits(a.Base) == math.Float64bits(b.Base) &&
		math.Float64bits(a.Current) == math.Float64bits(b.Current) &&
		math.Float64bits(a.Max) == math.Float64bits(b.Max) &&
		math.Float64bits(a.Resolved) == math.Float64bits(b.Resolved)
}

func (t Table) Without(key string) Table {
	index := t.Index(key)
	if _, exists := t.LookupIndex(index); !exists {
		return t
	}
	out := newTableData(t.data.layout, t.data.length-1)
	copy(out.pages, t.data.pages)
	pageIndex, offset := index/PageSize, index%PageSize
	old := t.data.pages[pageIndex]
	present := old.present &^ uint8(1<<uint(offset))
	if present == 0 {
		out.pages[pageIndex] = nil
	} else {
		page := &slotPage{}
		*page = *old
		page.present = present
		page.slots[offset] = model.AttributeSlotDef{}
		out.pages[pageIndex] = page
	}
	return Table{data: out}
}

func (t Table) Len() int {
	if t.data == nil {
		return 0
	}
	return t.data.length
}

// Range 按稳定编号枚举实际存在的槽；返回 false 可提前结束。
func (t Table) Range(visit func(string, model.AttributeSlotDef) bool) {
	if t.data == nil {
		return
	}
	for pageIndex, page := range t.data.pages {
		if page == nil {
			continue
		}
		for offset := 0; offset < PageSize; offset++ {
			if page.present&(1<<uint(offset)) != 0 && !visit(t.data.layout.Key(pageIndex*PageSize+offset), page.slots[offset]) {
				return
			}
		}
	}
}

// RangeIndex 与 Range 使用同一存在位和顺序，避免已编号的读取重新按名查找。
func (t Table) RangeIndex(visit func(int, model.AttributeSlotDef) bool) {
	if t.data == nil {
		return
	}
	for pageIndex, page := range t.data.pages {
		if page == nil {
			continue
		}
		for offset := 0; offset < PageSize; offset++ {
			if page.present&(1<<uint(offset)) != 0 && !visit(pageIndex*PageSize+offset, page.slots[offset]) {
				return
			}
		}
	}
}

func (t Table) ToMap() map[string]model.AttributeSlotDef {
	out := make(map[string]model.AttributeSlotDef, t.Len())
	t.Range(func(key string, slot model.AttributeSlotDef) bool {
		out[key] = slot
		return true
	})
	return out
}

func (t Table) PageCount() int {
	if t.data == nil {
		return 0
	}
	return len(t.data.pages)
}

func (t Table) SamePage(other Table, page int) bool {
	return t.Layout() == other.Layout() && page >= 0 && page < t.PageCount() && page < other.PageCount() && t.data.pages[page] == other.data.pages[page]
}

func (t Table) SameShape(other Table) bool {
	if t.data == other.data {
		return true
	}
	if t.Layout() != other.Layout() || t.Len() != other.Len() || t.PageCount() != other.PageCount() {
		return false
	}
	if t.PageCount() == 0 {
		return true
	}
	for index, page := range t.data.pages {
		otherPage := other.data.pages[index]
		if page == otherPage {
			continue
		}
		var present, otherPresent uint8
		if page != nil {
			present = page.present
		}
		if otherPage != nil {
			otherPresent = otherPage.present
		}
		if present != otherPresent {
			return false
		}
	}
	return true
}

func (t Table) Same(other Table) bool {
	if t.data == other.data {
		return true
	}
	if !t.SameShape(other) {
		return false
	}
	if t.PageCount() == 0 {
		return true
	}
	for index, page := range t.data.pages {
		if page != other.data.pages[index] {
			return false
		}
	}
	return true
}
