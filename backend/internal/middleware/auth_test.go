package middleware

import (
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
	req2.Header.Set("Authorization", "Bearer "+forgedToken)
	rec2 := httptest.NewRecorder()
	protected.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for forged HMAC signature, got %d", rec2.Code)
	}

	// 3. Valid signed session token WITHOUT CSRF token on POST must return 403 Forbidden
	req3 := httptest.NewRequest(http.MethodPost, "/api/import/backup", strings.NewReader(`{}`))
	req3.Header.Set("Authorization", "Bearer "+signedToken)
	rec3 := httptest.NewRecorder()
	protected.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when X-CSRF-Token is missing on POST, got %d", rec3.Code)
	}

	// 4. Valid signed session token WITH matching X-CSRF-Token on POST succeeds (200 OK)
	req4 := httptest.NewRequest(http.MethodPost, "/api/import/backup", strings.NewReader(`{}`))
	req4.Header.Set("Authorization", "Bearer "+signedToken)
	req4.Header.Set("X-CSRF-Token", csrfToken)
	rec4 := httptest.NewRecorder()
	protected.ServeHTTP(rec4, req4)
	if rec4.Code != http.StatusOK {
		t.Fatalf("expected 200 OK with valid session and CSRF token, got %d", rec4.Code)
	}
}
