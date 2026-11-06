package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Migrator struct {
	db             *DB
	migrationsPath string
}

func NewMigrator(db *DB, migrationsPath string) *Migrator {
	return &Migrator{
		db:             db,
		migrationsPath: migrationsPath,
	}
}

func (m *Migrator) Up(ctx context.Context) error {
	if err := m.ensureMigrationTable(ctx); err != nil {
		return err
	}

	applied, err := m.getAppliedMigrations(ctx)
	if err != nil {
		return err
	}

	entries, err := os.ReadDir(m.migrationsPath)
	if err != nil {
		return fmt.Errorf("reading migrations directory %q: %w", m.migrationsPath, err)
	}

	var migrationFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".up.sql") {
			migrationFiles = append(migrationFiles, entry.Name())
		}
	}
	sort.Strings(migrationFiles)

	for _, file := range migrationFiles {
		version := strings.Split(file, "_")[0]
		if applied[version] {
			continue
		}

		fullPath := filepath.Join(m.migrationsPath, file)
		content, err := os.ReadFile(fullPath)
		if err != nil {
			return fmt.Errorf("reading migration file %q: %w", fullPath, err)
		}

		if err := m.applyMigration(ctx, version, file, string(content)); err != nil {
			return fmt.Errorf("executing migration %s (%s): %w", version, file, err)
		}
	}

	return nil
}

func (m *Migrator) ensureMigrationTable(ctx context.Context) error {
	query := `
	CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	);`
	_, err := m.db.ExecContext(ctx, query)
	if err != nil {
		return fmt.Errorf("creating schema_migrations table: %w", err)
	}
	return nil
}

func (m *Migrator) getAppliedMigrations(ctx context.Context) (map[string]bool, error) {
	rows, err := m.db.QueryContext(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return nil, fmt.Errorf("querying applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]bool)
	for rows.Next() {
		var ver string
		if err := rows.Scan(&ver); err != nil {
			return nil, err
		}
		applied[ver] = true
	}
	return applied, rows.Err()
}

func (m *Migrator) applyMigration(ctx context.Context, version, name, sqlQuery string) error {
	return m.db.WithTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, sqlQuery); err != nil {
			return err
		}

		recordQuery := `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`
		now := time.Now().UTC().Format(time.RFC3339)
		if _, err := tx.ExecContext(ctx, recordQuery, version, name, now); err != nil {
			return err
		}
		return nil
	})
}
