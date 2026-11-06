package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/config"
	"github.com/sahand363/gileh-kord/backend/internal/currency"
	"github.com/sahand363/gileh-kord/backend/internal/database"
)

type HealthHandler struct {
	db        *database.DB
	cfg       *config.Config
	startTime time.Time
}

func NewHealthHandler(db *database.DB, cfg *config.Config, startTime time.Time) *HealthHandler {
	return &HealthHandler{
		db:        db,
		cfg:       cfg,
		startTime: startTime,
	}
}

func (h *HealthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		Error(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	dbStatus := "connected"
	httpStatus := http.StatusOK
	if err := h.db.PingContext(ctx); err != nil {
		dbStatus = "unreachable: " + err.Error()
		httpStatus = http.StatusServiceUnavailable
	}

	nowLocal := time.Now().In(h.cfg.Location)

	JSON(w, httpStatus, Envelope{
		"status":      "ok",
		"app":         "GILEH KORD Backend",
		"version":     "1.0.0-milestone1",
		"uptime":      time.Since(h.startTime).Round(time.Millisecond).String(),
		"server_time": nowLocal.Format(time.RFC3339),
		"timezone":    h.cfg.Timezone,
		"database": Envelope{
			"engine": "sqlite (modernc.org/sqlite)",
			"status": dbStatus,
		},
		"currency": Envelope{
			"canonical":       currency.Toman,
			"reporting":       h.cfg.ReportingCurrency,
			"reporting_label": currency.LabelPersian(h.cfg.ReportingCurrency),
			"rial_per_toman":  currency.RialPerToman,
		},
		"transport": Envelope{
			"tls_enabled": h.cfg.IsTLSEnabled(),
		},
	})
}
