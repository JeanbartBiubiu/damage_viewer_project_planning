// 本文件封装 TinyGo Wasm 线性内存中的指针和字节切片转换。
package abi

import "unsafe"

func Bytes(ptr uint32, size uint32) []byte {
	if ptr == 0 || size == 0 {
		return nil
	}
	return unsafe.Slice((*byte)(unsafe.Pointer(uintptr(ptr))), int(size))
}

func Ptr(buf []byte) uint32 {
	if len(buf) == 0 {
		return 0
	}
	return uint32(uintptr(unsafe.Pointer(&buf[0])))
}
