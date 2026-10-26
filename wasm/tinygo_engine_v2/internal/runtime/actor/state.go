// Package actor 拥有角色的不可变数值状态及帧内暂存副本。
package actor

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
)

// State 是已提交数值状态。复制值不会公开可写资源或改变旧快照。
type State struct {
	key         string
	attributes  attribute.Table
	resources   map[string]model.ResourceSlotDef
	hpMaxAnchor float64
}

func New(key string, attributes attribute.Table, resources map[string]model.ResourceSlotDef) State {
	return State{key: key, attributes: attributes, resources: model.BorrowResources(resources).ToMap()}
}

func (s State) Key() string                   { return s.key }
func (s State) Attributes() attribute.Table   { return s.attributes }
func (s State) Resources() model.ResourceView { return model.BorrowResources(s.resources) }
func (s State) HPMaxAnchor() float64          { return s.hpMaxAnchor }

func (s State) WithAttributes(value attribute.Table) State { s.attributes = value; return s }
func (s State) WithHPMaxAnchor(value float64) State        { s.hpMaxAnchor = value; return s }

// ChangeSet 仅持有数值投影；由执行协调入口在预检通过后统一发布。
type ChangeSet struct {
	attributes      attribute.Table
	resources       map[string]model.ResourceSlotDef
	resourcesShared bool
}

func Stage(s State) ChangeSet {
	return ChangeSet{attributes: s.attributes, resources: s.resources, resourcesShared: true}
}
func (s ChangeSet) Attributes() attribute.Table          { return s.attributes }
func (s ChangeSet) Resources() model.ResourceView        { return model.BorrowResources(s.resources) }
func (s *ChangeSet) SetAttributes(value attribute.Table) { s.attributes = value }

// FreezeResources 固定事件/等待入口的资源视图，下一次写入会复制。
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

// SetResource 只接收已由执行层核定的槽值，不公开可写集合或运算回调。
func (s *ChangeSet) SetResource(key string, slot model.ResourceSlotDef) {
	resources := s.writableResources()
	if resources == nil {
		resources = make(map[string]model.ResourceSlotDef)
		s.resources = resources
	}
	resources[key] = slot
}

// Publish 交出本次数值投影，并使继续使用该暂存帧的写入保持隔离。
func (s *ChangeSet) Publish(base State) State {
	s.resourcesShared = true
	base.attributes, base.resources = s.attributes, s.resources
	return base
}

// Clone 为等待预检借用当前数值投影；两份后续写入各自取得副本。
func (s *ChangeSet) Clone() ChangeSet { s.resourcesShared = true; return *s }
