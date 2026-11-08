package middleware

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
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

type loginAttemptTracker struct {
	count       int
	windowStart time.Time
}

type AuthManager struct {
	mu            sync.RWMutex
	hmacSecret    []byte
	sessions      map[string]Session
	loginAttempts map[string]*loginAttemptTracker
	adminUser     string
	adminHash     string
}

const (
	maxLoginAttemptsPerWindow = 5
	loginRateLimitWindow      = 5 * time.Minute
	maxRateLimitMapEntries    = 5000
	maxSessionsMapEntries     = 5000
)

var trustedProxies = map[string]bool{
	"127.0.0.1": true,
	"::1":       true,
}

func NewAuthManager() *AuthManager {
	secret := make([]byte, 32)
	_, _ = rand.Read(secret)

	am := &AuthManager{
		hmacSecret:    secret,
		sessions:      make(map[string]Session),
		loginAttempts: make(map[string]*loginAttemptTracker),
	}
	am.loadCredentialsFromEnv()
	return am
}

var insecurePasswords = map[string]bool{
	"":          true,
	"admin":     true,
	"admin1234": true,
	"123456":    true,
	"12345678":  true,
	"password":  true,
}

func AuditLog(event, actor, ip, detail string) {
	cleanActor := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, actor)
	cleanIP := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, ip)
	log.Printf("[AUDIT] event=%s actor=%q ip=%q detail=%q", event, cleanActor, cleanIP, detail)
}

// extractClientIP only trusts X-Real-IP / X-Forwarded-For when the direct peer is a trusted loopback proxy.
func extractClientIP(r *http.Request) string {
	peerHost, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil || peerHost == "" {
		peerHost = strings.TrimSpace(r.RemoteAddr)
	}

	if !trustedProxies[peerHost] {
		return peerHost
	}

	if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" && !strings.Contains(realIP, ",") {
		return realIP
	}

	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			candidate := strings.TrimSpace(parts[i])
			if candidate != "" && !trustedProxies[candidate] {
				return candidate
			}
		}
	}

	return peerHost
}

func (am *AuthManager) sweepExpiredRateLimitsLocked(now time.Time) {
	for ip, tracker := range am.loginAttempts {
		if now.Sub(tracker.windowStart) > loginRateLimitWindow {
			delete(am.loginAttempts, ip)
		}
	}
	if len(am.loginAttempts) >= maxRateLimitMapEntries {
		for ip := range am.loginAttempts {
			delete(am.loginAttempts, ip)
			break
		}
	}
}

func (am *AuthManager) isRateLimited(ip string) bool {
	am.mu.Lock()
	defer am.mu.Unlock()

	now := time.Now()
	tracker, exists := am.loginAttempts[ip]
	if !exists || now.Sub(tracker.windowStart) > loginRateLimitWindow {
		return false
	}
	return tracker.count >= maxLoginAttemptsPerWindow
}

func (am *AuthManager) recordFailedLogin(ip string) {
	am.mu.Lock()
	defer am.mu.Unlock()

	now := time.Now()
	tracker, exists := am.loginAttempts[ip]
	if !exists || now.Sub(tracker.windowStart) > loginRateLimitWindow {
		if len(am.loginAttempts) >= maxRateLimitMapEntries {
			am.sweepExpiredRateLimitsLocked(now)
		}
		am.loginAttempts[ip] = &loginAttemptTracker{count: 1, windowStart: now}
		return
	}
	tracker.count++
}

func (am *AuthManager) clearFailedLogins(ip string) {
	am.mu.Lock()
	delete(am.loginAttempts, ip)
	am.mu.Unlock()
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
	now := time.Now()
	expiresAt := now.Add(duration)

	am.mu.Lock()
	if len(am.sessions) >= maxSessionsMapEntries {
		for k, s := range am.sessions {
			if now.After(s.ExpiresAt) {
				delete(am.sessions, k)
			}
		}
	}
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

func applySecurityHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
	h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
}

func (am *AuthManager) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		applySecurityHeaders(w)
		ip := extractClientIP(r)
		sess, ok := am.ValidateRequest(r)
		if !ok {
			AuditLog("API_UNAUTHORIZED", "anonymous", ip, r.Method+" "+r.URL.Path)
			handlers.Error(w, http.StatusUnauthorized, "نشست کاربری معتبر نیست یا منقضی شده است.")
			return
		}
		if !verifyCSRFAndOrigin(r, sess) {
			AuditLog("API_CSRF_REJECTED", sess.Username, ip, r.Method+" "+r.URL.Path)
			handlers.Error(w, http.StatusForbidden, "توکن امنیتی CSRF نامعتبر است.")
			return
		}
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete {
			AuditLog("DATA_MODIFICATION", sess.Username, ip, r.Method+" "+r.URL.Path)
		}
		next.ServeHTTP(w, r)
	})
}

func (am *AuthManager) HandleLogin(w http.ResponseWriter, r *http.Request) {
	applySecurityHeaders(w)
	if r.Method != http.MethodPost {
		handlers.Error(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	ip := extractClientIP(r)
	if am.isRateLimited(ip) {
		AuditLog("AUTH_RATE_LIMITED", "anonymous", ip, "too many failed login attempts")
		handlers.Error(w, http.StatusTooManyRequests, "تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً ۵ دقیقه دیگر تلاش کنید.")
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
		AuditLog("AUTH_UNCONFIGURED", body.Username, ip, "admin credentials not set")
		handlers.Error(w, http.StatusServiceUnavailable, "حساب مدیر روی سرور پیکربندی نشده است")
		return
	}

	uHash := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(body.Username))))
	expUHash := sha256.Sum256([]byte(strings.ToLower(expectedUser)))
	userMatch := subtle.ConstantTimeCompare(uHash[:], expUHash[:]) == 1
	passMatch := VerifyPasswordScrypt(body.Password, expectedHash)

	if !userMatch || !passMatch {
		am.recordFailedLogin(ip)
		AuditLog("AUTH_LOGIN_FAILED", body.Username, ip, "invalid credentials")
		handlers.Error(w, http.StatusUnauthorized, "نام کاربری یا رمز عبور نادرست است")
		return
	}

	am.clearFailedLogins(ip)
	days := body.RememberDays
	if days <= 0 || days > 30 {
		days = 30
	}
	signedToken, csrfToken, expiresAt, err := am.IssueSession(expectedUser, time.Duration(days)*24*time.Hour)
	if err != nil {
		handlers.Error(w, http.StatusInternalServerError, "خطا در ایجاد نشست")
		return
	}

	AuditLog("AUTH_LOGIN_SUCCESS", expectedUser, ip, "session issued")

	isHTTPS := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" || os.Getenv("ENFORCE_HTTPS") == "true"
	http.SetCookie(w, &http.Cookie{
		Name:     "gk_session",
		Value:    signedToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   isHTTPS,
		MaxAge:   days * 86400,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "gk_app_auth",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   isHTTPS,
		MaxAge:   -1,
	})

	handlers.JSON(w, http.StatusOK, handlers.Envelope{
		"ok":        true,
		"username":  expectedUser,
		"csrfToken": csrfToken,
		"expiresAt": expiresAt.UnixMilli(),
	})
}
