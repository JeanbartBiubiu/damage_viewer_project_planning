package model

import (
	"encoding/json"
	"testing"
)

func TestRunOutputModeExplicitContract(t *testing.T) {
	for _, test := range []struct {
		value string
		want  RunOutputMode
		valid bool
	}{
		{`{}`, "", true},
		{`{"outputMode":"detailed"}`, RunOutputDetailed, true},
		{`{"outputMode":"summary"}`, RunOutputSummary, true},
		{`{"outputMode":null}`, "", false},
		{`{"outputMode":""}`, "", false},
		{`{"outputMode":"SUMMARY"}`, "", false},
		{`{"outputMode":false}`, "", false},
		{`{"outputMode":1}`, "", false},
		{`{"outputMode":{}}`, "", false},
	} {
		t.Run(test.value, func(t *testing.T) {
			var request RunRequest
			err := json.Unmarshal([]byte(test.value), &request)
			if (err == nil) != test.valid || (test.valid && request.OutputMode != test.want) {
				t.Fatalf("outputMode=%q error=%v", request.OutputMode, err)
			}
		})
	}
}
