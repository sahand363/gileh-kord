package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type DB struct {
	*sql.DB
}

func Open(dbPath string, busyTimeoutMs int) (*DB, error) {
	if dbPath != ":memory:" && !strings.HasPrefix(dbPath, "file::memory:") {
		dir := filepath.Dir(dbPath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("creating database directory %q: %w", dir, err)
		}
	}

	if busyTimeoutMs <= 0 {
		busyTimeoutMs = 5000
	}

	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(%d)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)",
		dbPath, busyTimeoutMs,
	)

	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening sqlite database: %w", err)
	}

	// Single writer serialization with WAL mode avoids SQLITE_BUSY locking errors
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(0)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("pinging sqlite database: %w", err)
	}

	db := &DB{DB: sqlDB}
	if err := db.enforceAndVerifyPragmas(ctx, busyTimeoutMs); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}

	return db, nil
}

func (db *DB) enforceAndVerifyPragmas(ctx context.Context, busyTimeoutMs int) error {
	pragmas := []string{
		"PRAGMA foreign_keys = ON;",
		"PRAGMA journal_mode = WAL;",
		fmt.Sprintf("PRAGMA busy_timeout = %d;", busyTimeoutMs),
		"PRAGMA synchronous = NORMAL;",
	}
	for _, stmt := range pragmas {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("executing %q: %w", stmt, err)
		}
	}

	var fkEnabled int
	if err := db.QueryRowContext(ctx, "PRAGMA foreign_keys;").Scan(&fkEnabled); err != nil {
		return fmt.Errorf("verifying PRAGMA foreign_keys: %w", err)
	}
	if fkEnabled != 1 {
		return fmt.Errorf("sqlite foreign_keys pragma failed to enable (got %d)", fkEnabled)
	}

	return nil
}

func (db *DB) WithTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning transaction: %w", err)
	}

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(); rbErr != nil {
			return fmt.Errorf("rolling back tx (%v) after error: %w", rbErr, err)
		}
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing transaction: %w", err)
	}
	return nil
}
