package model

import (
	"encoding/json"
	"errors"
	"strings"
)

// SkillHitFollowCandidateKey 缺省表示不跟随；显式声明必须是完整非空候选键。
type SkillHitFollowCandidateKey string

func (key *SkillHitFollowCandidateKey) UnmarshalJSON(data []byte) error {
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if value == "" || strings.TrimSpace(value) != value {
		return errors.New("spellShieldFollowCandidateKey must be a nonempty candidate key when present")
	}
	*key = SkillHitFollowCandidateKey(value)
	return nil
}
