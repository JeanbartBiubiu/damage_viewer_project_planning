// 本文件实现 Wasm outbox 缓冲区，用于把 ready、log、sample、done、error 等记录返回给宿主。
package abi

import (
	"encoding/json"

	"tinygo_engine_v2/internal/model"
)

const DefaultOutboxCapacity = 256 * 1024

type Outbox struct {
	buf     []byte
	dropped int
}

func NewOutbox(capacity int) Outbox {
	if capacity <= 0 {
		capacity = DefaultOutboxCapacity
	}
	return Outbox{buf: make([]byte, 0, capacity)}
}

func (o *Outbox) Bytes() []byte {
	return o.buf
}

func (o *Outbox) Clear() {
	o.buf = o.buf[:0]
	o.dropped = 0
}

func (o *Outbox) Dropped() int {
	return o.dropped
}

func (o *Outbox) WriteJSON(kind model.FrameKind, payload any) model.ErrCode {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return model.ErrInvalidInput
	}
	return o.WriteFrame(kind, 0, encoded)
}

func (o *Outbox) WriteFrame(kind model.FrameKind, flags uint32, payload []byte) model.ErrCode {
	frame := EncodeFrame(kind, flags, payload)
	if len(frame) > cap(o.buf) {
		if kind == model.FrameKindDone || kind == model.FrameKindError {
			o.buf = o.buf[:0]
			if len(frame) <= cap(o.buf) {
				o.buf = append(o.buf, frame...)
				return model.ErrOK
			}
		}
		o.dropped++
		return model.ErrOK
	}
	if len(o.buf)+len(frame) > cap(o.buf) {
		if kind == model.FrameKindDone || kind == model.FrameKindError {
			o.buf = o.buf[:0]
		} else {
			o.dropped++
			return model.ErrOK
		}
	}
	o.buf = append(o.buf, frame...)
	return model.ErrOK
}
