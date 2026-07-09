package abi

import (
	"fmt"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestOutboxKeepsGenericPriorityFrames(t *testing.T) {
	kinds := []model.FrameKind{
		model.FrameKindGenericCompileResult,
		model.FrameKindGenericDone,
		model.FrameKindGenericError,
		model.FrameKindGenericSnapshot,
		model.FrameKindGenericReleaseResult,
	}
	for _, kind := range kinds {
		t.Run(fmt.Sprintf("kind_%d", kind), func(t *testing.T) {
			outbox := NewOutbox(64)
			for i := 0; i < 8; i++ {
				if code := outbox.WriteFrame(model.FrameKindLog, 0, []byte("drop")); code != model.ErrOK {
					t.Fatalf("write log failed: %s", code)
				}
			}
			if code := outbox.WriteFrame(kind, 0, []byte("priority")); code != model.ErrOK {
				t.Fatalf("write priority frame failed: %s", code)
			}
			frame, err := DecodeFrame(outbox.Bytes())
			if err != nil {
				t.Fatal(err)
			}
			if frame.Kind != kind {
				t.Fatalf("got %v, want %v", frame.Kind, kind)
			}
		})
	}
}
