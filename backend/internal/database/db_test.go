package database

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestOpenAndMigrations(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_gileh_kord.db")

	db, err := Open(dbPath, 5000)
	if err != nil {
		t.Fatalf("failed to open test sqlite db: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	migrator := NewMigrator(db, "../../migrations")
	if err := migrator.Up(ctx); err != nil {
		t.Fatalf("failed to apply migrations: %v", err)
	}

	// Running Up() a second time must be idempotent and preserve existing data
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = db.ExecContext(ctx, `
		INSERT INTO products (id, name, normalized_name, last_unit, last_price, last_purchase_date, total_purchases_count, created_at, updated_at)
		VALUES ('prod_1', 'برنج هاشمی', 'برنج هاشمی', 'کیلوگرم', 4250000, '2026-11-03', 1, ?, ?)
	`, now, now)
	if err != nil {
		t.Fatalf("failed to insert product: %v", err)
	}

	if err := migrator.Up(ctx); err != nil {
		t.Fatalf("second migration run failed: %v", err)
	}

	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM products WHERE id = 'prod_1'").Scan(&count); err != nil {
		t.Fatalf("failed querying product after second migration: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected existing product to be preserved, got count=%d", count)
	}
}

func TestTransactionRollbackOnFailure(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_rollback.db")

	db, err := Open(dbPath, 5000)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	migrator := NewMigrator(db, "../../migrations")
	if err := migrator.Up(ctx); err != nil {
		t.Fatalf("migrations failed: %v", err)
	}

	simulatedErr := errors.New("simulated mid-transaction failure")
	now := time.Now().UTC().Format(time.RFC3339)

	err = db.WithTx(ctx, func(tx *sql.Tx) error {
		_, execErr := tx.ExecContext(ctx, `
			INSERT INTO products (id, name, normalized_name, last_unit, last_price, last_purchase_date, total_purchases_count, created_at, updated_at)
			VALUES ('prod_rollback', 'زعفران', 'زعفران', 'گرم', 8500000, '2026-11-03', 1, ?, ?)
		`, now, now)
		if execErr != nil {
			return execErr
		}
		return simulatedErr
	})

	if !errors.Is(err, simulatedErr) {
		t.Fatalf("expected simulatedErr, got: %v", err)
	}

	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM products WHERE id = 'prod_rollback'").Scan(&count); err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected rolled-back product count to be 0, got %d", count)
	}
}

func TestForeignKeyEnforcement(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_fk.db")

	db, err := Open(dbPath, 5000)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	migrator := NewMigrator(db, "../../migrations")
	if err := migrator.Up(ctx); err != nil {
		t.Fatalf("migrations failed: %v", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	// Inserting a purchase referencing a non-existent product_id must fail due to FOREIGN KEY enforcement
	_, err = db.ExecContext(ctx, `
		INSERT INTO purchases (id, product_id, product_name, quantity, unit, total_amount, purchase_date, created_at, updated_at)
		VALUES ('purch_1', 'non_existent_prod', 'کالای ناموجود', 5, 'کیلوگرم', 500000, '2026-11-03', ?, ?)
	`, now, now)
	if err == nil {
		t.Fatalf("expected foreign key constraint error when inserting purchase with invalid product_id, got nil")
	}
}
