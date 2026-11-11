package pipeline

import (
	"fmt"

	"tinygo_engine_v2/internal/formula"
)

// AttributeGroupIssue 将分组失败绑定到实际参与的来源和已编译公式位置。
// 这里只保存值与错误，不接收角色状态或执行控制。
type AttributeGroupIssue struct {
	AttributeKey string
	Member       MountedAttributeModifier
	ValuePath    string
	Cause        error
}

type attributeGroupParticipant struct {
	member MountedAttributeModifier
	value  float64
}

func (e *AttributeGroupIssue) Error() string {
	return fmt.Sprintf("attribute %s modifier %s owner %s provider %s: %v", e.AttributeKey, e.Member.ModifierKey, e.Member.OwnerCombatantKey, e.Member.ProviderRef, e.Cause)
}
func (e *AttributeGroupIssue) Unwrap() error { return e.Cause }

func attributeGroupIssue(key string, member MountedAttributeModifier, formulas formula.Library, cause error) error {
	path := ""
	if int(member.ValueProgram) < formulas.Metadata.Count() {
		path = formulas.Metadata.Info(formula.GenericProgramID(member.ValueProgram)).Key
	}
	return &AttributeGroupIssue{AttributeKey: key, Member: member, ValuePath: path, Cause: cause}
}

func attributeGroupFailureSource(members []attributeGroupParticipant, id uint16, matchID bool) MountedAttributeModifier {
	var selected MountedAttributeModifier
	for index := len(members) - 1; index >= 0; index-- {
		entry := members[index]
		if matchID && entry.member.MultiplierGroupID != id {
			continue
		}
		selected = entry.member
		if entry.value > 1 {
			return selected
		}
	}
	return selected
}
