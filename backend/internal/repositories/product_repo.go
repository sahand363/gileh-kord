package repositories

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/currency"
	"github.com/sahand363/gileh-kord/backend/internal/database"
	"github.com/sahand363/gileh-kord/backend/internal/models"
	"github.com/sahand363/gileh-kord/backend/internal/utils"
)

var (
	ErrProductNotFound = errors.New("product not found")
	ErrProductExists   = errors.New("a product with this name already exists")
	ErrProductInUse    = errors.New("product is referenced by existing purchases and cannot be deleted")
)

type ProductRepository struct {
	db *database.DB
}

func NewProductRepository(db *database.DB) *ProductRepository {
	return &ProductRepository{db: db}
}

func (r *ProductRepository) List(ctx context.Context, query string, category string, limit int) ([]models.Product, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}

	var conditions []string
	var args []any

	if cleanQuery := utils.NormalizeProductKey(query); cleanQuery != "" {
		conditions = append(conditions, "(normalized_name LIKE ? OR LOWER(name) LIKE ?)")
		pattern := "%" + cleanQuery + "%"
		args = append(args, pattern, pattern)
	}

	if cleanCat := utils.CleanText(category); cleanCat != "" {
		conditions = append(conditions, "category = ?")
		args = append(args, cleanCat)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	sqlQuery := fmt.Sprintf(`
		SELECT id, name, normalized_name, category, last_unit, last_price, last_purchase_date,
		       total_purchases_count, is_demo, created_at, updated_at
		FROM products
		%s
		ORDER BY last_purchase_date DESC, updated_at DESC, name ASC
		LIMIT ?
	`, whereClause)
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("querying products: %w", err)
	}
	defer rows.Close()

	products := make([]models.Product, 0)
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

func (r *ProductRepository) GetByID(ctx context.Context, id string) (*models.Product, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, name, normalized_name, category, last_unit, last_price, last_purchase_date,
		       total_purchases_count, is_demo, created_at, updated_at
		FROM products
		WHERE id = ?
	`, strings.TrimSpace(id))

	p, err := scanProduct(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrProductNotFound
		}
		return nil, fmt.Errorf("getting product by id: %w", err)
	}
	return &p, nil
}

func (r *ProductRepository) Create(ctx context.Context, input models.CreateProductInput) (*models.Product, error) {
	cleanName := utils.CleanText(input.Name)
	normName := utils.NormalizeProductKey(cleanName)
	if cleanName == "" {
		return nil, errors.New("نام کالا الزامی است")
	}

	if err := currency.ValidateToman(input.LastPrice, true); err != nil {
		return nil, err
	}

	category := utils.CleanText(input.Category)
	if category == "" {
		category = "عمومی"
	}

	lastUnit := utils.CleanText(input.LastUnit)
	if lastUnit == "" {
		lastUnit = "کیلوگرم"
	}

	lastDate := strings.TrimSpace(input.LastPurchaseDate)
	if lastDate != "" {
		if normDate, ok := utils.NormalizeISODate(lastDate); ok {
			lastDate = normDate
		} else {
			return nil, errors.New("تاریخ آخرین خرید نامعتبر است")
		}
	}

	id := strings.TrimSpace(input.ID)
	if id == "" {
		id = utils.GenerateID("prod")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	isDemoInt := 0
	if input.IsDemo {
		isDemoInt = 1
	}

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO products (
			id, name, normalized_name, category, last_unit, last_price, last_purchase_date,
			total_purchases_count, is_demo, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
	`, id, cleanName, normName, category, lastUnit, input.LastPrice, lastDate, isDemoInt, now, now)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, ErrProductExists
		}
		return nil, fmt.Errorf("inserting product: %w", err)
	}

	return r.GetByID(ctx, id)
}

func (r *ProductRepository) Update(ctx context.Context, id string, input models.UpdateProductInput) (*models.Product, error) {
	existing, err := r.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	cleanName := utils.CleanText(input.Name)
	if cleanName == "" {
		cleanName = existing.Name
	}
	normName := utils.NormalizeProductKey(cleanName)

	if err := currency.ValidateToman(input.LastPrice, true); err != nil {
		return nil, err
	}

	category := utils.CleanText(input.Category)
	if category == "" {
		category = existing.Category
	}

	lastUnit := utils.CleanText(input.LastUnit)
	if lastUnit == "" {
		lastUnit = existing.LastUnit
	}

	lastDate := strings.TrimSpace(input.LastPurchaseDate)
	if lastDate == "" {
		lastDate = existing.LastPurchaseDate
	} else if normDate, ok := utils.NormalizeISODate(lastDate); ok {
		lastDate = normDate
	} else {
		return nil, errors.New("فرمت تاریخ نامعتبر است")
	}

	now := time.Now().UTC().Format(time.RFC3339)

	err = r.db.WithTx(ctx, func(tx *sql.Tx) error {
		_, execErr := tx.ExecContext(ctx, `
			UPDATE products
			SET name = ?, normalized_name = ?, category = ?, last_unit = ?, last_price = ?,
			    last_purchase_date = ?, is_demo = 0, updated_at = ?
			WHERE id = ?
		`, cleanName, normName, category, lastUnit, input.LastPrice, lastDate, now, id)
		if execErr != nil {
			if strings.Contains(strings.ToLower(execErr.Error()), "unique") {
				return ErrProductExists
			}
			return execErr
		}

		// Keep denormalized product_name in purchases synchronized if the product was renamed
		if cleanName != existing.Name {
			if _, syncErr := tx.ExecContext(ctx, `
				UPDATE purchases SET product_name = ?, updated_at = ? WHERE product_id = ?
			`, cleanName, now, id); syncErr != nil {
				return syncErr
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return r.GetByID(ctx, id)
}

func (r *ProductRepository) Delete(ctx context.Context, id string) error {
	var refCount int
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM purchases WHERE product_id = ?", id).Scan(&refCount); err != nil {
		return fmt.Errorf("checking product references: %w", err)
	}
	if refCount > 0 {
		return ErrProductInUse
	}

	res, err := r.db.ExecContext(ctx, "DELETE FROM products WHERE id = ?", id)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "foreign key") {
			return ErrProductInUse
		}
		return fmt.Errorf("deleting product: %w", err)
	}

	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrProductNotFound
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanProduct(scanner rowScanner) (models.Product, error) {
	var p models.Product
	var isDemoInt int
	err := scanner.Scan(
		&p.ID,
		&p.Name,
		&p.NormalizedName,
		&p.Category,
		&p.LastUnit,
		&p.LastPrice,
		&p.LastPurchaseDate,
		&p.TotalPurchasesCount,
		&isDemoInt,
		&p.CreatedAt,
		&p.UpdatedAt,
	)
	if err != nil {
		return models.Product{}, err
	}
	p.IsDemo = isDemoInt == 1
	p.ApplyReportingCurrency(currency.Toman)
	return p, nil
}
