import assert from "node:assert/strict";
import test from "node:test";
import {
  HEADER_LEN,
  MAGIC,
  SCHEMA_VERSION,
  decodeFrames,
  encodeFrame,
  setNodeAuthorizationProvider,
  withNodeAuthorization,
} from "./generic-abi-host.mjs";

test('短期票据逐次获取且显式负例不会被本地注入覆盖', () => {
  let count = 0;
  try {
    setNodeAuthorizationProvider(() => `short-grant-${++count}`);
    const input = { rulesHash: 'unchanged' };
    assert.equal(withNodeAuthorization(input).authorization, 'short-grant-1');
    assert.equal(withNodeAuthorization(input).authorization, 'short-grant-2');
    assert.deepEqual(input, { rulesHash: 'unchanged' });
    const negative = { authorization: '' };
    assert.equal(withNodeAuthorization(negative), negative);
    assert.equal(count, 2);
  } finally {
    setNodeAuthorizationProvider(undefined);
  }
});

function headerBytes({ magic = MAGIC, schemaVersion = SCHEMA_VERSION, kind = 210, flags = 0, payloadLen }) {
  const header = new Uint8Array(HEADER_LEN);
  const view = new DataView(header.buffer);
  view.setUint32(0, magic, true);
  view.setUint16(4, schemaVersion, true);
  view.setUint16(6, kind, true);
  view.setUint32(8, flags, true);
  view.setUint32(12, payloadLen, true);
  return header;
}

test("decodeFrames rejects wrong schema version", () => {
  const payload = new Uint8Array([1, 2, 3]);
  const bytes = new Uint8Array(HEADER_LEN + payload.length);
  bytes.set(headerBytes({ schemaVersion: SCHEMA_VERSION + 1, payloadLen: payload.length }), 0);
  bytes.set(payload, HEADER_LEN);
  assert.throws(() => decodeFrames(bytes), /unsupported schema version/);
});

test("decodeFrames rejects 1-byte trailing fragment", () => {
  const frame = encodeFrame(210, new Uint8Array([9]));
  const bytes = new Uint8Array(frame.length + 1);
  bytes.set(frame, 0);
  bytes[frame.length] = 0xff;
  assert.throws(() => decodeFrames(bytes), /trailing fragment of 1 byte/);
});

test("decodeFrames rejects 15-byte trailing fragment", () => {
  const frame = encodeFrame(210, new Uint8Array([9]));
  const trailing = new Uint8Array(15).fill(0xab);
  const bytes = new Uint8Array(frame.length + trailing.length);
  bytes.set(frame, 0);
  bytes.set(trailing, frame.length);
  assert.throws(() => decodeFrames(bytes), /trailing fragment of 15 byte/);
});

test("decodeFrames rejects truncated payload", () => {
  const bytes = headerBytes({ payloadLen: 8 });
  assert.throws(() => decodeFrames(bytes), /truncated/);
});

test("decodeFrames accepts a valid frame round trip", () => {
  const payload = new TextEncoder().encode('{"ok":true}');
  const encoded = encodeFrame(210, payload);
  const frames = decodeFrames(encoded);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].schemaVersion, SCHEMA_VERSION);
  assert.equal(frames[0].kind, 210);
  assert.deepEqual(frames[0].payload, payload);
});
