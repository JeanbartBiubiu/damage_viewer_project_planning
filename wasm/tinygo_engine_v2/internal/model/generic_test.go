package model

import "testing"

func TestGenericFrameKindNumbers(t *testing.T) {
	cases := []struct {
		name string
		kind FrameKind
		want uint16
	}{
		{"compile", FrameKindGenericCompile, 200},
		{"run", FrameKindGenericRun, 201},
		{"release", FrameKindGenericReleaseSession, 202},
		{"compile_result", FrameKindGenericCompileResult, 210},
		{"done", FrameKindGenericDone, 211},
		{"error", FrameKindGenericError, 212},
		{"snapshot", FrameKindGenericSnapshot, 213},
		{"release_result", FrameKindGenericReleaseResult, 214},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if uint16(tc.kind) != tc.want {
				t.Fatalf("kind %s = %d, want %d", tc.name, tc.kind, tc.want)
			}
		})
	}
}
