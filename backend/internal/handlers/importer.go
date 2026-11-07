package handlers

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/currency"
	"github.com/sahand363/gileh-kord/backend/internal/database"
	"github.com/sahand363/gileh-kord/backend/internal/models"
	"github.com/sahand363/gileh-kord/backend/internal/utils"
)

type BackupImportPayload struct {
	Version    int                          `json:"version"`
	ExportedAt string                       `json:"exportedAt"`
	Products   []models.CreateProductInput  `json:"products"`
	Purchases  []models.CreatePurchaseInput `json:"purchases"`
	Suppliers  []struct {
		ID                   string `json:"id"`
		Name                 string `json:"name"`
		Category             string `json:"category"`
		Phone                string `json:"phone"`
		City                 string `json:"city"`
		Notes                string `json:"notes"`
		LastPurchaseDate     string `json:"lastPurchaseDate"`
		TotalPurchasesAmount int64  `json:"totalPurchasesAmount"`
		PurchasesCount       int64  `json:"purchasesCount"`
		IsDemo               bool   `json:"isDemo"`
	} `json:"suppliers"`
	Employees []struct {
		ID                     string  `json:"id"`
		Name                   string  `json:"name"`
		Role                   string  `json:"role"`
		Phone                  string  `json:"phone"`
		Notes                  string  `json:"notes"`
		IsActive               bool    `json:"isActive"`
		PerformanceCoefficient float64 `json:"performanceCoefficient"`
		IsDemo                 bool    `json:"isDemo"`
	} `json:"employees"`
}

type ImportHandler struct {
	db *database.DB
}

func NewImportHandler(db *database.DB) *ImportHandler {
	return &ImportHandler{db: db}
}

