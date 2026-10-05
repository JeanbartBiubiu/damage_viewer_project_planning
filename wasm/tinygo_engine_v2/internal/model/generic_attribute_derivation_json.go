package model

import "encoding/json"

func (definition *AttributeDerivationDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "attributeDerivation", "combatantKey attributeKey value valuePolicy", "combatantKey attributeKey value"); err != nil {
		return err
	}
	type attributeDerivationAlias AttributeDerivationDefinition
	return json.Unmarshal(data, (*attributeDerivationAlias)(definition))
}
