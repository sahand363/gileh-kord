package repositories

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/currency"
	"github.com/sahand363/gileh-kord/backend/internal/database"
	"github.com/sahand363/gileh-kord/backend/internal/models"
	"github.com/sahand363/gileh-kord/backend/internal/utils"
)

var (
	ErrPurchaseNotFound = errors.New("purchase not found")
)

type PurchaseRepository struct {
	db *database.DB
}

func NewPurchaseRepository(db *database.DB) *PurchaseRepository {
	return &PurchaseRepository{db: db}
}

func (r *PurchaseRepository) List(ctx context.Context, filter models.PurchaseFilter, repCurrency currency.Currency) (*models.PurchaseListResult, error) {
	if filter.Page <= 0 {
		filter.Page = 1
	}
	if filter.PageSize <= 0 || filter.PageSize > 500 {
		filter.PageSize = 50
	}
	if repCurrency == "" {
		repCurrency = currency.Toman
	}

	var conditions []string
	var args []any

	if filter.OnlyReal {
		conditions = append(conditions, "is_demo = 0")
	}

	if cleanProdID := strings.TrimSpace(filter.ProductID); cleanProdID != "" {
		conditions = append(conditions, "product_id = ?")
		args = append(args, cleanProdID)
	}

	if cleanQuery := utils.CleanText(filter.Query); cleanQuery != "" {
		pattern := "%" + strings.ToLower(cleanQuery) + "%"
		conditions = append(conditions, "(LOWER(product_name) LIKE ? OR LOWER(supplier_name) LIKE ? OR LOWER(invoice_number) LIKE ?)")
		args = append(args, pattern, pattern, pattern)
	}

	if cleanSupplier := utils.CleanText(filter.SupplierName); cleanSupplier != "" {
		pattern := "%" + strings.ToLower(cleanSupplier) + "%"
		conditions = append(conditions, "LOWER(supplier_name) LIKE ?")
		args = append(args, pattern)
	}

	empFilter := strings.TrimSpace(filter.EmployeeID)
	if empFilter == "__unassigned__" {
		conditions = append(conditions, "(employee_id IS NULL OR employee_id = '')")
	} else if empFilter != "" {
		conditions = append(conditions, "employee_id = ?")
		args = append(args, empFilter)
	}

	if filter.DateFrom != "" {
		if normFrom, ok := utils.NormalizeISODate(filter.DateFrom); ok {
			conditions = append(conditions, "purchase_date >= ?")
			args = append(args, normFrom)
		}
	}

	if filter.DateTo != "" {
		if normTo, ok := utils.NormalizeISODate(filter.DateTo); ok {
			conditions = append(conditions, "purchase_date <= ?")
			args = append(args, normTo)
		}
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	summarySQL := fmt.Sprintf(`
		SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
		FROM purchases
		%s
	`, whereClause)

	var totalCount int64
	var totalAmountToman int64
	if err := r.db.QueryRowContext(ctx, summarySQL, args...).Scan(&totalCount, &totalAmountToman); err != nil {
		return nil, fmt.Errorf("computing purchase summary: %w", err)
	}

	offset := (filter.Page - 1) * filter.PageSize
	listSQL := fmt.Sprintf(`
		SELECT id, product_id, product_name, quantity, unit, total_amount, currency,
		       purchase_date, COALESCE(employee_id, ''), employee_name_snapshot,
		       COALESCE(supplier_id, ''), supplier_name, invoice_number, notes,
		       is_demo, created_at, updated_at
		FROM purchases
		%s
		ORDER BY purchase_date DESC, created_at DESC, id DESC
		LIMIT ? OFFSET ?
	`, whereClause)

	listArgs := append(append([]any{}, args...), filter.PageSize, offset)
	rows, err := r.db.QueryContext(ctx, listSQL, listArgs...)
	if err != nil {
		return nil, fmt.Errorf("querying purchases list: %w", err)
	}
	defer rows.Close()

	items := make([]models.Purchase, 0)
	for rows.Next() {
		item, err := scanPurchase(rows, repCurrency)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var avgToman int64
	if totalCount > 0 {
		avgToman = int64(math.Round(float64(totalAmountToman) / float64(totalCount)))
	}

	repTotal, err := currency.ConvertForDisplay(totalAmountToman, repCurrency)
	if err != nil {
		repTotal = totalAmountToman
	}

	totalPages := int((totalCount + int64(filter.PageSize) - 1) / int64(filter.PageSize))
	if totalPages == 0 {
		totalPages = 1
	}

	return &models.PurchaseListResult{
		Items:                items,
		TotalCount:           totalCount,
		TotalAmountToman:     totalAmountToman,
		AverageAmountToman:   avgToman,
		ReportingTotalAmount: repTotal,
		ReportingCurrency:    repCurrency,
		ReportingLabel:       currency.LabelPersian(repCurrency),
		Page:                 filter.Page,
		PageSize:             filter.PageSize,
		TotalPages:           totalPages,
	}, nil
}

func (r *PurchaseRepository) GetByID(ctx context.Context, id string, repCurrency currency.Currency) (*models.Purchase, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, product_id, product_name, quantity, unit, total_amount, currency,
		       purchase_date, COALESCE(employee_id, ''), employee_name_snapshot,
		       COALESCE(supplier_id, ''), supplier_name, invoice_number, notes,
		       is_demo, created_at, updated_at
		FROM purchases
		WHERE id = ?
	`, strings.TrimSpace(id))

	item, err := scanPurchase(row, repCurrency)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPurchaseNotFound
		}
		return nil, fmt.Errorf("getting purchase by id: %w", err)
	}
	return &item, nil
}

// CreateWithProduct atomically creates a purchase and creates or updates the associated product
// inside a single SQLite transaction.
func (r *PurchaseRepository) CreateWithProduct(
	ctx context.Context,
	input models.CreatePurchaseInput,
	repCurrency currency.Currency,
) (*models.Purchase, *models.Product, error) {
	cleanName := utils.CleanText(input.ProductName)
	if cleanName == "" {
		return nil, nil, errors.New("لطفاً نام محصول را وارد کنید")
	}

	if !utils.ValidateQuantity(input.Quantity) {
		return nil, nil, errors.New("مقدار باید عددی بزرگ‌تر از صفر باشد")
	}

	amount := input.TotalAmount
	if amount == 0 && input.Price > 0 {
		amount = input.Price
	}
	if err := currency.ValidateToman(amount, false); err != nil {
		return nil, nil, errors.New("مبلغ خرید باید عددی صحیح و بزرگ‌تر از صفر (به تومان) باشد")
	}

	purchaseDate, ok := utils.NormalizeISODate(input.PurchaseDate)
	if !ok {
		return nil, nil, errors.New("لطفاً تاریخ خرید معتبری (YYYY-MM-DD) مشخص کنید")
	}

	unit := utils.CleanText(input.Unit)
	if unit == "" {
		unit = "کیلوگرم"
	}

	supplierName := utils.CleanText(input.SupplierName)
	if supplierName == "" {
		supplierName = utils.CleanText(input.Supplier)
	}

	invoiceNum := utils.CleanText(input.InvoiceNumber)
	if invoiceNum == "" {
		invoiceNum = utils.CleanText(input.Invoice)
	}

	notes := utils.CleanText(input.Notes)
	empID := strings.TrimSpace(input.EmployeeID)
	empSnapshot := utils.CleanText(input.EmployeeNameSnapshot)
	supID := strings.TrimSpace(input.SupplierID)

	purchID := strings.TrimSpace(input.ID)
	if purchID == "" {
		purchID = utils.GenerateID("purch")
	}

	normName := utils.NormalizeProductKey(cleanName)
	now := time.Now().UTC().Format(time.RFC3339)
	isDemoInt := 0
	if input.IsDemo {
		isDemoInt = 1
	}

	var finalProductID string

	err := r.db.WithTx(ctx, func(tx *sql.Tx) error {
		// 1. Find or create the product inside the same transaction
		var existingProd models.Product
		var prodDemoInt int
		err := tx.QueryRowContext(ctx, `
			SELECT id, name, normalized_name, category, last_unit, last_price, last_purchase_date,
			       total_purchases_count, is_demo, created_at, updated_at
			FROM products
			WHERE normalized_name = ?
		`, normName).Scan(
			&existingProd.ID,
			&existingProd.Name,
			&existingProd.NormalizedName,
			&existingProd.Category,
			&existingProd.LastUnit,
			&existingProd.LastPrice,
			&existingProd.LastPurchaseDate,
			&existingProd.TotalPurchasesCount,
			&prodDemoInt,
			&existingProd.CreatedAt,
			&existingProd.UpdatedAt,
		)

		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("looking up product in transaction: %w", err)
		}

		if errors.Is(err, sql.ErrNoRows) {
			finalProductID = strings.TrimSpace(input.ProductID)
			if finalProductID == "" {
				finalProductID = utils.GenerateID("prod")
			}

			_, err = tx.ExecContext(ctx, `
				INSERT INTO products (
					id, name, normalized_name, category, last_unit, last_price,
					last_purchase_date, total_purchases_count, is_demo, created_at, updated_at
				) VALUES (?, ?, ?, 'عمومی', ?, ?, ?, 1, ?, ?, ?)
			`, finalProductID, cleanName, normName, unit, amount, purchaseDate, isDemoInt, now, now)
			if err != nil {
				return fmt.Errorf("creating product in purchase transaction: %w", err)
			}
		} else {
			finalProductID = existingProd.ID
			cleanName = existingProd.Name

			// Only overwrite lastUnit / lastPrice if this purchase is on or after the latest recorded date
			newUnit := existingProd.LastUnit
			newPrice := existingProd.LastPrice
			newDate := existingProd.LastPurchaseDate
			if purchaseDate >= existingProd.LastPurchaseDate {
				newUnit = unit
				newPrice = amount
				newDate = purchaseDate
			}

			_, err = tx.ExecContext(ctx, `
				UPDATE products
				SET last_unit = ?, last_price = ?, last_purchase_date = ?,
				    total_purchases_count = total_purchases_count + 1,
				    is_demo = CASE WHEN is_demo = 1 AND ? = 0 THEN 0 ELSE is_demo END,
				    updated_at = ?
				WHERE id = ?
			`, newUnit, newPrice, newDate, isDemoInt, now, finalProductID)
			if err != nil {
				return fmt.Errorf("updating product history in purchase transaction: %w", err)
			}
		}

		// Resolve optional employee_id and supplier_id foreign keys safely
		var empIDPtr *string
		if empID != "" {
			var exists int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM employees WHERE id = ?", empID).Scan(&exists); err == nil && exists > 0 {
				empIDPtr = &empID
			}
		}

		var supIDPtr *string
		if supID != "" {
			var exists int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM suppliers WHERE id = ?", supID).Scan(&exists); err == nil && exists > 0 {
				supIDPtr = &supID
			}
		}

		_, err = tx.ExecContext(ctx, `
			INSERT INTO purchases (
				id, product_id, product_name, quantity, unit, total_amount, currency,
				purchase_date, employee_id, employee_name_snapshot, supplier_id, supplier_name,
				invoice_number, notes, is_demo, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, 'IRT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			purchID, finalProductID, cleanName, input.Quantity, unit, amount,
			purchaseDate, empIDPtr, empSnapshot, supIDPtr, supplierName,
			invoiceNum, notes, isDemoInt, now, now,
		)
		if err != nil {
			return fmt.Errorf("inserting purchase record: %w", err)
		}

		return nil
	})
	if err != nil {
		return nil, nil, err
	}

	createdPurchase, err := r.GetByID(ctx, purchID, repCurrency)
	if err != nil {
		return nil, nil, err
	}

	prodRepo := NewProductRepository(r.db)
	updatedProduct, err := prodRepo.GetByID(ctx, finalProductID)
	if err != nil {
		return createdPurchase, nil, nil
	}
	updatedProduct.ApplyReportingCurrency(repCurrency)

	return createdPurchase, updatedProduct, nil
}

