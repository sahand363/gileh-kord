package handlers

import (
	"net/http"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/config"
	"github.com/sahand363/gileh-kord/backend/internal/database"
	"github.com/sahand363/gileh-kord/backend/internal/repositories"
)

func RegisterRoutes(mux *http.ServeMux, db *database.DB, cfg *config.Config, startTime time.Time) {
	productRepo := repositories.NewProductRepository(db)
	purchaseRepo := repositories.NewPurchaseRepository(db)

	healthHandler := NewHealthHandler(db, cfg, startTime)
	productHandler := NewProductHandler(productRepo, cfg)
	purchaseHandler := NewPurchaseHandler(purchaseRepo, cfg)
	importHandler := NewImportHandler(db)

	mux.Handle("/api/health", healthHandler)

	mux.HandleFunc("/api/products", productHandler.ServeCollection)
	mux.HandleFunc("/api/products/{id}", productHandler.ServeItem)
	mux.HandleFunc("/api/products/", productHandler.ServeItem)

	mux.HandleFunc("/api/purchases", purchaseHandler.ServeCollection)
	mux.HandleFunc("/api/purchases/{id}", purchaseHandler.ServeItem)
	mux.HandleFunc("/api/purchases/", purchaseHandler.ServeItem)

	// Explicit JSON Backup Importer into SQLite
	mux.Handle("/api/import/backup", importHandler)
}
