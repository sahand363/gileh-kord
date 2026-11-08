package middleware

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestScryptUniqueSaltsAndVerification(t *testing.T) {
	pass := "StrongCafePass!2026"
	h1, err := HashPasswordScrypt(pass)
	if err != nil {
		t.Fatalf("HashPasswordScrypt failed: %v", err)
	}
	h2, err := HashPasswordScrypt(pass)
	if err != nil {
		t.Fatalf("second HashPasswordScrypt failed: %v", err)
	}

	if h1 == h2 {
		t.Fatalf("expected unique salts to produce distinct scrypt hashes, got identical hashes")
	}

	if !VerifyPasswordScrypt(pass, h1) || !VerifyPasswordScrypt(pass, h2) {
		t.Fatalf("expected correct password to verify against both salted hashes")
	}
	if VerifyPasswordScrypt("WrongPassword", h1) {
		t.Fatalf("expected wrong password to fail verification")
	}
}

func TestSignedSessionAndCSRFProtection(t *testing.T) {
	am := NewAuthManager()
	if err := am.SetAdminCredentials("sahand", "UltraSecretManager#99"); err != nil {
		t.Fatalf("failed setting credentials: %v", err)
	}

	protected := am.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// 1. Unauthenticated request must return 401
	req1 := httptest.NewRequest(http.MethodGet, "/api/purchases", nil)
	rec1 := httptest.NewRecorder()
	protected.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated request, got %d", rec1.Code)
	}

	// 2. Forged / tampered session token must return 401
	signedToken, csrfToken, _, err := am.IssueSession("sahand", time.Hour)
	if err != nil {
		t.Fatalf("IssueSession failed: %v", err)
	}
	forgedToken := signedToken[:len(signedToken)-2] + "ff"
	req2 := httptest.NewRequest(http.MethodGet, "/api/purchases", nil)
	req2.AddCookie(&http.Cookie{Name: "gk_session", Value: forgedToken})
	rec2 := httptest.NewRecorder()
	protected.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for forged HMAC signature, got %d", rec2.Code)
	}

	// 3. Valid signed session cookie WITHOUT CSRF token on POST must return 403 Forbidden
	req3 := httptest.NewRequest(http.MethodPost, "/api/import/backup", strings.NewReader(`{}`))
	req3.AddCookie(&http.Cookie{Name: "gk_session", Value: signedToken})
	rec3 := httptest.NewRecorder()
	protected.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when X-CSRF-Token is missing on POST, got %d", rec3.Code)
	}

	// 4. Valid signed session cookie WITH matching X-CSRF-Token on POST succeeds (200 OK)
	req4 := httptest.NewRequest(http.MethodPost, "/api/import/backup", strings.NewReader(`{}`))
	req4.AddCookie(&http.Cookie{Name: "gk_session", Value: signedToken})
	req4.Header.Set("X-CSRF-Token", csrfToken)
	rec4 := httptest.NewRecorder()
	protected.ServeHTTP(rec4, req4)
	if rec4.Code != http.StatusOK {
		t.Fatalf("expected 200 OK with valid session and CSRF token, got %d", rec4.Code)
	}
}

func TestBruteForceRateLimitingAndZeroTokenLeakage(t *testing.T) {
	am := NewAuthManager()
	if err := am.SetAdminCredentials("sahand", "UltraSecretManager#99"); err != nil {
		t.Fatalf("failed setting credentials: %v", err)
	}

	// 1. Successful login must NOT expose raw session token in JSON body
	validBody, _ := json.Marshal(map[string]any{
		"username":     "sahand",
		"password":     "UltraSecretManager#99",
		"rememberDays": 30,
	})
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(validBody))
	loginReq.RemoteAddr = "198.51.100.10:54321"
	loginRec := httptest.NewRecorder()
	am.HandleLogin(loginRec, loginReq)

	if loginRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on valid login, got %d", loginRec.Code)
	}
	var respPayload map[string]any
	_ = json.Unmarshal(loginRec.Body.Bytes(), &respPayload)
	if _, leaked := respPayload["token"]; leaked {
		t.Fatalf("session token must NOT be exposed in JSON response body")
	}

	// 2. Five failed attempts from an IP must trigger 429 Too Many Requests on the 6th attempt
	badBody, _ := json.Marshal(map[string]any{
		"username": "sahand",
		"password": "WrongPassword123",
	})
	for i := 1; i <= 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(badBody))
		req.RemoteAddr = "203.0.113.55:12345"
		rec := httptest.NewRecorder()
		am.HandleLogin(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401 Unauthorized, got %d", i, rec.Code)
		}
	}

	req6 := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(badBody))
	req6.RemoteAddr = "203.0.113.55:12345"
	rec6 := httptest.NewRecorder()
	am.HandleLogin(rec6, req6)
	if rec6.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt 6: expected 429 Too Many Requests, got %d", rec6.Code)
	}
}