// UpdateWithProduct updates an existing purchase and reconciles the associated product record atomically.
func (r *PurchaseRepository) UpdateWithProduct(
	ctx context.Context,
	id string,
	input models.UpdatePurchaseInput,
	repCurrency currency.Currency,
) (*models.Purchase, error) {
	existing, err := r.GetByID(ctx, id, repCurrency)
	if err != nil {
		return nil, err
	}

	cleanName := utils.CleanText(input.ProductName)
	if cleanName == "" {
		cleanName = existing.ProductName
	}

	quantity := input.Quantity
	if quantity == 0 {
		quantity = existing.Quantity
	}
	if !utils.ValidateQuantity(quantity) {
		return nil, errors.New("مقدار باید عددی بزرگ‌تر از صفر باشد")
	}

	amount := input.TotalAmount
	if amount == 0 && input.Price > 0 {
		amount = input.Price
	}
	if amount == 0 {
		amount = existing.TotalAmount
	}
	if err := currency.ValidateToman(amount, false); err != nil {
		return nil, errors.New("مبلغ خرید باید عددی صحیح و بزرگ‌تر از صفر باشد")
	}

	purchaseDate := existing.PurchaseDate
	if strings.TrimSpace(input.PurchaseDate) != "" {
		normDate, ok := utils.NormalizeISODate(input.PurchaseDate)
		if !ok {
			return nil, errors.New("تاریخ خرید نامعتبر است")
		}
		purchaseDate = normDate
	}

	unit := utils.CleanText(input.Unit)
	if unit == "" {
		unit = existing.Unit
	}

	supplierName := utils.CleanText(input.SupplierName)
	if supplierName == "" && input.Supplier != "" {
		supplierName = utils.CleanText(input.Supplier)
	}

	invoiceNum := utils.CleanText(input.InvoiceNumber)
	if invoiceNum == "" && input.Invoice != "" {
		invoiceNum = utils.CleanText(input.Invoice)
	}

	notes := utils.CleanText(input.Notes)
	empID := strings.TrimSpace(input.EmployeeID)
	empSnapshot := utils.CleanText(input.EmployeeNameSnapshot)
	normName := utils.NormalizeProductKey(cleanName)
	now := time.Now().UTC().Format(time.RFC3339)

	err = r.db.WithTx(ctx, func(tx *sql.Tx) error {
		var targetProductID string
		var lastPurchaseDate string
		err := tx.QueryRowContext(ctx, `
			SELECT id, last_purchase_date FROM products WHERE normalized_name = ?
		`, normName).Scan(&targetProductID, &lastPurchaseDate)

		if errors.Is(err, sql.ErrNoRows) {
			targetProductID = utils.GenerateID("prod")
			_, err = tx.ExecContext(ctx, `
				INSERT INTO products (
					id, name, normalized_name, category, last_unit, last_price,
					last_purchase_date, total_purchases_count, is_demo, created_at, updated_at
				) VALUES (?, ?, ?, 'عمومی', ?, ?, ?, 1, 0, ?, ?)
			`, targetProductID, cleanName, normName, unit, amount, purchaseDate, now, now)
			if err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else {
			if purchaseDate >= lastPurchaseDate {
				_, err = tx.ExecContext(ctx, `
					UPDATE products
					SET last_unit = ?, last_price = ?, last_purchase_date = ?, is_demo = 0, updated_at = ?
					WHERE id = ?
				`, unit, amount, purchaseDate, now, targetProductID)
				if err != nil {
					return err
				}
			}
		}

		var empIDPtr *string
		if empID != "" {
			var exists int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM employees WHERE id = ?", empID).Scan(&exists); err == nil && exists > 0 {
				empIDPtr = &empID
			}
		}

		_, err = tx.ExecContext(ctx, `
			UPDATE purchases
			SET product_id = ?, product_name = ?, quantity = ?, unit = ?, total_amount = ?,
			    purchase_date = ?, employee_id = ?, employee_name_snapshot = ?,
			    supplier_name = ?, invoice_number = ?, notes = ?, is_demo = 0, updated_at = ?
			WHERE id = ?
		`,
			targetProductID, cleanName, quantity, unit, amount,
			purchaseDate, empIDPtr, empSnapshot,
			supplierName, invoiceNum, notes, now, id,
		)
		return err
	})
	if err != nil {
		return nil, err
	}

	return r.GetByID(ctx, id, repCurrency)
}

func (r *PurchaseRepository) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, "DELETE FROM purchases WHERE id = ?", strings.TrimSpace(id))
	if err != nil {
		return fmt.Errorf("deleting purchase: %w", err)
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrPurchaseNotFound
	}
	return nil
}

func scanPurchase(scanner rowScanner, repCurrency currency.Currency) (models.Purchase, error) {
	var p models.Purchase
	var isDemoInt int
	err := scanner.Scan(
		&p.ID,
		&p.ProductID,
		&p.ProductName,
		&p.Quantity,
		&p.Unit,
		&p.TotalAmount,
		&p.Currency,
		&p.PurchaseDate,
		&p.EmployeeID,
		&p.EmployeeNameSnapshot,
		&p.SupplierID,
		&p.SupplierName,
		&p.InvoiceNumber,
		&p.Notes,
		&isDemoInt,
		&p.CreatedAt,
		&p.UpdatedAt,
	)
	if err != nil {
		return models.Purchase{}, err
	}
	p.IsDemo = isDemoInt == 1
	p.ApplyReportingCurrency(repCurrency)
	return p, nil
}
