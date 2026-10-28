// Package actor 拥有角色的不可变数值状态及帧内暂存副本。
package actor

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
)

// StateAPI 定义已提交数值状态的只读查询及返回新值的更新能力。
type StateAPI interface {
	// Key 返回角色稳定标识。
	Key() string
	// Attributes 返回不可变属性表，后续更新沿属性编辑器的隔离规则进行。
	Attributes() attribute.Table
	// Resources 借用当前已提交资源的只读视图，不公开底层可写集合。
	Resources() model.ResourceView
	// HPMaxAnchor 返回已提交的生命上限锚点。
	HPMaxAnchor() float64
	// WithAttributes 返回替换属性表后的新状态值，不修改原状态。
	WithAttributes(value attribute.Table) State
	// WithHPMaxAnchor 返回替换生命上限锚点后的新状态值，不修改原状态。
	WithHPMaxAnchor(value float64) State
}

// State 是已提交数值状态。复制值不会公开可写资源或改变旧快照。
type State struct {
	key         string
	attributes  attribute.Table
	resources   map[string]model.ResourceSlotDef
	hpMaxAnchor float64
}

// ChangeSetAPI 定义帧内数值投影；发布只影响本包状态，不构成跨子系统事务。
type ChangeSetAPI interface {
	// Attributes 返回当前暂存的不可变属性表。
	Attributes() attribute.Table
	// Resources 借用当前暂存资源的只读视图；需要保留时使用 FreezeResources。
	Resources() model.ResourceView
	// SetAttributes 接收已完成数值运算的属性表，等待统一提交。
	SetAttributes(value attribute.Table)
	// FreezeResources 固定事件或等待入口的资源视图，下一次写入会复制。
	FreezeResources() model.ResourceView
	// SetResource 只接收已由执行层核定的槽值，不公开可写集合或运算回调。
	SetResource(key string, slot model.ResourceSlotDef)
	// Publish 交出本次数值投影，并使继续使用该暂存帧的写入保持隔离。
	Publish(base State) State
	// Clone 为等待预检借用当前数值投影，两份后续写入各自取得副本。
	Clone() ChangeSet
}

// ChangeSet 仅持有数值投影；由执行协调入口在预检通过后统一发布。
type ChangeSet struct {
	attributes      attribute.Table
	resources       map[string]model.ResourceSlotDef
	resourcesShared bool
}

var _ StateAPI = (*State)(nil)
var _ ChangeSetAPI = (*ChangeSet)(nil)

// New 创建已提交角色状态，并复制传入资源集合以隔离调用方后续写入。
func New(key string, attributes attribute.Table, resources map[string]model.ResourceSlotDef) State {
	return State{key: key, attributes: attributes, resources: model.BorrowResources(resources).ToMap()}
}

func (s State) Key() string                   { return s.key }
func (s State) Attributes() attribute.Table   { return s.attributes }
func (s State) Resources() model.ResourceView { return model.BorrowResources(s.resources) }
func (s State) HPMaxAnchor() float64          { return s.hpMaxAnchor }

func (s State) WithAttributes(value attribute.Table) State { s.attributes = value; return s }
func (s State) WithHPMaxAnchor(value float64) State        { s.hpMaxAnchor = value; return s }

// Stage 借用已提交属性及资源建立暂存投影，首次资源写入按需复制。
func Stage(s State) ChangeSet {
	return ChangeSet{attributes: s.attributes, resources: s.resources, resourcesShared: true}
}
func (s ChangeSet) Attributes() attribute.Table          { return s.attributes }
func (s ChangeSet) Resources() model.ResourceView        { return model.BorrowResources(s.resources) }
func (s *ChangeSet) SetAttributes(value attribute.Table) { s.attributes = value }

func (s *ChangeSet) FreezeResources() model.ResourceView {
	s.resourcesShared = true
	return s.Resources()
}

func (s *ChangeSet) writableResources() map[string]model.ResourceSlotDef {
	if s.resourcesShared {
		s.resources = s.Resources().ToMap()
		s.resourcesShared = false
	}
	return s.resources
}

func (s *ChangeSet) SetResource(key string, slot model.ResourceSlotDef) {
	resources := s.writableResources()
	if resources == nil {
		resources = make(map[string]model.ResourceSlotDef)
		s.resources = resources
	}
	resources[key] = slot
}

func (s *ChangeSet) Publish(base State) State {
	s.resourcesShared = true
	base.attributes, base.resources = s.attributes, s.resources
	return base
}

func (s *ChangeSet) Clone() ChangeSet { s.resourcesShared = true; return *s }
