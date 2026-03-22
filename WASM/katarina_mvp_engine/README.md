# Katarina MVP Wasm Engine

This crate is the real Wasm execution core for the current Katarina MVP.

Scope:
- `hero_katarina` vs `hero_dummy_10000hp_100ar_100mr`
- `S0`: basic attack x10
- `S1`: full `R`
- 2-item MVP set:
  - `item_blade_of_the_ruined_king`
  - `item_nashors_tooth`

What this crate does:
- runs the minimal damage loops in real Wasm
- applies resistance mitigation
- writes sample points and result metrics into fixed Wasm memory buffers

What it intentionally does not do yet:
- generic mechanics config interpretation
- control, shield, heal, movement, interrupt systems
- JSON parsing or direct bundle ingestion inside Wasm
- worker/browser integration

## ABI

Exports:
- `sample_stride() -> u32`
- `result_stride() -> u32`
- `samples_ptr() -> *const f64`
- `result_ptr() -> *const f64`
- `run_basic_attack(...) -> u32`
- `run_death_lotus(...) -> u32`

Result buffer layout:
1. `stopReasonCode`
2. `timeToKillEnemyMs` or `-1`
3. `totalDamageToEnemy`
4. `totalDamageToSelf`
5. `executedHits`
6. `actionDurationMs`
7. `sampleCount`

Sample buffer layout per row:
1. `tMs`
2. `selfHp`
3. `enemyHp`
4. `cumulativeDamageToEnemy`
5. `cumulativeDamageToSelf`

## Build

```powershell
cd wasm/katarina_mvp_engine
C:\Users\Administrator\.cargo\bin\cargo.exe build --target wasm32-unknown-unknown --release
```

## Refresh Web Asset

Use:

```powershell
./build-web-wasm.ps1
```

This rebuilds the crate and copies:

- `target/wasm32-unknown-unknown/release/katarina_mvp_engine.wasm`

to:

- `web/src/engine/wasm/katarina_mvp_engine.wasm`
