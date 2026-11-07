package models

import "github.com/sahand363/gileh-kord/backend/internal/currency"

type Product struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	NormalizedName      string            `json:"normalizedName"`
	Category            string            `json:"category"`
	LastUnit            string            `json:"lastUnit"`
	LastPrice           int64             `json:"lastPrice"` // Canonical integer Toman
	ReportingLastPrice  int64             `json:"reportingLastPrice"`
	ReportingCurrency   currency.Currency `json:"reportingCurrency"`
	LastPurchaseDate    string            `json:"lastPurchaseDate"`
	TotalPurchasesCount int64             `json:"totalPurchasesCount"`
	IsDemo              bool              `json:"isDemo"`
	CreatedAt           string            `json:"createdAt"`
	UpdatedAt           string            `json:"updatedAt"`
}

func (p *Product) ApplyReportingCurrency(target currency.Currency) {
	if target == "" {
		target = currency.Toman
	}
	p.ReportingCurrency = target
	if converted, err := currency.ConvertForDisplay(p.LastPrice, target); err == nil {
		p.ReportingLastPrice = converted
	} else {
		p.ReportingLastPrice = p.LastPrice
	}
}

type CreateProductInput struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Category         string `json:"category"`
	LastUnit         string `json:"lastUnit"`
	LastPrice        int64  `json:"lastPrice"`
	LastPurchaseDate string `json:"lastPurchaseDate"`
	IsDemo           bool   `json:"isDemo"`
}

type UpdateProductInput struct {
	Name             string `json:"name"`
	Category         string `json:"category"`
	LastUnit         string `json:"lastUnit"`
	LastPrice        int64  `json:"lastPrice"`
	LastPurchaseDate string `json:"lastPurchaseDate"`
}

type Purchase struct {
	ID                   string            `json:"id"`
	ProductID            string            `json:"productId"`
	ProductName          string            `json:"productName"`
	Quantity             float64           `json:"quantity"`
	Unit                 string            `json:"unit"`
	TotalAmount          int64             `json:"totalAmount"` // Canonical integer Toman
	Currency             string            `json:"currency"`    // Always "IRT" for stored canonical Toman
	ReportingTotalAmount int64             `json:"reportingTotalAmount"`
	ReportingCurrency    currency.Currency `json:"reportingCurrency"`
	PurchaseDate         string            `json:"purchaseDate"` // YYYY-MM-DD
	EmployeeID           string            `json:"employeeId,omitempty"`
	EmployeeNameSnapshot string            `json:"employeeNameSnapshot,omitempty"`
	SupplierID           string            `json:"supplierId,omitempty"`
	SupplierName         string            `json:"supplierName,omitempty"`
	InvoiceNumber        string            `json:"invoiceNumber,omitempty"`
	Notes                string            `json:"notes,omitempty"`
	IsDemo               bool              `json:"isDemo"`
	CreatedAt            string            `json:"createdAt"`
	UpdatedAt            string            `json:"updatedAt"`
}

func (p *Purchase) ApplyReportingCurrency(target currency.Currency) {
	if target == "" {
		target = currency.Toman
	}
	p.ReportingCurrency = target
	if converted, err := currency.ConvertForDisplay(p.TotalAmount, target); err == nil {
		p.ReportingTotalAmount = converted
	} else {
		p.ReportingTotalAmount = p.TotalAmount
	}
}

type CreatePurchaseInput struct {
	ID                   string  `json:"id"`
	ProductID            string  `json:"productId"`
	ProductName          string  `json:"productName"`
	Quantity             float64 `json:"quantity"`
	Unit                 string  `json:"unit"`
	TotalAmount          int64   `json:"totalAmount"`
	Price                int64   `json:"price"` // Fallback alias used by legacy frontend calls
	PurchaseDate         string  `json:"purchaseDate"`
	EmployeeID           string  `json:"employeeId"`
	EmployeeNameSnapshot string  `json:"employeeNameSnapshot"`
	SupplierID           string  `json:"supplierId"`
	SupplierName         string  `json:"supplierName"`
	Supplier             string  `json:"supplier"` // Fallback alias
	InvoiceNumber        string  `json:"invoiceNumber"`
	Invoice              string  `json:"invoice"` // Fallback alias
	Notes                string  `json:"notes"`
	IsDemo               bool    `json:"isDemo"`
}

type UpdatePurchaseInput struct {
	ProductName          string  `json:"productName"`
	Quantity             float64 `json:"quantity"`
	Unit                 string  `json:"unit"`
	TotalAmount          int64   `json:"totalAmount"`
	Price                int64   `json:"price"`
	PurchaseDate         string  `json:"purchaseDate"`
	EmployeeID           string  `json:"employeeId"`
	EmployeeNameSnapshot string  `json:"employeeNameSnapshot"`
	SupplierID           string  `json:"supplierId"`
	SupplierName         string  `json:"supplierName"`
	Supplier             string  `json:"supplier"`
	InvoiceNumber        string  `json:"invoiceNumber"`
	Invoice              string  `json:"invoice"`
	Notes                string  `json:"notes"`
}

type PurchaseFilter struct {
	Query        string
	ProductID    string
	SupplierName string
	EmployeeID   string // "" = all, "__unassigned__" = null/empty employee_id, or specific employee ID
	DateFrom     string // YYYY-MM-DD
	DateTo       string // YYYY-MM-DD
	OnlyReal     bool
	Page         int
	PageSize     int
}

type PurchaseListResult struct {
	Items                []Purchase        `json:"items"`
	TotalCount           int64             `json:"totalCount"`
	TotalAmountToman     int64             `json:"totalAmount"`
	AverageAmountToman   int64             `json:"averageAmount"`
	ReportingTotalAmount int64             `json:"reportingTotalAmount"`
	ReportingCurrency    currency.Currency `json:"reportingCurrency"`
	ReportingLabel       string            `json:"reportingCurrencyLabel"`
	Page                 int               `json:"page"`
	PageSize             int               `json:"pageSize"`
	TotalPages           int               `json:"totalPages"`
}
