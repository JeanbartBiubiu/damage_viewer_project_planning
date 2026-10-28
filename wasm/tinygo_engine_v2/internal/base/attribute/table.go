package attribute

import (
	"math"
	"sort"

	"tinygo_engine_v2/internal/model"
)

const PageSize = 8

// LayoutAPI 集中声明只读属性编号目录；扩充目录不改变旧编号。
// 声明用于阅读与编译检查；实际调用继续使用具体类型。
type LayoutAPI interface {
	// Extend 返回包含新增键的新目录；新增键稳定排序，原目录及其编号不变。
	Extend(keys []string) *Layout
	// HPIndex 返回生命槽的真实编号；缺失为 -1，扩充目录仍保留旧编号。
	HPIndex() int
	// Key 按编号读取属性键，空目录或越界返回空字符串。
	Key(index int) string
	// Len 返回目录长度；空指针目录长度为零。
	Len() int
	// Lookup 查询属性编号及是否存在；空目录或缺失键返回无效编号与 false。
	Lookup(key string) (int, bool)
}

// Layout 保存只读属性编号；扩充目录不会改变已有编号或旧目录。
type Layout struct {
	keys  []string
	index map[string]int
	hp    int
}

type slotPage struct {
	slots   [PageSize]model.AttributeSlotDef
	present uint8
}

// TableAPI 集中声明不可变属性表的查询、派生与局部编辑；旧版本保持可读。
// 声明用于阅读与编译检查；实际调用继续使用具体类型。
type TableAPI interface {
	// At 读取指定键的槽；缺失返回零值，需要区分缺失时使用 Lookup。
	At(key string) model.AttributeSlotDef
	// AtIndex 按编号读取槽；缺失返回零值，需要存在性时使用 LookupIndex。
	AtIndex(index int) model.AttributeSlotDef
	// Edit 创建局部编辑器；开始写入前继续借用原表，完成后发布新不可变表。
	Edit() Editor
	// Index 查询键对应的目录编号；缺失时返回 -1。
	Index(key string) int
	// Layout 借用当前只读属性目录，不暴露可写槽。
	Layout() *Layout
	// Len 返回实际存在的属性槽数，不等于目录长度。
	Len() int
	// Lookup 读取槽及存在性，明确区分缺失与合法零值。
	Lookup(key string) (model.AttributeSlotDef, bool)
	// LookupIndex 按编号读取槽及存在性，越界或未设置返回 false。
	LookupIndex(index int) (model.AttributeSlotDef, bool)
	// PageCount 返回当前目录对应的页数，供分页证据使用。
	PageCount() int
	// Range 按目录顺序借用键与槽值，回调返回 false 时停止。
	Range(visit func(string, model.AttributeSlotDef) bool)
	// RangeIndex 按目录编号顺序借用存在的槽，回调返回 false 时停止。
	RangeIndex(visit func(int, model.AttributeSlotDef) bool)
	// Same 检查是否共享同一表头，或目录、槽存在性及各不可变页全部相同。
	Same(other Table) bool
	// SamePage 检查指定页是否共享同一不可变页。
	SamePage(other Table, page int) bool
	// SameShape 检查目录和槽存在性是否相同，不比较槽值。
	SameShape(other Table) bool
	// ToMap 复制为可独立修改的属性映射，不返回内部存储。
	ToMap() map[string]model.AttributeSlotDef
	// With 返回写入指定键的新表，只复制必要目录与页，不修改旧表。
	With(key string, slot model.AttributeSlotDef) Table
	// WithIndex 返回写入已知编号的新表；不改变旧表及其他页。
	WithIndex(index int, slot model.AttributeSlotDef) Table
	// Without 返回移除指定键的新表，保留旧目录编号和旧表内容。
	Without(key string) Table
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

var _ LayoutAPI = (*Layout)(nil)
var _ TableAPI = (*Table)(nil)

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

func (l *Layout) HPIndex() int {
	if l == nil {
		return -1
	}
	return l.hp
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
