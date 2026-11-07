package utils

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	" math"
	"regexp"
	"strings"
	"time"
)

var (
	isoDateRegex     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	multiSpaceRegex  = regexp.MustCompile(`\s+`)
	persianDigitRepl = strings.NewReplacer(
		"۰", "0", "۱", "1", "۲", "2", "۳", "3", "۴", "4",
		"۵", "5", "۶", "6", "۷", "7", "۸", "8", "۹", "9",
		"٠", "0", "١", "1", "٢", "2", "٣", "3", "٤", "4",
		"٥", "5", "٦", "6", "٧", "7", "٨", "8", "٩", "9",
	)
)

// GenerateID creates a prefixed RFC 4122 v4 UUID (e.g., "purch_550e8400-e29b-41d4-a716-446655440000").
func GenerateID(prefix string) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		now := time.Now().UnixNano()
		return fmt.Sprintf("%s_%d", strings.TrimSuffix(prefix, "_"), now)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80

	uuidStr := fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	)
	cleanPrefix := strings.TrimSuffix(strings.TrimSpace(prefix), "_")
	if cleanPrefix == "" {
		return uuidStr
	}
	return cleanPrefix + "_" + uuidStr
}

// CleanText trims and collapses consecutive whitespace.
func CleanText(s string) string {
	trimmed := strings.TrimSpace(s)
	return multiSpaceRegex.ReplaceAllString(trimmed, " ")
}

// NormalizeProductKey produces a canonical lowercase key for deduplicating product names.
func NormalizeProductKey(name string) string {
	cleaned := CleanText(name)
	// Normalize Arabic Yeh/Kaf variants to standard Persian characters for consistent matching
	replacer := strings.NewReplacer("ي", "ی", "ك", "ک")
	return strings.ToLower(replacer.Replace(cleaned))
}

// IsValidISODate strictly validates a Gregorian YYYY-MM-DD calendar date without UTC offset drift.
func IsValidISODate(dateStr string) bool {
	normalized := persianDigitRepl.Replace(strings.TrimSpace(dateStr))
	if !isoDateRegex.MatchString(normalized) {
		return false
	}
	parsed, err := time.Parse("2006-01-02", normalized)
	if err != nil {
		return false
	}
	year := parsed.Year()
	if year < 1900 || year > 2100 {
		return false
	}
	return parsed.Format("2006-01-02") == normalized
}

// NormalizeISODate normalizes any Persian/Arabic digits in a YYYY-MM-DD string and validates it.
func NormalizeISODate(dateStr string) (string, bool) {
	normalized := persianDigitRepl.Replace(strings.TrimSpace(dateStr))
	if !IsValidISODate(normalized) {
		return "", false
	}
	return normalized, true
}

// ValidateQuantity ensures a quantity is a positive, finite number within safe bounds.
func ValidateQuantity(q float64) bool {
	if math.IsNaN(q) || math.IsInf(q, 0) {
		return false
	}
	return q > 0 && q <= 1_000_000_000
}
