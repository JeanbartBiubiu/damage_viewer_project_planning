package continuation

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/contract"
)

// CollectionWork 只交接懒取得的同次施放消费集合及原预算错误，不取得数值控制。
type CollectionWork interface {
	// CopyFirstPerCast 只在资格及首轮预算通过后取得原共享集合。
	CopyFirstPerCast() map[string]bool
	// CopyCollectionBudgetError 保存原唯一预算原因，返回本次收集失败。
	CopyCollectionBudgetError() *model.EngineError
}

// CollectDamage 在原结算点接纳、冻结并暂存复制事实，只有原发布点才移交收集器。
func (p *Pending) CollectDamage(c *Collector, damage FrozenDamage, commands, maximum int, work CollectionWork) *model.EngineError {
	if c == nil || c.Phantom() || !damage.Operation.CopyableOnHit || damage.Operation.Operation != "damage" {
		return nil
	}
	if commands > maximum {
		return work.CopyCollectionBudgetError()
	}
	damage.ConsumedFirstPerCast = work.CopyFirstPerCast()
	if damage.EventCtx != nil {
		damage.EventSourceKey, damage.EventTargetKey = damage.EventCtx.EventSourceKey, damage.EventCtx.EventTargetKey
		damage.EntrySourceAttrs, damage.EntryTargetAttrs = damage.EventCtx.EntrySourceAttrs, damage.EventCtx.EntryTargetAttrs
		damage.EntrySourceResources, damage.EntryTargetResources = damage.EventCtx.EntrySourceResources, damage.EventCtx.EntryTargetResources
	}
	damage.EventCtx = contract.CloneEventSnapshot(damage.EventCtx)
	p.damages = append(p.damages, damage)
	if c.Counts()+p.count() > maximum {
		return work.CopyCollectionBudgetError()
	}
	return nil
}
