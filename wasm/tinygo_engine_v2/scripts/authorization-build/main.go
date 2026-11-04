// 两种正式构建脚本共享的配置校验、链接参数及产物身份生成器。
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"tinygo_engine_v2/internal/authorization"
)

type artifactIdentity struct {
	Bytes                  int     `json:"bytes"`
	SHA256                 string  `json:"sha256"`
	AuthorizationRequired  bool    `json:"authorizationRequired"`
	AuthorizationVersion   int     `json:"authorizationVersion"`
	AuthorizationKeyID     *string `json:"authorizationKeyId"`
	AuthorizationPublicKey *string `json:"authorizationPublicKey"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	required, present := os.LookupEnv("WASM_AUTH_REQUIRED")
	if !present {
		required = "true"
	}
	config, err := authorization.ParseBuildConfig(required, os.Getenv("WASM_AUTH_KEY_ID"), os.Getenv("WASM_AUTH_PUBLIC_KEY"))
	if err != nil {
		return err
	}
	if len(args) == 1 && args[0] == "flags" {
		const prefix = "tinygo_engine_v2/internal/authorization."
		fmt.Printf("-X=%sbuildRequired=%s -X=%sbuildKeyID=%s -X=%sbuildPublicKey=%s\n", prefix, strconv.FormatBool(config.Required), prefix, config.KeyID, prefix, config.PublicKey)
		return nil
	}
	if len(args) == 2 && args[0] == "identity" {
		return writeIdentity(args[1], config)
	}
	return fmt.Errorf("usage: authorization-build flags | identity <wasm-file>")
}

func writeIdentity(path string, config authorization.BuildConfig) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(data)
	identity := artifactIdentity{
		Bytes: len(data), SHA256: hex.EncodeToString(digest[:]),
		AuthorizationRequired: config.Required, AuthorizationVersion: authorization.Version,
	}
	if config.Required {
		identity.AuthorizationKeyID = &config.KeyID
		identity.AuthorizationPublicKey = &config.PublicKey
	}
	encoded, err := json.MarshalIndent(identity, "", "  ")
	if err != nil {
		return err
	}
	identityPath := strings.TrimSuffix(path, filepath.Ext(path)) + ".identity.json"
	return os.WriteFile(identityPath, append(encoded, '\n'), 0644)
}
