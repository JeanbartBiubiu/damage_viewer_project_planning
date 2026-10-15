package plan

import "tinygo_engine_v2/internal/typeset"

// DeclaredType 将类型编号与声明状态分开；编号零也是合法类型。
type DeclaredType struct {
	ID       typeset.TypeID
	Declared bool
}

func (t DeclaredType) Lookup() (typeset.TypeID, bool) { return t.ID, t.Declared }

// RuntimeTypeBindings 只保存引擎已知的固定引用，不添加类型或改变错误时机。
type RuntimeTypeBindings struct {
	BasicAttack, SpellShield                            DeclaredType
	SourceInitialized, AbilityStarted                   DeclaredType
	BasicAttackStart, BasicAttackHit, SkillHit          DeclaredType
	DamageInstance, DamageDealt, DamageDealtBasicAttack DeclaredType
	BasicAttackReceived, DamageTaken                    DeclaredType
	AttackLinkApplied, HitLinkApplied                   DeclaredType
	SourceOwner, SourceOpponent, TargetOwner            DeclaredType
}
