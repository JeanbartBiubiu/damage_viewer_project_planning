package continuation

import planbundle "tinygo_engine_v2/internal/plan"
import model "tinygo_engine_v2/internal/model"
import (
	"sort"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

// Collector 私有拥有单次真实事件的收集结果；嵌套事件各用原有独立实例。
// CollectorAPI 列出该对象当前实际公开的完整能力。
type CollectorAPI interface {
	// Append 在真实帧已发布后接收可复制事实和重复请求。
	Append(d []FrozenDamage, r []RepeatRequest)
	// CloneSorted 返回按原来源顺序稳定排列的独立切片，保留原追加顺序。
	CloneSorted() (d []FrozenDamage, r []RepeatRequest)
	// Commands 返回该事件已消费的命令数，不退还失败尝试。
	Commands() int
	// Counts 返回已发布的事实及重复请求总数，不借出内部切片。
	Counts() int
	// Phantom 返回当前是否正在执行复制尾部，空指针视为没有复制。
	Phantom() bool
	// Reservation 返回借用中的原额度凭据，由父层在成功边界提交。
	Reservation() usage.Reservation
	// SetCommands 在父层原预算消费位置写入计数。
	SetCommands(value int)
	// SetReservation 关联唯一额度账的真实预留；零值解除关联。
	SetReservation(value usage.Reservation)
}

type Collector struct {
	damages      []FrozenDamage
	repeats      []RepeatRequest
	phantomDepth int
	commandCount int
	reservation  usage.Reservation
}

// Pending 私有保存本帧尚未发布的续接事实。
// PendingAPI 列出该对象当前实际公开的完整能力。
type PendingAPI interface {
	// AddDamage 登记一笔原位完成的逐伤事实，返回稳定索引。
	AddDamage(d FrozenDamage)
	// Count 返回当前帧未发布记录数。
	Count() int
	// Publish 在父层原提交位置转移记录，不决定提交是否成功。
	Publish(c *Collector)
	// RegisterRepeat 在原操作位置检查重复范围、拥有者和默认次数，再暂存真实请求。
	// 复制尾部不产生新的重复请求；失败不影响已发布的前序帧。
	RegisterRepeat(c *Collector, op planbundle.CompiledOperation, owner, provider string, identity Identity) *model.EngineError
}

type Pending struct {
	damages []FrozenDamage
	repeats []RepeatRequest
}

var _ CollectorAPI = (*Collector)(nil)
var _ PendingAPI = (*Pending)(nil)

func (c *Collector) Phantom() bool                          { return c != nil && c.phantomDepth > 0 }
func (c *Collector) Commands() int                          { return c.commandCount }
func (c *Collector) SetCommands(value int)                  { c.commandCount = value }
func (c *Collector) SetReservation(value usage.Reservation) { c.reservation = value }
func (c *Collector) Reservation() usage.Reservation         { return c.reservation }
func (c *Collector) Append(d []FrozenDamage, r []RepeatRequest) {
	c.damages = append(c.damages, d...)
	c.repeats = append(c.repeats, r...)
}
func (c *Collector) Counts() int {
	if c == nil {
		return 0
	}
	return len(c.damages) + len(c.repeats)
}
func (c *Collector) CloneSorted() (d []FrozenDamage, r []RepeatRequest) {
	if c == nil {
		return nil, nil
	}
	d = append([]FrozenDamage(nil), c.damages...)
	r = append([]RepeatRequest(nil), c.repeats...)
	sortCopyableDamagesStable(d)
	sortDeferredRepeatsStable(r)
	return
}
func (p *Pending) AddDamage(d FrozenDamage) { p.damages = append(p.damages, d) }
func (p *Pending) Count() int               { return len(p.damages) + len(p.repeats) }
func (p *Pending) Publish(c *Collector) {
	if c != nil {
		c.Append(p.damages, p.repeats)
	}
}

// sortCopyableDamagesStable 按 provenance 升序稳定排序；完全相同项保持原始相对顺序。
// 键：providerRef、originRef、sourceKey、targetKey、damageType。不依赖 map 遍历。
func sortCopyableDamagesStable(damages []FrozenDamage) {
	sort.SliceStable(damages, func(i, j int) bool {
		a, b := damages[i], damages[j]
		if a.ProviderRef != b.ProviderRef {
			return a.ProviderRef < b.ProviderRef
		}
		if a.OriginRef != b.OriginRef {
			return a.OriginRef < b.OriginRef
		}
		if a.SourceKey != b.SourceKey {
			return a.SourceKey < b.SourceKey
		}
		if a.TargetKey != b.TargetKey {
			return a.TargetKey < b.TargetKey
		}
		return a.DamageType < b.DamageType
	})
}

// sortDeferredRepeatsStable 按 provenance 升序稳定排序；完全相同项保持原始相对顺序。
// 键：ownerProviderRef、ownerCombatantKey、repeatTag、triggerStateKey、repeatScope、threshold、repeatCount。
func sortDeferredRepeatsStable(repeats []RepeatRequest) {
	sort.SliceStable(repeats, func(i, j int) bool {
		a, b := repeats[i], repeats[j]
		if a.OwnerProviderRef != b.OwnerProviderRef {
			return a.OwnerProviderRef < b.OwnerProviderRef
		}
		if a.OwnerCombatantKey != b.OwnerCombatantKey {
			return a.OwnerCombatantKey < b.OwnerCombatantKey
		}
		if a.RepeatTag != b.RepeatTag {
			return a.RepeatTag < b.RepeatTag
		}
		if a.TriggerStateKey != b.TriggerStateKey {
			return a.TriggerStateKey < b.TriggerStateKey
		}
		if a.RepeatScope != b.RepeatScope {
			return a.RepeatScope < b.RepeatScope
		}
		if a.Threshold != b.Threshold {
			return a.Threshold < b.Threshold
		}
		return a.RepeatCount < b.RepeatCount
	})
}
