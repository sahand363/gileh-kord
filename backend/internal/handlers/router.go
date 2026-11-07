package handlers

import (
	"net/http"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/config"
	"github.com/sahand363/gileh-kord/backend/internal/database"
	"github.com/sahand363/gileh-kord/backend/internal/repositories"
)

// RegisterRoutes mounts all Milestone 1 & 2 HTTP routes on the provided ServeMux.
// Note on Authorization: /api/products and /api/purchases are operational procurement
// endpoints used by daily kitchen/purchasing staff. Sensitive manager-only financial
// and revenue endpoints will be mounted behind server-side session authentication.
func RegisterRoutes(mux *http.ServeMux, db *database.DB, cfg *config.Config, startTime time.Time) {
	productRepo := repositories.NewProductRepository(db)
	purchaseRepo := repositories.NewPurchaseRepository(db)

	healthHandler := NewHealthHandler(db, cfg, startTime)
	productHandler := NewProductHandler(productRepo, cfg)
	purchaseHandler := NewPurchaseHandler(purchaseRepo, cfg)

	mux.Handle("/api/health", healthHandler)

	mux.HandleFunc("/api/products", productHandler.ServeCollection)
	mux.HandleFunc("/api/products/{id}", productHandler.ServeItem)
	mux.HandleFunc("/api/products/", productHandler.ServeItem)

	mux.HandleFunc("/api/purchases", purchaseHandler.ServeCollection)
	mux.HandleFunc("/api/purchases/{id}", purchaseHandler.ServeItem)
	mux.HandleFunc("/api/purchases/", purchaseHandler.ServeItem)
}
