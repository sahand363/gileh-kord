package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/sahand363/gileh-kord/backend/internal/currency"
)

type Envelope map[string]any

func JSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func Error(w http.ResponseWriter, status int, message string, details ...any) {
	errObj := Envelope{
		"code":    status,
		"message": message,
	}
	if len(details) > 0 && details[0] != nil {
		errObj["details"] = details[0]
	}
	JSON(w, status, Envelope{"error": errObj})
}

func DecodeJSON(r *http.Request, dst any) error {
	if r.Body == nil {
		return errors.New("بدنه درخواست خالی است")
	}
	defer r.Body.Close()

	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20)) // 1 MB max payload
	if err := dec.Decode(dst); err != nil {
		return errors.New("ساختار JSON ارسالی معتبر نیست (مقادیر پولی باید عدد صحیح باشند)")
	}
	return nil
}

// ResolveReportingCurrency checks `?currency=RIAL|TOMAN` on the request, falling back to server default.
func ResolveReportingCurrency(r *http.Request, defaultCurr currency.Currency) (currency.Currency, error) {
	q := r.URL.Query().Get("currency")
	if q == "" {
		return defaultCurr, nil
	}
	return currency.ParseCurrency(q)
}
