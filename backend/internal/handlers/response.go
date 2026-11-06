package handlers

import (
	"encoding/json"
	"net/http"
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
