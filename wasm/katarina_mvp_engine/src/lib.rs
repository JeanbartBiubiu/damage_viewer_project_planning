#[cfg(test)]
mod benchmark_fixture;
mod catalog;
mod combat_math;
mod engine;
mod effects;
mod formula;
mod model;
mod runtime;
mod sim;
mod types;
#[cfg(test)]
mod benchmark_tests;
#[cfg(test)]
mod benchmark_review_regressions;

// Public re-exports for examples and external benchmarks
pub use engine::{init_session, run, run_full_battle, EngineSession};
pub use model::{
    CombatantInit, EngineActionPlan, EngineConfig, EngineError, EngineInitPayload,
    EngineRunInput, EngineMeta, InitialCombatants, StopCondition, TestProfile,
};

use crate::model::{HostErrorResponse, HostSuccess};
use std::slice;
use std::sync::{Mutex, OnceLock};

static ENGINE_SESSION: OnceLock<Mutex<Option<EngineSession>>> = OnceLock::new();
static RESPONSE_BUFFER: OnceLock<Mutex<Vec<u8>>> = OnceLock::new();

fn session_store() -> &'static Mutex<Option<EngineSession>> {
    ENGINE_SESSION.get_or_init(|| Mutex::new(None))
}

fn response_store() -> &'static Mutex<Vec<u8>> {
    RESPONSE_BUFFER.get_or_init(|| Mutex::new(Vec::new()))
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let _ = Vec::from_raw_parts(ptr, len, len);
}

#[no_mangle]
pub extern "C" fn engine_init(ptr: *const u8, len: usize) -> i32 {
    match read_json::<EngineInitPayload>(ptr, len).and_then(init_session) {
        Ok(session) => {
            if let Ok(mut store) = session_store().lock() {
                *store = Some(session);
            }
            write_success(serde_json::json!({ "initialized": true }));
            0
        }
        Err(error) => {
            write_error(error);
            1
        }
    }
}

#[no_mangle]
pub extern "C" fn engine_run(ptr: *const u8, len: usize) -> i32 {
    let session = match session_store().lock() {
        Ok(store) => store.clone(),
        Err(_) => None,
    };

    let Some(session) = session else {
        write_error(EngineError {
            code: model::ErrorCode::RuntimeError,
            message: "Engine not initialized".to_string(),
        });
        return 1;
    };

    match read_json::<EngineRunInput>(ptr, len).and_then(|input| run(&session, input)) {
        Ok(output) => {
            write_success(output);
            0
        }
        Err(error) => {
            write_error(error);
            1
        }
    }
}

#[no_mangle]
pub extern "C" fn engine_response_ptr() -> *const u8 {
    match response_store().lock() {
        Ok(response) => response.as_ptr(),
        Err(_) => std::ptr::null(),
    }
}

#[no_mangle]
pub extern "C" fn engine_response_len() -> usize {
    match response_store().lock() {
        Ok(response) => response.len(),
        Err(_) => 0,
    }
}

fn read_json<T: serde::de::DeserializeOwned>(ptr: *const u8, len: usize) -> Result<T, EngineError> {
    if ptr.is_null() {
        return Err(EngineError {
            code: model::ErrorCode::InvalidInput,
            message: "Input pointer is null".to_string(),
        });
    }
    let bytes = unsafe { slice::from_raw_parts(ptr, len) };
    serde_json::from_slice(bytes).map_err(|error| EngineError {
        code: model::ErrorCode::InvalidInput,
        message: format!("Invalid JSON payload: {error}"),
    })
}

fn write_success<T: serde::Serialize>(value: T) {
    let payload = serde_json::to_vec(&HostSuccess { ok: true, value }).unwrap_or_else(|error| {
        serde_json::to_vec(&HostErrorResponse {
            ok: false,
            error: EngineError {
                code: model::ErrorCode::RuntimeError,
                message: format!("Failed to serialize success response: {error}"),
            },
        })
        .unwrap()
    });
    if let Ok(mut response) = response_store().lock() {
        *response = payload;
    }
}

fn write_error(error: EngineError) {
    let payload = serde_json::to_vec(&HostErrorResponse { ok: false, error }).unwrap_or_else(|fallback_error| {
        format!(
            "{{\"ok\":false,\"error\":{{\"code\":\"RUNTIME_ERROR\",\"message\":\"{fallback_error}\"}}}}"
        )
        .into_bytes()
    });
    if let Ok(mut response) = response_store().lock() {
        *response = payload;
    }
}
