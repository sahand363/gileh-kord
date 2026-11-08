package middleware

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/handlers"
)

type Session struct {
	Username  string
	ExpiresAt time.Time
}

type AuthManager struct {
	mu       sync.RWMutex
	sessions map[string]Session
}

func NewAuthManager() *AuthManager {
	return &AuthManager{
		sessions: make(map[string]Session),
	}
}

var insecurePasswords = map[string]bool{
	"":          true,
	"admin":     true,
	"admin1234": true,
	"123456":    true,
	"password":  true,
}

func verifyEnvCredentials(username, password string) (string, bool, bool) {
	adminUser := strings.TrimSpace(os.Getenv("ADMIN_USER"))
	adminPass := strings.TrimSpace(os.Getenv("ADMIN_PASS"))

	if adminUser == "" || insecurePasswords[strings.ToLower(adminPass)] {
		return "", false, false // not configured
	}

	uHash := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(username))))
	expectedUHash := sha256.Sum256([]byte(strings.ToLower(adminUser)))

	pHash := sha256.Sum256([]byte(password))
	expectedPHash := sha256.Sum256([]byte(adminPass))

	uMatch := subtle.ConstantTimeCompare(uHash[:], expectedUHash[:]) == 1
	pMatch := subtle.ConstantTimeCompare(pHash[:], expectedPHash[:]) == 1

	if uMatch && pMatch && len(password) == len(adminPass) {
		return adminUser, true, true
	}
	return "", false, true
}

func (am *AuthManager) IssueToken(username string, duration time.Duration) (string, time.Time, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", time.Time{}, err
	}
	rawToken := hex.EncodeToString(b[:])
	tokenHash := sha256.Sum256([]byte(rawToken))
	key := hex.EncodeToString(tokenHash[:])

	expiresAt := time.Now().Add(duration)
	am.mu.Lock()
	am.sessions[key] = Session{
		Username:  username,
		ExpiresAt: expiresAt,
	}
	am.mu.Unlock()

	return rawToken, expiresAt, nil
}

func (am *AuthManager) ValidateRequest(r *http.Request) (*Session, bool) {
	rawToken := ""
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		rawToken = strings.TrimSpace(authHeader[7:])
	}
	if rawToken == "" {
		if cookie, err := r.Cookie("gk_session"); err == nil {
			rawToken = strings.TrimSpace(cookie.Value)
		}
	}
	if len(rawToken) < 32 {
		return nil, false
	}

	tokenHash := sha256.Sum256([]byte(rawToken))
	key := hex.EncodeToString(tokenHash[:])

	am.mu.RLock()
	sess, exists := am.sessions[key]
	am.mu.RUnlock()

	if !exists || time.Now().After(sess.ExpiresAt) {
		return nil, false
	}
	return &sess, true
}

func (am *AuthManager) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := am.ValidateRequest(r); !ok {
			handlers.Error(w, http.StatusUnauthorized, "دسترسی غیرمجاز. لطفاً ابتدا وارد حساب کاربری خود شوید.")
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

	verifiedUser, ok, configured := verifyEnvCredentials(body.Username, body.Password)
	if !configured {
		handlers.Error(w, http.StatusServiceUnavailable, "رمز عبور امن مدیر روی سرور پیکربندی نشده است")
		return
	}
	if !ok {
		handlers.Error(w, http.StatusUnauthorized, "نام کاربری یا رمز عبور نادرست است")
		return
	}

	days := body.RememberDays
	if days <= 0 || days > 30 {
		days = 30
	}
	token, expiresAt, err := am.IssueToken(verifiedUser, time.Duration(days)*24*time.Hour)
	if err != nil {
		handlers.Error(w, http.StatusInternalServerError, "خطا در ایجاد نشست")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "gk_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
		MaxAge:   days * 86400,
	})

	handlers.JSON(w, http.StatusOK, handlers.Envelope{
		"ok":        true,
		"username":  verifiedUser,
		"token":     token,
		"expiresAt": expiresAt.UnixMilli(),
	})
}
