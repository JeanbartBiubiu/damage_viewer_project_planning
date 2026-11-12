package authorization

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
)

const testAccount = "73a4b87c-c5d5-4f10-89ee-53a52cd76ba3"
const testHeader = `{"alg":"Ed25519","typ":"dv-wasm-grant+jwt","kid":"isolated-unit-key"}`
const testPayload = `{"iss":"damage-viewer","aud":"damage-viewer-wasm","sub":"` + testAccount + `","subjectType":"PLAYER","canLogin":1,"scope":["engine:compute"],"iat":1000,"nbf":1000,"exp":87400,"authorizationVersion":2,"jti":"d0d487c9-537a-4408-9edf-630c3234fc99"}`
const maintenancePayload = `{"iss":"damage-viewer","aud":"damage-viewer-wasm","sub":"` + testAccount + `","subjectType":"MAINTENANCE","scope":["engine:compute"],"iat":1000,"nbf":1000,"exp":2800,"authorizationVersion":2,"jti":"d0d487c9-537a-4408-9edf-630c3234fc99"}`

func isolatedKey(t *testing.T) (Policy, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return NewPolicy(true, "isolated-unit-key", publicKey), privateKey
}

func signedGrant(privateKey ed25519.PrivateKey, header, payload string) string {
	message := base64.RawURLEncoding.EncodeToString([]byte(header)) + "." + base64.RawURLEncoding.EncodeToString([]byte(payload))
	return message + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(message)))
}

func TestGrantSignatureAndTimeBoundaries(t *testing.T) {
	policy, key := isolatedKey(t)
	grant := signedGrant(key, testHeader, testPayload)
	for _, test := range []struct {
		now  int64
		want Failure
	}{{999, Invalid}, {1000, ""}, {1300, ""}, {44_200, ""}, {87_399, ""}, {87_400, Expired}, {87_401, Expired}} {
		t.Run(fmt.Sprint(test.now), func(t *testing.T) {
			subject, failure := Verify(policy, grant, test.now)
			if failure != test.want || failure == "" && subject != "PLAYER:"+testAccount {
				t.Fatalf("failure=%q subject=%q", failure, subject)
			}
		})
	}
	// 验证原始编码，重排或修改正文但沿用原签名会失败。
	parts := strings.Split(grant, ".")
	parts[1] = base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(testPayload, "1000", "1001", -1)))
	if _, failure := Verify(policy, strings.Join(parts, "."), 1001); failure != Invalid {
		t.Fatal("tampered payload accepted")
	}
	_, otherKey := isolatedKey(t)
	if _, failure := Verify(policy, signedGrant(otherKey, testHeader, testPayload), 1000); failure != Invalid {
		t.Fatal("untrusted signature accepted")
	}
}

