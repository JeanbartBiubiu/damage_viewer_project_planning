# Katarina MVP Wasm Engine

This crate is the current Rust Wasm execution core for the Katarina MVP.

Authoritative ABI:
- `alloc(len) -> *mut u8`
- `dealloc(ptr, len)`
- `engine_init(ptr, len) -> i32`
- `engine_run(ptr, len) -> i32`
- `engine_response_ptr() -> *const u8`
- `engine_response_len() -> usize`

The ABI is JSON request/response over Wasm memory. The legacy raw numeric ABI
(`run_basic_attack`, `run_death_lotus`, `sample_stride`, `result_stride`) is
obsolete and should not be used by the front-end bridge.

## Host Envelope

Successful call response:

```json
{
  "ok": true,
  "value": {}
}
```

Failed call response:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "..."
  }
}
```

`engine_init` expects `EngineInitPayload` JSON and stores an initialized
session. `engine_run` expects `EngineRunInput` JSON and returns
`EngineRunOutput`.

## Current Supported Scope

- 1v1 only
- `basic_attack`
- `cast_skill`
- On-hit split events for:
  - basic attack body
  - Blade of the Ruined King passive: current enemy HP * `0.12`, physical
  - Nashor's Tooth passive: `15 + 0.15 * AP`, magic
- Resistance mitigation:
  - physical uses `armor`
  - magic uses `magic_resist`
  - true damage bypasses mitigation

## Output Contract

`EngineRunOutput` contains:

- `result`
- `samples`
- `events`

Each event is one resolved hit. Each event contains:

- `sequence`
- `tMs`
- `label`
- `enemyHpBefore`
- `enemyHpAfter`
- `totalRawDamage`
- `totalDealtDamage`
- `components[]`

Each component contains:

- `sourceKind`: `basic_attack | skill | item`
- `sourceId`
- `label`
- `damageType`: `physical | magic | true`
- `rawDamage`
- `dealtDamage`

Numbers are rounded to 3 decimal places before being emitted.

## Golden Example

With the built-in unit test bundle:

- Katarina base AD `112.4`
- + BORK `55 AD`
- + Nashor `90 AP`
- target HP `10000`
- target armor `100`
- target MR `100`

First basic-attack event emits:

- basic attack raw `167.4`, dealt `83.7`
- BORK raw `1200`, dealt `600`
- Nashor raw `28.5`, dealt `14.25`
- total dealt `697.95`

Second basic-attack event reuses the updated target HP, so BORK raw damage is
lower than the first event.

## Build

```powershell
cd wasm/katarina_mvp_engine
cargo build --target wasm32-unknown-unknown --release
```

Copy to the web app:

```powershell
./build-web-wasm.ps1
```

## Current Limitations

- No cancellation inside the Rust run loop yet
- No shields, healing, interruption, movement, or status systems
- No generic formula interpreter yet
- No item passive stacking rules beyond the current MVP logic
- Windows host builds require MSVC linker libraries to run `cargo test`
