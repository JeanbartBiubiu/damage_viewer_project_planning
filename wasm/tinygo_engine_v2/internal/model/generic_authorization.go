package model

import (
	"encoding/json"
	"errors"
	"strings"
)

func (value *CompileRequest) UnmarshalJSON(data []byte) error {
	fields, err := strictJSONObject(data, "CompileRequest")
	if err != nil {
		return err
	}
	if err := validateAuthorizationJSON(fields); err != nil {
		return err
	}
	type plain CompileRequest
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = CompileRequest(decoded)
	return nil
}

func validateAuthorizationJSON(fields map[string]json.RawMessage) error {
	for key, value := range fields {
		if strings.EqualFold(key, "authorization") && (key != "authorization" || len(value) == 0 || value[0] != '"') {
			return errors.New("authorization must be a string using its exact field name")
		}
	}
	return nil
}