func TestGrantStrictHeaderAndClaims(t *testing.T) {
	policy, key := isolatedKey(t)
	tests := []struct{ name, header, payload string }{
		{"algorithm", strings.Replace(testHeader, "Ed25519", "EdDSA", 1), testPayload},
		{"none algorithm", strings.Replace(testHeader, "Ed25519", "none", 1), testPayload},
		{"key", strings.Replace(testHeader, "isolated-unit-key", "another-key", 1), testPayload},
		{"type", strings.Replace(testHeader, "dv-wasm-grant+jwt", "JWT", 1), testPayload},
		{"unknown header", strings.Replace(testHeader, `"alg":`, `"extra":false,"alg":`, 1), testPayload},
		{"duplicate header", strings.Replace(testHeader, `"alg":`, `"alg":"Ed25519","alg":`, 1), testPayload},
		{"escaped duplicate header", strings.Replace(testHeader, `"alg":`, `"\u0061lg":"Ed25519","alg":`, 1), testPayload},
		{"header type", strings.Replace(testHeader, `"Ed25519"`, `null`, 1), testPayload},
		{"header array", `[]`, testPayload},
		{"issuer", testHeader, strings.Replace(testPayload, `"damage-viewer"`, `"untrusted"`, 1)},
		{"audience", testHeader, strings.Replace(testPayload, `"damage-viewer-wasm"`, `"other-service"`, 1)},
		{"audience array", testHeader, strings.Replace(testPayload, `"damage-viewer-wasm"`, `["damage-viewer-wasm"]`, 1)},
		{"account", testHeader, strings.Replace(testPayload, testAccount, "account", 1)},
		{"account null", testHeader, strings.Replace(testPayload, `"`+testAccount+`"`, `null`, 1)},
		{"jti", testHeader, strings.Replace(testPayload, "d0d487c9-537a-4408-9edf-630c3234fc99", "not-a-uuid", 1)},
		{"not paid", testHeader, strings.Replace(testPayload, `"canLogin":1`, `"canLogin":0`, 1)},
		{"boolean paid", testHeader, strings.Replace(testPayload, `"canLogin":1`, `"canLogin":true`, 1)},
		{"string paid", testHeader, strings.Replace(testPayload, `"canLogin":1`, `"canLogin":"1"`, 1)},
		{"float paid", testHeader, strings.Replace(testPayload, `"canLogin":1`, `"canLogin":1.0`, 1)},
		{"exponent paid", testHeader, strings.Replace(testPayload, `"canLogin":1`, `"canLogin":1e0`, 1)},
		{"scope string", testHeader, strings.Replace(testPayload, `["engine:compute"]`, `"engine:compute"`, 1)},
		{"scope extra", testHeader, strings.Replace(testPayload, `["engine:compute"]`, `["engine:compute","edit"]`, 1)},
		{"scope empty", testHeader, strings.Replace(testPayload, `["engine:compute"]`, `[]`, 1)},
		{"scope wrong", testHeader, strings.Replace(testPayload, `["engine:compute"]`, `["edit"]`, 1)},
		{"scope null", testHeader, strings.Replace(testPayload, `["engine:compute"]`, `null`, 1)},
		{"old version", testHeader, strings.Replace(testPayload, `"authorizationVersion":2`, `"authorizationVersion":1`, 1)},
		{"unknown version", testHeader, strings.Replace(testPayload, `"authorizationVersion":2`, `"authorizationVersion":3`, 1)},
		{"version type", testHeader, strings.Replace(testPayload, `"authorizationVersion":2`, `"authorizationVersion":"2"`, 1)},
		{"missing subject type", testHeader, strings.Replace(testPayload, `"subjectType":"PLAYER",`, ``, 1)},
		{"unknown subject type", testHeader, strings.Replace(testPayload, `"subjectType":"PLAYER"`, `"subjectType":"ADMIN"`, 1)},
		{"wrong subject type", testHeader, strings.Replace(testPayload, `"subjectType":"PLAYER"`, `"subjectType":true`, 1)},
		{"player missing paid claim", testHeader, strings.Replace(testPayload, `"canLogin":1,`, ``, 1)},
		{"maintenance with paid claim", testHeader, strings.Replace(maintenancePayload, `"scope":`, `"canLogin":1,"scope":`, 1)},
		{"maintenance with null paid claim", testHeader, strings.Replace(maintenancePayload, `"scope":`, `"canLogin":null,"scope":`, 1)},
		{"maintenance unknown claim", testHeader, strings.Replace(maintenancePayload, `"scope":`, `"extra":false,"scope":`, 1)},
		{"nbf differs", testHeader, strings.Replace(testPayload, `"nbf":1000`, `"nbf":999`, 1)},
		{"long lifetime", testHeader, strings.Replace(testPayload, `"exp":87400`, `"exp":87401`, 1)},
		{"short lifetime", testHeader, strings.Replace(testPayload, `"exp":87400`, `"exp":87399`, 1)},
		{"old five-minute lifetime", testHeader, strings.Replace(testPayload, `"exp":87400`, `"exp":1300`, 1)},
		{"time fraction", testHeader, strings.Replace(testPayload, `"iat":1000`, `"iat":1000.0`, 1)},
		{"time null", testHeader, strings.Replace(testPayload, `"iat":1000`, `"iat":null`, 1)},
		{"missing time", testHeader, strings.Replace(testPayload, `"iat":1000,`, ``, 1)},
		{"overflow", testHeader, strings.Replace(testPayload, `"iat":1000`, `"iat":9223372036854775807`, 1)},
		{"duplicate claim", testHeader, strings.Replace(testPayload, `"canLogin":1`, `"canLogin":0,"canLogin":1`, 1)},
		{"escaped duplicate claim", testHeader, strings.Replace(testPayload, `"iat":1000`, `"\u0069at":1000,"iat":1000`, 1)},
		{"unknown claim", testHeader, strings.Replace(testPayload, `"iss":`, `"extra":false,"iss":`, 1)},
		{"payload array", testHeader, `[]`},
		{"trailing object", testHeader, testPayload + `{}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, failure := Verify(policy, signedGrant(key, test.header, test.payload), 1000); failure != Invalid {
				t.Fatalf("failure=%q want invalid", failure)
			}
		})
	}
}

func TestMaintenanceGrantBoundariesAndSubjectIdentity(t *testing.T) {
	policy, key := isolatedKey(t)
	grant := signedGrant(key, testHeader, maintenancePayload)
	for _, test := range []struct {
		now  int64
		want Failure
	}{{999, Invalid}, {1000, ""}, {2799, ""}, {2800, Expired}} {
		t.Run(fmt.Sprint(test.now), func(t *testing.T) {
			subject, failure := Verify(policy, grant, test.now)
			if failure != test.want || failure == "" && subject != "MAINTENANCE:"+testAccount {
				t.Fatalf("failure=%q subject=%q", failure, subject)
			}
		})
	}
	for _, test := range []struct {
		name string
		iat  int64
		exp  int64
		want Failure
	}{
		{"single second", 1000, 1001, ""},
		{"shorter than session", 1000, 1600, ""},
		{"full session", 1000, 2800, ""},
		{"zero lifetime", 1000, 1000, Invalid},
		{"negative lifetime", 1000, 999, Invalid},
		{"long lifetime", 1000, 2801, Invalid},
		{"player lifetime", 1000, 87400, Invalid},
		{"largest issuance", 9_223_372_036_854_775_806, 9_223_372_036_854_775_807, ""},
		{"largest full lifetime", 9_223_372_036_854_774_007, 9_223_372_036_854_775_807, ""},
		{"subtraction overflow", -9_223_372_036_854_775_808, 9_223_372_036_854_775_807, Invalid},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := strings.NewReplacer(
				`"iat":1000`, fmt.Sprintf(`"iat":%d`, test.iat),
				`"nbf":1000`, fmt.Sprintf(`"nbf":%d`, test.iat),
				`"exp":2800`, fmt.Sprintf(`"exp":%d`, test.exp),
			).Replace(maintenancePayload)
			if _, failure := Verify(policy, signedGrant(key, testHeader, payload), test.iat); failure != test.want {
				t.Fatalf("failure=%q want %q", failure, test.want)
			}
		})
	}
	upper := strings.Replace(maintenancePayload, testAccount, strings.ToUpper(testAccount), 1)
	if subject, failure := Verify(policy, signedGrant(key, testHeader, upper), 1000); failure != "" || subject != "MAINTENANCE:"+testAccount {
		t.Fatalf("subject UUID was not normalized: %q %q", subject, failure)
	}
	playerSubject, failure := Verify(policy, signedGrant(key, testHeader, testPayload), 1000)
	maintenanceSubject, otherFailure := Verify(policy, grant, 1000)
	if failure != "" || otherFailure != "" || playerSubject == maintenanceSubject {
		t.Fatal("different subject types shared one identity")
	}
}

func TestGrantLifetimeOverflowBoundaries(t *testing.T) {
	policy, key := isolatedKey(t)
	for _, test := range []struct {
		name string
		iat  int64
		exp  int64
		want Failure
	}{
		{"largest valid issuance", 9_223_372_036_854_689_407, 9_223_372_036_854_775_807, ""},
		{"expiration overflow", 9_223_372_036_854_689_408, -9_223_372_036_854_775_808, Invalid},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := strings.NewReplacer(
				`"iat":1000`, fmt.Sprintf(`"iat":%d`, test.iat),
				`"nbf":1000`, fmt.Sprintf(`"nbf":%d`, test.iat),
				`"exp":87400`, fmt.Sprintf(`"exp":%d`, test.exp),
			).Replace(testPayload)
			if _, failure := Verify(policy, signedGrant(key, testHeader, payload), test.iat); failure != test.want {
				t.Fatalf("failure=%q want %q", failure, test.want)
			}
		})
	}
}

func TestGrantEncodingLengthAndDisabledMode(t *testing.T) {
	policy, key := isolatedKey(t)
	valid := signedGrant(key, testHeader, testPayload)
	for _, token := range []string{valid + ".", valid + "=", " " + valid, strings.Replace(valid, ".", ".\n", 1), strings.Repeat("x", MaxGrantBytes+1), "a.b.c"} {
		if _, failure := Verify(policy, token, 1000); failure != Invalid {
			t.Fatal("malformed compact encoding accepted")
		}
	}
	if _, failure := Verify(policy, "", 1000); failure != Required {
		t.Fatal("missing authorization accepted")
	}
	var boundary string
	for padding := 0; padding < MaxGrantBytes; padding++ {
		token := signedGrant(key, testHeader, testPayload+strings.Repeat(" ", padding))
		if len(token) == MaxGrantBytes {
			boundary = token
			break
		}
		if len(token) > MaxGrantBytes {
			break
		}
	}
	if boundary == "" {
		t.Fatal("could not construct exact length boundary")
	}
	if _, failure := Verify(policy, boundary, 1000); failure != "" {
		t.Fatalf("4096-byte valid grant rejected: %q", failure)
	}
	for _, token := range []string{"", "malformed", strings.Repeat("x", MaxGrantBytes+1)} {
		if subject, failure := Verify(NewPolicy(false, "", nil), token, 0); failure != "" || subject != "" {
			t.Fatal("explicitly disabled mode inspected authorization")
		}
	}
	if _, failure := Verify(Policy{}, valid, 1000); failure != Invalid {
		t.Fatal("zero policy must fail closed")
	}
}

func TestBuildConfigurationAndTrustedKeyCopy(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(publicKey)
	for _, value := range []string{"", "TRUE", "False", "1", "false "} {
		if _, err := ParseBuildConfig(value, "key", encoded); err == nil {
			t.Fatalf("invalid switch %q accepted", value)
		}
	}
	for _, value := range []string{"", encoded + "=", encoded + "\n", "wrong", base64.RawURLEncoding.EncodeToString(make([]byte, 31))} {
		if _, err := ParseBuildConfig("true", "key", value); err == nil {
			t.Fatal("invalid public key accepted")
		}
	}
	if _, err := ParseBuildConfig("true", "", encoded); err == nil {
		t.Fatal("missing key id accepted")
	}
	if config, err := ParseBuildConfig("false", "ignored", "invalid"); err != nil || config.Required || config.KeyID != "" || config.PublicKey != "" {
		t.Fatal("disabled build must not retain a key")
	}
	if _, err := ParseBuildConfig("true", "test-key", encoded); err != nil {
		t.Fatal(err)
	}
	policy := NewPolicy(true, "isolated-unit-key", publicKey)
	publicKey[0] ^= 1
	if _, failure := Verify(policy, signedGrant(privateKey, testHeader, testPayload), 1000); failure != "" {
		t.Fatal("trusted public key was not copied")
	}
}
