package model

import (
	"encoding/json"
	"errors"
)

type AttackDamageRole string

// The decoder is invoked only for a present role, so old candidates do not
// acquire an extra decoding pass or allocation.
func (v *AttackDamageRole) UnmarshalJSON(data []byte) error {
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if value != AttackDamageRolePrimary && value != AttackDamageRoleReplacePrimary {
		return errors.New("attackDamageRole must be PRIMARY or REPLACE_PRIMARY when present")
	}
	*v = AttackDamageRole(value)
	return nil
}
