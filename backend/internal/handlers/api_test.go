package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/config"
	"github.com/sahand363/gileh-kord/backend/internal/database"
	"github.com/sahand363/gileh-kord/backend/internal/models"
)

func setupTestServer(t *testing.T) (*httptest.Server, *database.DB) {
	t.Helper()
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "api_test.db")

	db, err := database.Open(dbPath, 5000)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	migrator := database.NewMigrator(db, "../../migrations")
	if err := migrator.Up(context.Background()); err != nil {
		db.Close()
		t.Fatalf("failed to run migrations: %v", err)
	}

	cfg, err := config.Load("")
	if err != nil {
		db.Close()
		t.Fatalf("failed to load config: %v", err)
	}

	mux := http.NewServeMux()
	RegisterRoutes(mux, db, cfg, time.Now())

	ts := httptest.NewServer(mux)
	t.Cleanup(func() {
		ts.Close()
		db.Close()
	})

	return ts, db
}

func TestProductCRUD(t *testing.T) {
	ts, _ := setupTestServer(t)

	// 1. Create a Product
	createBody := map[string]any{
		"name":             "برنج هاشمی",
		"category":         "غلات",
		"lastUnit":         "کیلوگرم",
		"lastPrice":        4250000,
		"lastPurchaseDate": "2026-11-03",
	}
	payload, _ := json.Marshal(createBody)
	resp, err := http.Post(ts.URL+"/api/products", "application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("POST /api/products failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d", resp.StatusCode)
	}

	var created models.Product
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode product failed: %v", err)
	}
	if created.ID == "" || created.LastPrice != 4250000 {
		t.Fatalf("unexpected created product: %+v", created)
	}

	// 2. Get Product in RIAL reporting currency (1 Toman = 10 Rial)
	getResp, err := http.Get(ts.URL + "/api/products/" + created.ID + "?currency=RIAL")
	if err != nil {
		t.Fatalf("GET /api/products/{id} failed: %v", err)
	}
	defer getResp.Body.Close()

	var fetched models.Product
	_ = json.NewDecoder(getResp.Body).Decode(&fetched)
	if fetched.LastPrice != 4250000 {
		t.Fatalf("canonical LastPrice must remain 4250000 Toman, got %d", fetched.LastPrice)
	}
	if fetched.ReportingLastPrice != 42500000 {
		t.Fatalf("expected ReportingLastPrice=42500000 Rial, got %d", fetched.ReportingLastPrice)
	}

	// 3. Update Product
	updateBody := map[string]any{
		"name":      "برنج هاشمی درجه یک",
		"category":  "غلات و برنج",
		"lastUnit":  "کیسه",
		"lastPrice": 4500000,
	}
	upBytes, _ := json.Marshal(updateBody)
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/products/"+created.ID, bytes.NewReader(upBytes))
	req.Header.Set("Content-Type", "application/json")
	upResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT /api/products/{id} failed: %v", err)
	}
	defer upResp.Body.Close()
	if upResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on update, got %d", upResp.StatusCode)
	}

	// 4. Delete unused Product
	delReq, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/products/"+created.ID, nil)
	delResp, err := http.DefaultClient.Do(delReq)
	if err != nil {
		t.Fatalf("DELETE /api/products/{id} failed: %v", err)
	}
	defer delResp.Body.Close()
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on delete, got %d", delResp.StatusCode)
	}
}

