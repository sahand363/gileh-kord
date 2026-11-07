package handlers

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/sahand363/gileh-kord/backend/internal/config"
	"github.com/sahand363/gileh-kord/backend/internal/models"
	"github.com/sahand363/gileh-kord/backend/internal/repositories"
	"github.com/sahand363/gileh-kord/backend/internal/utils"
)

type PurchaseHandler struct {
	repo *repositories.PurchaseRepository
	cfg  *config.Config
}

func NewPurchaseHandler(repo *repositories.PurchaseRepository, cfg *config.Config) *PurchaseHandler {
	return &PurchaseHandler{repo: repo, cfg: cfg}
}

func (h *PurchaseHandler) ServeCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.list(w, r)
	case http.MethodPost:
		h.create(w, r)
	default:
		Error(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *PurchaseHandler) ServeItem(w http.ResponseWriter, r *http.Request) {
	id := extractResourceID(r, "/api/purchases/")
	if id == "" {
		Error(w, http.StatusBadRequest, "شناسه فاکتور خرید مشخص نشده است")
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.getByID(w, r, id)
	case http.MethodPut:
		h.update(w, r, id)
	case http.MethodDelete:
		h.delete(w, r, id)
	default:
		Error(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *PurchaseHandler) list(w http.ResponseWriter, r *http.Request) {
	repCurr, err := ResolveReportingCurrency(r, h.cfg.ReportingCurrency)
	if err != nil {
		Error(w, http.StatusBadRequest, "واحد پول درخواستی معتبر نیست (فقط TOMAN یا RIAL)")
		return
	}

	q := r.URL.Query()
	dateFrom := q.Get("date_from")
	if dateFrom == "" {
		dateFrom = q.Get("dateFrom")
	}
	if dateFrom != "" {
		if norm, ok := utils.NormalizeISODate(dateFrom); ok {
			dateFrom = norm
		} else {
			Error(w, http.StatusBadRequest, "فرمت تاریخ شروع (date_from) نامعتبر است (فرمت صحیح: YYYY-MM-DD)")
			return
		}
	}

	dateTo := q.Get("date_to")
	if dateTo == "" {
		dateTo = q.Get("dateTo")
	}
	if dateTo != "" {
		if norm, ok := utils.NormalizeISODate(dateTo); ok {
			dateTo = norm
		} else {
			Error(w, http.StatusBadRequest, "فرمت تاریخ پایان (date_to) نامعتبر است (فرمت صحیح: YYYY-MM-DD)")
			return
		}
	}

	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if pageSize == 0 {
		pageSize, _ = strconv.Atoi(q.Get("pageSize"))
	}

	productID := q.Get("product_id")
	if productID == "" {
		productID = q.Get("productId")
	}

	supplierName := q.Get("supplier")
	if supplierName == "" {
		supplierName = q.Get("supplierName")
	}

	employeeID := q.Get("employee_id")
	if employeeID == "" {
		employeeID = q.Get("employeeId")
	}

	onlyReal := q.Get("only_real") == "true" || q.Get("onlyReal") == "true"

	filter := models.PurchaseFilter{
		Query:        q.Get("query"),
		ProductID:    productID,
		SupplierName: supplierName,
		EmployeeID:   employeeID,
		DateFrom:     dateFrom,
		DateTo:       dateTo,
		OnlyReal:     onlyReal,
		Page:         page,
		PageSize:     pageSize,
	}

	result, err := h.repo.List(r.Context(), filter, repCurr)
	if err != nil {
		Error(w, http.StatusInternalServerError, "خطا در دریافت تاریخچه خریدها")
		return
	}

	JSON(w, http.StatusOK, result)
}

func (h *PurchaseHandler) getByID(w http.ResponseWriter, r *http.Request, id string) {
	repCurr, err := ResolveReportingCurrency(r, h.cfg.ReportingCurrency)
	if err != nil {
		Error(w, http.StatusBadRequest, "واحد پول درخواستی معتبر نیست")
		return
	}

	item, err := h.repo.GetByID(r.Context(), id, repCurr)
	if err != nil {
		if errors.Is(err, repositories.ErrPurchaseNotFound) {
			Error(w, http.StatusNotFound, "فاکتور خرید مورد نظر یافت نشد")
			return
		}
		Error(w, http.StatusInternalServerError, "خطا در دریافت اطلاعات خرید")
		return
	}

	JSON(w, http.StatusOK, item)
}

func (h *PurchaseHandler) create(w http.ResponseWriter, r *http.Request) {
	repCurr, err := ResolveReportingCurrency(r, h.cfg.ReportingCurrency)
	if err != nil {
		Error(w, http.StatusBadRequest, "واحد پول درخواستی معتبر نیست")
		return
	}

	var input models.CreatePurchaseInput
	if err := DecodeJSON(r, &input); err != nil {
		Error(w, http.StatusBadRequest, err.Error())
		return
	}

	purchase, product, err := h.repo.CreateWithProduct(r.Context(), input, repCurr)
	if err != nil {
		Error(w, http.StatusBadRequest, err.Error())
		return
	}

	JSON(w, http.StatusCreated, Envelope{
		"purchase": purchase,
		"product":  product,
	})
}

func (h *PurchaseHandler) update(w http.ResponseWriter, r *http.Request, id string) {
	repCurr, err := ResolveReportingCurrency(r, h.cfg.ReportingCurrency)
	if err != nil {
		Error(w, http.StatusBadRequest, "واحد پول درخواستی معتبر نیست")
		return
	}

	var input models.UpdatePurchaseInput
	if err := DecodeJSON(r, &input); err != nil {
		Error(w, http.StatusBadRequest, err.Error())
		return
	}

	updated, err := h.repo.UpdateWithProduct(r.Context(), id, input, repCurr)
	if err != nil {
		if errors.Is(err, repositories.ErrPurchaseNotFound) {
			Error(w, http.StatusNotFound, "فاکتور خرید مورد نظر یافت نشد")
			return
		}
		Error(w, http.StatusBadRequest, err.Error())
		return
	}

	JSON(w, http.StatusOK, updated)
}

func (h *PurchaseHandler) delete(w http.ResponseWriter, r *http.Request, id string) {
	err := h.repo.Delete(r.Context(), id)
	if err != nil {
		if errors.Is(err, repositories.ErrPurchaseNotFound) {
			Error(w, http.StatusNotFound, "فاکتور خرید مورد نظر یافت نشد")
			return
		}
		Error(w, http.StatusInternalServerError, "خطا در حذف فاکتور خرید")
		return
	}

	JSON(w, http.StatusOK, Envelope{"deleted": true, "id": id})
}
