package middleware

import (
	"log"
	"net/http"
	"runtime/debug"

	"github.com/sahand363/gileh-kord/backend/internal/handlers"
)

func Recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[PANIC] %v\nStack trace:\n%s", rec, debug.Stack())
				handlers.Error(w, http.StatusInternalServerError, "خطای داخلی سرور")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
