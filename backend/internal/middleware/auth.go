package middleware

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/handlers"
)

type Session struct {
	SessionID string
	Username  string
	CSRFToken string
	ExpiresAt time.Time
}

type AuthManager struct {
	mu         sync.RWMutex
	hmacSecret []byte
	sessions   map[string]Session // keyed by SHA-256(SessionID)
	adminUser  string
	adminHash  string // Salted scrypt hash: scrypt$16384$8$1$<salt>$<hash>
}

func NewAuthManager() *AuthManager {
	secret := make([]byte, 32)
	_, _ = rand.Read(secret)

	am := &AuthManager{
		hmacSecret: secret,
		sessions:   make(map[string]Session),
	}
	am.loadCredentialsFromEnv()
	return am
}

var insecurePasswords = map[string]bool{
	"":          true,
	"admin":     true,
	"admin1234": true,
	"123456":    true,
	"password":  true,
}

func (am *AuthManager) loadCredentialsFromEnv() {
	user := strings.TrimSpace(os.Getenv("ADMIN_USER"))
	passHash := strings.TrimSpace(os.Getenv("ADMIN_PASS_HASH"))
	legacyPass := strings.TrimSpace(os.Getenv("ADMIN_PASS"))

	if user == "" {
		return
	}
	if strings.HasPrefix(passHash, "scrypt$") {
		am.adminUser = user
		am.adminHash = passHash
		return
	}
	if legacyPass != "" && !insecurePasswords[strings.ToLower(legacyPass)] {
		if hashed, err := HashPasswordScrypt(legacyPass); err == nil {
			am.adminUser = user
			am.adminHash = hashed
		}
	}
}

func (am *AuthManager) SetAdminCredentials(username, plainPassword string) error {
	if insecurePasswords[strings.ToLower(strings.TrimSpace(plainPassword))] {
		return http.ErrNoCookie
	}
	hashed, err := HashPasswordScrypt(plainPassword)
	if err != nil {
		return err
	}
	am.mu.Lock()
	am.adminUser = strings.TrimSpace(username)
	am.adminHash = hashed
	am.mu.Unlock()
	return nil
}

func (am *AuthManager) signSessionID(sessionID string) string {
	mac := hmac.New(sha256.New, am.hmacSecret)
	mac.Write([]byte(sessionID))
	sig := hex.EncodeToString(mac.Sum(nil))
	return sessionID + "." + sig
}

func (am *AuthManager) verifySignedToken(signedToken string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(signedToken), ".")
	if len(parts) != 2 || len(parts[0]) != 64 || len(parts[1]) != 64 {
		return "", false
	}
	sessionID := parts[0]
	providedSig, err := hex.DecodeString(parts[1])
	if err != nil {
		return "", false
	}

	mac := hmac.New(sha256.New, am.hmacSecret)
	mac.Write([]byte(sessionID))
	expectedSig := mac.Sum(nil)

	if subtle.ConstantTimeCompare(providedSig, expectedSig) != 1 {
		return "", false
	}
	return sessionID, true
}

func (am *AuthManager) IssueSession(username string, duration time.Duration) (string, string, time.Time, error) {
	var sidBytes, csrfBytes [32]byte
	if _, err := rand.Read(sidBytes[:]); err != nil {
		return "", "", time.Time{}, err
	}
	if _, err := rand.Read(csrfBytes[:]); err != nil {
		return "", "", time.Time{}, err
	}

	sessionID := hex.EncodeToString(sidBytes[:])
	signedToken := am.signSessionID(sessionID)
	csrfToken := hex.EncodeToString(csrfBytes[:])

	idHash := sha256.Sum256([]byte(sessionID))
	key := hex.EncodeToString(idHash[:])
	expiresAt := time.Now().Add(duration)

	am.mu.Lock()
	am.sessions[key] = Session{
		SessionID: sessionID,
		Username:  username,
		CSRFToken: csrfToken,
		ExpiresAt: expiresAt,
	}
	am.mu.Unlock()

	return signedToken, csrfToken, expiresAt, nil
}

func (am *AuthManager) ValidateRequest(r *http.Request) (*Session, bool) {
	signedToken := ""
	if cookie, err := r.Cookie("gk_session"); err == nil {
		signedToken = strings.TrimSpace(cookie.Value)
	}
	if signedToken == "" {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
			signedToken = strings.TrimSpace(authHeader[7:])
		}
	}

	sessionID, ok := am.verifySignedToken(signedToken)
	if !ok {
		return nil, false
	}

	idHash := sha256.Sum256([]byte(sessionID))
	key := hex.EncodeToString(idHash[:])

	am.mu.RLock()
	sess, exists := am.sessions[key]
	am.mu.RUnlock()

	if !exists || time.Now().After(sess.ExpiresAt) {
		return nil, false
	}
	return &sess, true
}

func verifyCSRFAndOrigin(r *http.Request, sess *Session) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return true
	}

	host := strings.TrimSpace(r.Host)
	if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" && host != "" {
		u, err := url.Parse(origin)
		if err != nil || !strings.EqualFold(u.Host, host) {
			return false
		}
	}

	providedCSRF := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
	if len(providedCSRF) == 0 || len(providedCSRF) != len(sess.CSRFToken) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(providedCSRF), []byte(sess.CSRFToken)) == 1
}

// RequireAuth enforces both a valid HMAC-signed server session AND CSRF protection on mutating requests.
func (am *AuthManager) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess, ok := am.ValidateRequest(r)
		if !ok {
			handlers.Error(w, http.StatusUnauthorized, "نشست کاربری معتبر نیست یا منقضی شده است.")
			return
		}
		if !verifyCSRFAndOrigin(r, sess) {
			handlers.Error(w, http.StatusForbidden, "توکن امنیتی CSRF نامعتبر است.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (am *AuthManager) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		handlers.Error(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		Username     string `json:"username"`
		Password     string `json:"password"`
		RememberDays int    `json:"rememberDays"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		handlers.Error(w, http.StatusBadRequest, "ساختار درخواست ورود نامعتبر است")
		return
	}

	am.mu.RLock()
	expectedUser := am.adminUser
	expectedHash := am.adminHash
	am.mu.RUnlock()

	if expectedUser == "" || expectedHash == "" {
		handlers.Error(w, http.StatusServiceUnavailable, "حساب مدیر روی سرور پیکربندی نشده است")
		return
	}

	uHash := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(body.Username))))
	expUHash := sha256.Sum256([]byte(strings.ToLower(expectedUser)))
	userMatch := subtle.ConstantTimeCompare(uHash[:], expUHash[:]) == 1
	passMatch := VerifyPasswordScrypt(body.Password, expectedHash)

	if !userMatch || !passMatch {
		handlers.Error(w, http.StatusUnauthorized, "نام کاربری یا رمز عبور نادرست است")
		return
	}

	days := body.RememberDays
	if days <= 0 || days > 30 {
		days = 30
	}
	signedToken, csrfToken, expiresAt, err := am.IssueSession(expectedUser, time.Duration(days)*24*time.Hour)
	if err != nil {
		handlers.Error(w, http.StatusInternalServerError, "خطا در ایجاد نشست")
		return
	}

	isHTTPS := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     "gk_session",
		Value:    signedToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS,
		MaxAge:   days * 86400,
	})
	// Purge any legacy gk_app_auth cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "gk_app_auth",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	handlers.JSON(w, http.StatusOK, handlers.Envelope{
		"ok":        true,
		"username":  expectedUser,
		"token":     signedToken,
		"csrfToken": csrfToken,
		"expiresAt": expiresAt.UnixMilli(),
	})
}
