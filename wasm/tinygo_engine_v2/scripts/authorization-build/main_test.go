package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"tinygo_engine_v2/internal/authorization"
)

func TestIdentityMatchesArtifactAndBuildMode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "engine.wasm")
	data := []byte{0, 97, 115, 109}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	for _, config := range []authorization.BuildConfig{{Required: false}, {Required: true, KeyID: "isolated-key", PublicKey: "public-key"}} {
		if err := writeIdentity(path, config); err != nil {
			t.Fatal(err)
		}
		encoded, err := os.ReadFile(filepath.Join(filepath.Dir(path), "engine.identity.json"))
		if err != nil {
			t.Fatal(err)
		}
		var identity artifactIdentity
		if err := json.Unmarshal(encoded, &identity); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(data)
		if identity.Bytes != len(data) || identity.SHA256 != hex.EncodeToString(digest[:]) || identity.AuthorizationRequired != config.Required || identity.AuthorizationVersion != 1 {
			t.Fatal("identity does not match artifact and mode")
		}
		if config.Required && (identity.AuthorizationKeyID == nil || *identity.AuthorizationKeyID != config.KeyID || identity.AuthorizationPublicKey == nil || *identity.AuthorizationPublicKey != config.PublicKey) {
			t.Fatal("enabled metadata lost trusted key")
		}
		if !config.Required && (identity.AuthorizationKeyID != nil || identity.AuthorizationPublicKey != nil) {
			t.Fatal("disabled metadata retained a trusted key")
		}
	}
}

func TestBuildFlagsRejectUnsafeConfigurationBeforeBuild(t *testing.T) {
	t.Setenv("WASM_AUTH_REQUIRED", "TRUE")
	if run([]string{"flags"}) == nil {
		t.Fatal("invalid flag accepted")
	}
	t.Setenv("WASM_AUTH_REQUIRED", "true")
	t.Setenv("WASM_AUTH_KEY_ID", "")
	t.Setenv("WASM_AUTH_PUBLIC_KEY", "")
	if run([]string{"flags"}) == nil {
		t.Fatal("missing trusted key accepted")
	}
}
