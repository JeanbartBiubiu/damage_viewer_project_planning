// Wasm ABI 二进制 frame：16 字节 header + payload。
//
// 不变量：Magic/SchemaVersion 与 model 常量一致；DecodeFrame 失败时 session 写 E_BAD_MAGIC。
package abi

import (
	"encoding/binary"
	"errors"

	"tinygo_engine_v2/internal/model"
)

const (
	Magic     uint32 = 0x32475644 // "DGV2" little-endian.
	HeaderLen        = 16
)

type Frame struct {
	SchemaVersion uint16
	Kind          model.FrameKind
	Flags         uint32
	Payload       []byte
}

func EncodeFrame(kind model.FrameKind, flags uint32, payload []byte) []byte {
	out := make([]byte, HeaderLen+len(payload))
	binary.LittleEndian.PutUint32(out[0:4], Magic)
	binary.LittleEndian.PutUint16(out[4:6], model.SchemaVersion)
	binary.LittleEndian.PutUint16(out[6:8], uint16(kind))
	binary.LittleEndian.PutUint32(out[8:12], flags)
	binary.LittleEndian.PutUint32(out[12:16], uint32(len(payload)))
	copy(out[HeaderLen:], payload)
	return out
}

func DecodeFrame(input []byte) (Frame, error) {
	if len(input) < HeaderLen {
		return Frame{}, errors.New("frame shorter than header")
	}
	if binary.LittleEndian.Uint32(input[0:4]) != Magic {
		return Frame{}, errors.New("bad frame magic")
	}
	schema := binary.LittleEndian.Uint16(input[4:6])
	if schema != model.SchemaVersion {
		return Frame{}, errors.New("schema version mismatch")
	}
	payloadLen := int(binary.LittleEndian.Uint32(input[12:16]))
	if payloadLen < 0 || HeaderLen+payloadLen > len(input) {
		return Frame{}, errors.New("payload length exceeds frame")
	}
	return Frame{
		SchemaVersion: schema,
		Kind:          model.FrameKind(binary.LittleEndian.Uint16(input[6:8])),
		Flags:         binary.LittleEndian.Uint32(input[8:12]),
		Payload:       input[HeaderLen : HeaderLen+payloadLen],
	}, nil
}
