package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/config"
	"github.com/sahand363/gileh-kord/backend/internal/database"
	"github.com/sahand363/gileh-kord/backend/internal/handlers"
	"github.com/sahand363/gileh-kord/backend/internal/middleware"
)

func main() {
	startTime := time.Now()
	log.Println("[BOOT] Starting GILEH KORD backend server...")

	cfg, err := config.Load(".env")
	if err != nil {
		log.Fatalf("[FATAL] Invalid server configuration: %v", err)
	}

	log.Printf("[BOOT] Opening SQLite database at %s...", cfg.DatabasePath)
	db, err := database.Open(cfg.DatabasePath, cfg.BusyTimeoutMs)
	if err != nil {
		log.Fatalf("[FATAL] Failed to initialize SQLite database: %v", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("[ERROR] Closing SQLite database: %v", err)
		}
	}()

	migrator := database.NewMigrator(db, cfg.MigrationsPath)
	ctxMigrate, cancelMigrate := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelMigrate()

	log.Printf("[BOOT] Running SQLite migrations from %s...", cfg.MigrationsPath)
	if err := migrator.Up(ctxMigrate); err != nil {
		log.Fatalf("[FATAL] Database migrations failed: %v", err)
	}
	log.Println("[BOOT] Database migrations verified.")

	mux := http.NewServeMux()
	mux.Handle("/api/health", handlers.NewHealthHandler(db, cfg, startTime))

	handlerChain := middleware.Recovery(
		middleware.RequestLogger(
			middleware.CORS(cfg.AllowedOrigins)(mux),
		),
	)

	server := &http.Server{
		Addr:         cfg.Address(),
		Handler:      handlerChain,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	shutdownComplete := make(chan struct{})
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		sig := <-sigChan
		log.Printf("[SHUTDOWN] Signal %v received. Shutting down gracefully...", sig)

		ctxShutdown, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelShutdown()

		if err := server.Shutdown(ctxShutdown); err != nil {
			log.Printf("[ERROR] Graceful shutdown error: %v", err)
		}
		close(shutdownComplete)
	}()

	if cfg.IsTLSEnabled() {
		log.Printf("[SERVER] Listening on https://%s (TLS enabled, Currency: %s, Timezone: %s)",
			cfg.Address(), cfg.ReportingCurrency, cfg.Timezone)
		err = server.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile)
	} else {
		log.Printf("[SERVER] Listening on http://%s (Plain HTTP mode for IP/LAN compatibility; note: traffic is unencrypted unless behind an HTTPS proxy. Currency: %s, Timezone: %s)",
			cfg.Address(), cfg.ReportingCurrency, cfg.Timezone)
		err = server.ListenAndServe()
	}

	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("[FATAL] HTTP server terminated unexpectedly: %v", err)
	}

	<-shutdownComplete
	log.Println("[SHUTDOWN] Server stopped cleanly.")
}