func TestPurchaseCRUDAndAtomicProductSync(t *testing.T) {
	ts, _ := setupTestServer(t)

	// 1. Create first purchase for "روغن سرخ‌کردنی" -> automatically creates product
	p1Body := map[string]any{
		"productName":   "روغن سرخ‌کردنی",
		"quantity":      12.5,
		"unit":          "لیتر",
		"totalAmount":   1980000,
		"purchaseDate":  "2026-11-03",
		"supplierName":  "پخش بهار",
		"invoiceNumber": "۸۸۱",
	}
	b1, _ := json.Marshal(p1Body)
	resp1, err := http.Post(ts.URL+"/api/purchases", "application/json", bytes.NewReader(b1))
	if err != nil {
		t.Fatalf("POST /api/purchases failed: %v", err)
	}
	defer resp1.Body.Close()
	if resp1.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d", resp1.StatusCode)
	}

	var createRes struct {
		Purchase models.Purchase `json:"purchase"`
		Product  models.Product  `json:"product"`
	}
	_ = json.NewDecoder(resp1.Body).Decode(&createRes)
	if createRes.Product.LastUnit != "لیتر" || createRes.Product.LastPrice != 1980000 || createRes.Product.TotalPurchasesCount != 1 {
		t.Fatalf("unexpected synced product after p1: %+v", createRes.Product)
	}

	// 2. Backdated purchase (2026-10-15) must increment count to 2 WITHOUT overwriting newer lastPrice/lastUnit
	p2Body := map[string]any{
		"productName":  "روغن سرخ‌کردنی",
		"quantity":     5,
		"unit":         "حلب",
		"totalAmount":  900000,
		"purchaseDate": "2026-10-15",
		"supplierName": "پخش بهار",
	}
	b2, _ := json.Marshal(p2Body)
	resp2, _ := http.Post(ts.URL+"/api/purchases", "application/json", bytes.NewReader(b2))
	defer resp2.Body.Close()

	var createRes2 struct {
		Purchase models.Purchase `json:"purchase"`
		Product  models.Product  `json:"product"`
	}
	_ = json.NewDecoder(resp2.Body).Decode(&createRes2)
	if createRes2.Product.TotalPurchasesCount != 2 {
		t.Fatalf("expected count=2, got %d", createRes2.Product.TotalPurchasesCount)
	}
	if createRes2.Product.LastUnit != "لیتر" || createRes2.Product.LastPrice != 1980000 {
		t.Fatalf("backdated purchase overwrote newer product info: %+v", createRes2.Product)
	}

	// 3. Attempting to delete a Product referenced by purchases must return 409 Conflict
	delProdReq, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/products/"+createRes.Product.ID, nil)
	delProdResp, _ := http.DefaultClient.Do(delProdReq)
	defer delProdResp.Body.Close()
	if delProdResp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 Conflict when deleting product in use, got %d", delProdResp.StatusCode)
	}

	// 4. Filter purchases by date range and check RIAL reporting totals
	listResp, err := http.Get(ts.URL + "/api/purchases?date_from=2026-11-01&date_to=2026-11-05&currency=RIAL")
	if err != nil {
		t.Fatalf("GET /api/purchases failed: %v", err)
	}
	defer listResp.Body.Close()

	var listResult models.PurchaseListResult
	_ = json.NewDecoder(listResp.Body).Decode(&listResult)
	if listResult.TotalCount != 1 {
		t.Fatalf("expected 1 filtered purchase in Nov, got %d", listResult.TotalCount)
	}
	if listResult.TotalAmountToman != 1980000 {
		t.Fatalf("expected canonical TotalAmountToman=1980000, got %d", listResult.TotalAmountToman)
	}
	if listResult.ReportingTotalAmount != 19800000 {
		t.Fatalf("expected ReportingTotalAmount=19800000 Rial, got %d", listResult.ReportingTotalAmount)
	}
}

func TestInvalidInputAndMonetaryValidation(t *testing.T) {
	ts, _ := setupTestServer(t)

	invalidPayloads := []map[string]any{
		// Empty product name
		{"productName": "   ", "quantity": 5, "unit": "کیلوگرم", "totalAmount": 500000, "purchaseDate": "2026-11-03"},
		// Zero quantity
		{"productName": "مرغ", "quantity": 0, "unit": "کیلوگرم", "totalAmount": 500000, "purchaseDate": "2026-11-03"},
		// Negative Toman amount
		{"productName": "مرغ", "quantity": 5, "unit": "کیلوگرم", "totalAmount": -1000, "purchaseDate": "2026-11-03"},
		// Zero Toman amount
		{"productName": "مرغ", "quantity": 5, "unit": "کیلوگرم", "totalAmount": 0, "purchaseDate": "2026-11-03"},
		// Floating-point Toman amount (must be rejected by int64 JSON decoder)
		{"productName": "مرغ", "quantity": 5, "unit": "کیلوگرم", "totalAmount": 125000.75, "purchaseDate": "2026-11-03"},
		// Invalid Gregorian calendar date (Feb 30)
		{"productName": "مرغ", "quantity": 5, "unit": "کیلوگرم", "totalAmount": 500000, "purchaseDate": "2026-02-30"},
	}

	for i, body := range invalidPayloads {
		b, _ := json.Marshal(body)
		resp, err := http.Post(ts.URL+"/api/purchases", "application/json", bytes.NewReader(b))
		if err != nil {
			t.Fatalf("case %d request error: %v", i, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("case %d: expected 400 Bad Request, got %d", i, resp.StatusCode)
		}
	}
}
