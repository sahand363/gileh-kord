package handlers

import (
	"net/http"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/config"
	"github.com/sahand363/gileh-kord/backend/internal/database"
	"github.com/sahand363/gileh-kord/backend/internal/repositories"
)

// RouteGuard wraps protected handlers with server-side authentication middleware.
type RouteGuard func(http.Handler) http.Handler

func RegisterRoutes(
	mux *http.ServeMux,
	db *database.DB,
	cfg *config.Config,
	startTime time.Time,
	guards ...RouteGuard,
) {
	wrap := func(h http.Handler) http.Handler {
		for _, g := range guards {
			if g != nil {
				h = g(h)
			}
		}
		return h
	}

	productRepo := repositories.NewProductRepository(db)
	purchaseRepo := repositories.NewPurchaseRepository(db)

	healthHandler := NewHealthHandler(db, cfg, startTime)
	productHandler := NewProductHandler(productRepo, cfg)
	purchaseHandler := NewPurchaseHandler(purchaseRepo, cfg)
	importHandler := NewImportHandler(db)

	mux.Handle("/api/health", healthHandler)

	mux.Handle("/api/products", wrap(http.HandlerFunc(productHandler.ServeCollection)))
	mux.Handle("/api/products/{id}", wrap(http.HandlerFunc(productHandler.ServeItem)))
	mux.Handle("/api/products/", wrap(http.HandlerFunc(productHandler.ServeItem)))

	mux.Handle("/api/purchases", wrap(http.HandlerFunc(purchaseHandler.ServeCollection)))
	mux.Handle("/api/purchases/{id}", wrap(http.HandlerFunc(purchaseHandler.ServeItem)))
	mux.Handle("/api/purchases/", wrap(http.HandlerFunc(purchaseHandler.ServeItem)))

	mux.Handle("/api/import/backup", wrap(importHandler))
}
