// Package authorization 只在编译和运行入口核验计算授权，不参与数值结算。
package authorization

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
	"strings"
)

// Policy 是一次构造后不再修改的可信授权策略；公钥不从请求读取。
type Policy struct {
	disabled bool
	valid    bool
	keyID    string
	key      ed25519.PublicKey
}

// BuildConfig 保存两种构建脚本共同验证并写入产物身份的授权配置。
type BuildConfig struct {
	Required  bool
	KeyID     string
	PublicKey string
}

// Failure 是入口可公开返回的授权错误，不包含票据、正文或签名字节。
type Failure string

const (
	grantLifetimeSeconds         = 24 * 60 * 60
	Version                      = 1
	MaxGrantBytes                = 4096
	Required             Failure = "authorization_required"
	Invalid              Failure = "authorization_invalid"
	Expired              Failure = "authorization_expired"
	AccountMismatch      Failure = "authorization_account_mismatch"
)

// TinyGo 0.40.1 会以源码初值覆盖链接赋值，因此必须保留无初值的字符串变量。
// 这三个值只能由正式构建的链接参数固化；直接编译缺配置时保持拒绝策略。
var buildRequired string
var buildKeyID string
var buildPublicKey string

// ParseBuildConfig 统一验证构建开关、公钥及密钥编号，只接受明确的 true 或 false。
func ParseBuildConfig(required, keyID, publicKey string) (BuildConfig, error) {
	if required != "true" && required != "false" {
		return BuildConfig{}, errors.New("WASM_AUTH_REQUIRED must be exactly true or false")
	}
	if required == "false" {
		return BuildConfig{Required: false}, nil
	}
	if !validKeyID(keyID) {
		return BuildConfig{}, errors.New("WASM_AUTH_KEY_ID must contain 1..128 ASCII letters, digits, dots, underscores or hyphens")
	}
	key, ok := decodeSegment(publicKey)
	if !ok || len(key) != ed25519.PublicKeySize {
		return BuildConfig{}, errors.New("WASM_AUTH_PUBLIC_KEY must be a canonical unpadded base64url encoded 32-byte Ed25519 public key")
	}
	return BuildConfig{Required: true, KeyID: keyID, PublicKey: publicKey}, nil
}

// BuildPolicy 读取链接时固化的策略；缺失或非法配置不自动关闭校验。
func BuildPolicy() Policy {
	required := buildRequired
	if required == "" {
		required = "true"
	}
	config, err := ParseBuildConfig(required, buildKeyID, buildPublicKey)
	if err != nil {
		return Policy{}
	}
	key, _ := decodeSegment(config.PublicKey)
	return NewPolicy(config.Required, config.KeyID, key)
}

// NewPolicy 为独立实例复制可信公钥；启用配置无效时只能拒绝请求。
func NewPolicy(required bool, keyID string, publicKey []byte) Policy {
	if !required {
		return Policy{disabled: true}
	}
	policy := Policy{keyID: keyID}
	if validKeyID(keyID) && len(publicKey) == ed25519.PublicKeySize {
		policy.key = append(ed25519.PublicKey(nil), publicKey...)
		policy.valid = true
	}
	return policy
}

// Verify 核验原始紧凑票据并返回规范化账号编号；关闭模式直接放行且不读取票据。
// now 是入口取得的整数秒，验签成功后才解释正文，不在计算循环中调用。
func Verify(policy Policy, token string, now int64) (string, Failure) {
	if policy.disabled {
		return "", ""
	}
	if token == "" {
		return "", Required
	}
	if !policy.valid || len(token) > MaxGrantBytes {
		return "", Invalid
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", Invalid
	}
	headerBytes, ok := decodeSegment(parts[0])
	if !ok {
		return "", Invalid
	}
	header, ok := strictObject(headerBytes, []string{"alg", "typ", "kid"})
	if !ok || !equalString(header["alg"], "Ed25519") || !equalString(header["typ"], "dv-wasm-grant+jwt") || !equalString(header["kid"], policy.keyID) {
		return "", Invalid
	}
	payloadBytes, ok := decodeSegment(parts[1])
	if !ok {
		return "", Invalid
	}
	signature, ok := decodeSegment(parts[2])
	if !ok || len(signature) != ed25519.SignatureSize || !ed25519.Verify(policy.key, []byte(parts[0]+"."+parts[1]), signature) {
		return "", Invalid
	}
	payload, ok := strictObject(payloadBytes, []string{"iss", "aud", "sub", "canLogin", "scope", "iat", "nbf", "exp", "authorizationVersion", "jti"})
	if !ok || !equalString(payload["iss"], "damage-viewer") || !equalString(payload["aud"], "damage-viewer-wasm") {
		return "", Invalid
	}
	sub, subOK := stringValue(payload["sub"])
	jti, jtiOK := stringValue(payload["jti"])
	canLogin, loginOK := integerValue(payload["canLogin"])
	version, versionOK := integerValue(payload["authorizationVersion"])
	if !subOK || !validUUID(sub) || !jtiOK || !validUUID(jti) || !loginOK || canLogin != 1 || !versionOK || version != Version {
		return "", Invalid
	}
	var scope []string
	if json.Unmarshal(payload["scope"], &scope) != nil || len(scope) != 1 || scope[0] != "engine:compute" {
		return "", Invalid
	}
	iat, iatOK := integerValue(payload["iat"])
	nbf, nbfOK := integerValue(payload["nbf"])
	exp, expOK := integerValue(payload["exp"])
	if !iatOK || !nbfOK || !expOK || nbf != iat || iat > math.MaxInt64-grantLifetimeSeconds || exp != iat+grantLifetimeSeconds {
		return "", Invalid
	}
	if now < nbf {
		return "", Invalid
	}
	if now >= exp {
		return "", Expired
	}
	return strings.ToLower(sub), ""
}

func decodeSegment(value string) ([]byte, bool) {
	if value == "" {
		return nil, false
	}
	for _, char := range value {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_') {
			return nil, false
		}
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	return decoded, err == nil
}

func strictObject(data []byte, names []string) (map[string]json.RawMessage, bool) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return nil, false
	}
	values := make(map[string]json.RawMessage, len(names))
	for decoder.More() {
		token, err := decoder.Token()
		name, stringKey := token.(string)
		if err != nil || !stringKey || !knownName(names, name) {
			return nil, false
		}
		if _, duplicate := values[name]; duplicate {
			return nil, false
		}
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return nil, false
		}
		values[name] = raw
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') || len(values) != len(names) {
		return nil, false
	}
	_, err = decoder.Token()
	return values, err == io.EOF
}

func knownName(names []string, value string) bool {
	for _, name := range names {
		if name == value {
			return true
		}
	}
	return false
}

func stringValue(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var value string
	err := json.Unmarshal(raw, &value)
	return value, err == nil
}

func equalString(raw json.RawMessage, expected string) bool {
	value, ok := stringValue(raw)
	return ok && value == expected
}

func integerValue(raw json.RawMessage) (int64, bool) {
	value, err := strconv.ParseInt(string(raw), 10, 64)
	return value, err == nil
}

func validKeyID(value string) bool {
	if len(value) < 1 || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_' || char == '.') {
			return false
		}
	}
	return true
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if char != '-' {
				return false
			}
		} else if !(char >= '0' && char <= '9' || char >= 'a' && char <= 'f' || char >= 'A' && char <= 'F') {
			return false
		}
	}
	return true
}
