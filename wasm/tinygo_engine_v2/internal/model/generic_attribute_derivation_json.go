package model

import "encoding/json"

func (definition *AttributeDerivationDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "attributeDerivation", "combatantKey attributeKey value valuePolicy valueType skillKey", "combatantKey attributeKey value valuePolicy valueType"); err != nil {
		return err
	}
	type attributeDerivationAlias AttributeDerivationDefinition
	return json.Unmarshal(data, (*attributeDerivationAlias)(definition))
}