func (h *ImportHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		Error(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload BackupImportPayload
	if err := DecodeJSON(r, &payload); err != nil {
		Error(w, http.StatusBadRequest, err.Error())
		return
	}

	if payload.Version < 1 || payload.Version > 3 {
		Error(w, http.StatusBadRequest, "نسخه فایل پشتیبان پشتیبانی نمی‌شود (نسخه‌های مجاز: ۱ تا ۳)")
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	var importedProducts, importedSuppliers, importedEmployees, importedPurchases int

	err := h.db.WithTx(r.Context(), func(tx *sql.Tx) error {
		// 1. Upsert Employees
		for _, emp := range payload.Employees {
			cleanName := utils.CleanText(emp.Name)
			if cleanName == "" {
				continue
			}
			id := strings.TrimSpace(emp.ID)
			if id == "" {
				id = utils.GenerateID("emp")
			}
			role := utils.CleanText(emp.Role)
			if role == "" {
				role = "کارمند"
			}
			coeff := emp.PerformanceCoefficient
			if coeff <= 0 || coeff > 10 {
				coeff = 1.0
			}
			activeInt := 1
			if !emp.IsActive {
				activeInt = 0
			}
			demoInt := 0
			if emp.IsDemo {
				demoInt = 1
			}

			_, err := tx.ExecContext(r.Context(), `
				INSERT INTO employees (id, name, role, phone, notes, is_active, performance_coefficient, is_demo, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					name = excluded.name,
					role = excluded.role,
					phone = excluded.phone,
					notes = excluded.notes,
					is_active = excluded.is_active,
					performance_coefficient = excluded.performance_coefficient,
					updated_at = excluded.updated_at
			`, id, cleanName, role, utils.CleanText(emp.Phone), utils.CleanText(emp.Notes), activeInt, coeff, demoInt, now, now)
			if err != nil {
				return err
			}
			importedEmployees++
		}

		// 2. Upsert Suppliers
		for _, sup := range payload.Suppliers {
			cleanName := utils.CleanText(sup.Name)
			if cleanName == "" {
				continue
			}
			id := strings.TrimSpace(sup.ID)
			if id == "" {
				id = utils.GenerateID("sup")
			}
			demoInt := 0
			if sup.IsDemo {
				demoInt = 1
			}
			amount := sup.TotalPurchasesAmount
			if amount < 0 {
				amount = 0
			}

			_, err := tx.ExecContext(r.Context(), `
				INSERT INTO suppliers (id, name, category, phone, city, notes, total_purchases_amount, purchases_count, last_purchase_date, is_demo, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					name = excluded.name,
					category = excluded.category,
					phone = excluded.phone,
					city = excluded.city,
					total_purchases_amount = excluded.total_purchases_amount,
					purchases_count = excluded.purchases_count,
					updated_at = excluded.updated_at
			`, id, cleanName, utils.CleanText(sup.Category), utils.CleanText(sup.Phone), utils.CleanText(sup.City),
				utils.CleanText(sup.Notes), amount, sup.PurchasesCount, strings.TrimSpace(sup.LastPurchaseDate), demoInt, now, now)
			if err != nil {
				return err
			}
			importedSuppliers++
		}

		// 3. Upsert Products
		productIDByNormName := make(map[string]string)
		for _, prod := range payload.Products {
			cleanName := utils.CleanText(prod.Name)
			if cleanName == "" {
				continue
			}
			normName := utils.NormalizeProductKey(cleanName)
			id := strings.TrimSpace(prod.ID)
			if id == "" {
				id = utils.GenerateID("prod")
			}
			unit := utils.CleanText(prod.LastUnit)
			if unit == "" {
				unit = "کیلوگرم"
			}
			price := prod.LastPrice
			if err := currency.ValidateToman(price, true); err != nil {
				price = 0
			}
			demoInt := 0
			if prod.IsDemo {
				demoInt = 1
			}

			var storedID string
			err := tx.QueryRowContext(r.Context(), `
				INSERT INTO products (id, name, normalized_name, category, last_unit, last_price, last_purchase_date, total_purchases_count, is_demo, created_at, updated_at)
				VALUES (?, ?, ?, 'عمومی', ?, ?, ?, 0, ?, ?, ?)
				ON CONFLICT(normalized_name) DO UPDATE SET
					last_unit = excluded.last_unit,
					last_price = CASE WHEN excluded.last_purchase_date >= products.last_purchase_date THEN excluded.last_price ELSE products.last_price END,
					last_purchase_date = CASE WHEN excluded.last_purchase_date >= products.last_purchase_date THEN excluded.last_purchase_date ELSE products.last_purchase_date END,
					updated_at = excluded.updated_at
				RETURNING id
			`, id, cleanName, normName, unit, price, strings.TrimSpace(prod.LastPurchaseDate), demoInt, now, now).Scan(&storedID)
			if err != nil {
				return err
			}
			productIDByNormName[normName] = storedID
			importedProducts++
		}

		// 4. Upsert Purchases
		for _, purch := range payload.Purchases {
			cleanName := utils.CleanText(purch.ProductName)
			if cleanName == "" || !utils.ValidateQuantity(purch.Quantity) {
				continue
			}
			amount := purch.TotalAmount
			if amount == 0 && purch.Price > 0 {
				amount = purch.Price
			}
			if err := currency.ValidateToman(amount, false); err != nil {
				continue
			}
			purchDate, ok := utils.NormalizeISODate(purch.PurchaseDate)
			if !ok {
				continue
			}

			normName := utils.NormalizeProductKey(cleanName)
			prodID, exists := productIDByNormName[normName]
			if !exists {
				prodID = utils.GenerateID("prod")
				unit := utils.CleanText(purch.Unit)
				if unit == "" {
					unit = "کیلوگرم"
				}
				err := tx.QueryRowContext(r.Context(), `
					INSERT INTO products (id, name, normalized_name, category, last_unit, last_price, last_purchase_date, total_purchases_count, is_demo, created_at, updated_at)
					VALUES (?, ?, ?, 'عمومی', ?, ?, ?, 1, 0, ?, ?)
					ON CONFLICT(normalized_name) DO UPDATE SET
						total_purchases_count = products.total_purchases_count + 1,
						updated_at = excluded.updated_at
					RETURNING id
				`, prodID, cleanName, normName, unit, amount, purchDate, now, now).Scan(&prodID)
				if err != nil {
					return err
				}
				productIDByNormName[normName] = prodID
			}

			id := strings.TrimSpace(purch.ID)
			if id == "" {
				id = utils.GenerateID("purch")
			}
			unit := utils.CleanText(purch.Unit)
			if unit == "" {
				unit = "کیلوگرم"
			}
			demoInt := 0
			if purch.IsDemo {
				demoInt = 1
			}

			var empIDPtr *string
			if trimmedEmp := strings.TrimSpace(purch.EmployeeID); trimmedEmp != "" {
				var count int
				if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM employees WHERE id = ?", trimmedEmp).Scan(&count); err == nil && count > 0 {
					empIDPtr = &trimmedEmp
				}
			}

			_, err := tx.ExecContext(r.Context(), `
				INSERT INTO purchases (
					id, product_id, product_name, quantity, unit, total_amount, currency,
					purchase_date, employee_id, employee_name_snapshot, supplier_name,
					invoice_number, notes, is_demo, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, 'IRT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					product_id = excluded.product_id,
					product_name = excluded.product_name,
					quantity = excluded.quantity,
					unit = excluded.unit,
					total_amount = excluded.total_amount,
					purchase_date = excluded.purchase_date,
					employee_id = excluded.employee_id,
					employee_name_snapshot = excluded.employee_name_snapshot,
					supplier_name = excluded.supplier_name,
					invoice_number = excluded.invoice_number,
					notes = excluded.notes,
					updated_at = excluded.updated_at
			`, id, prodID, cleanName, purch.Quantity, unit, amount, purchDate,
				empIDPtr, utils.CleanText(purch.EmployeeNameSnapshot), utils.CleanText(purch.SupplierName),
				utils.CleanText(purch.InvoiceNumber), utils.CleanText(purch.Notes), demoInt, now, now)
			if err != nil {
				return err
			}
			importedPurchases++
		}

		// Recompute product purchase counts accurately after import
		_, err := tx.ExecContext(r.Context(), `
			UPDATE products
			SET total_purchases_count = (
				SELECT COUNT(*) FROM purchases WHERE purchases.product_id = products.id
			)
		`)
		return err
	})

	if err != nil {
		Error(w, http.StatusInternalServerError, "خطا در درون‌ریزی فایل پشتیبان در پایگاه داده SQLite", err.Error())
		return
	}

	JSON(w, http.StatusOK, Envelope{
		"imported":          true,
		"importedProducts":  importedProducts,
		"importedSuppliers": importedSuppliers,
		"importedEmployees": importedEmployees,
		"importedPurchases": importedPurchases,
	})
}
