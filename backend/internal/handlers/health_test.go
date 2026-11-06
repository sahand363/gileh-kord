package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/config"
	"github.com/sahand363/gileh-kord/backend/internal/database"
)

func TestHealthHandler(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "health_test.db")

	db, err := database.Open(dbPath, 5000)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()

	migrator := database.NewMigrator(db, "../../migrations")
	if err := migrator.Up(context.Background()); err != nil {
		t.Fatalf("migrations failed: %v", err)
	}

	cfg, err := config.Load("")
	if err != nil {
		t.Fatalf("config load failed: %v", err)
	}

	handler := NewHealthHandler(db, cfg, time.Now())
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d", rec.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode health json: %v", err)
	}

	if payload["status"] != "ok" {
		t.Fatalf("expected status='ok', got %v", payload["status"])
	}
}
