func TestImportBackupToSQLite(t *testing.T) {
	ts, _ := setupTestServer(t)

	backupPayload := map[string]any{
		"version":    3,
		"exportedAt": "2026-11-07T08:00:00Z",
		"employees": []map[string]any{
			{
				"id":                     "emp_import_1",
				"name":                   "علی رضوانی",
				"role":                   "مسئول خرید",
				"isActive":               true,
				"performanceCoefficient": 0.6,
			},
		},
		"products": []map[string]any{
			{
				"id":               "prod_import_1",
				"name":             "برنج هاشمی",
				"lastUnit":         "کیلوگرم",
				"lastPrice":        4250000,
				"lastPurchaseDate": "2026-11-03",
			},
		},
		"purchases": []map[string]any{
			{
				"id":                   "purch_import_1",
				"productId":            "prod_import_1",
				"productName":          "برنج هاشمی",
				"quantity":             25,
				"unit":                 "کیلوگرم",
				"totalAmount":          4250000,
				"purchaseDate":         "2026-11-03",
				"employeeId":           "emp_import_1",
				"employeeNameSnapshot": "علی رضوانی",
				"supplierName":         "برنج‌فروشی شمال",
			},
		},
	}

	b, _ := json.Marshal(backupPayload)
	resp, err := http.Post(ts.URL+"/api/import/backup", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("POST /api/import/backup failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on backup import, got %d", resp.StatusCode)
	}

	// Verify the imported purchase is queryable from SQLite
	listResp, err := http.Get(ts.URL + "/api/purchases?employee_id=emp_import_1")
	if err != nil {
		t.Fatalf("GET /api/purchases after import failed: %v", err)
	}
	defer listResp.Body.Close()

	var result models.PurchaseListResult
	_ = json.NewDecoder(listResp.Body).Decode(&result)
	if result.TotalCount != 1 || result.TotalAmountToman != 4250000 {
		t.Fatalf("expected 1 imported purchase totaling 4250000 Toman, got %+v", result)
	}
}
