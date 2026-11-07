package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/sahand363/gileh-kord/backend/internal/config"
	"github.com/sahand363/gileh-kord/backend/internal/currency"
	"github.com/sahand363/gileh-kord/backend/internal/models"
	"github.com/sahand363/gileh-kord/backend/internal/repositories"
)

type ProductHandler struct {
	repo *repositories.ProductRepository
	cfg  *config.Config
}

func NewProductHandler(repo *repositories.ProductRepository, cfg *config.Config) *ProductHandler {
	return &ProductHandler{repo: repo, cfg: cfg}
}

func (h *ProductHandler) ServeCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.list(w, r)
	case http.MethodPost:
		h.create(w, r)
	default:
		Error(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *ProductHandler) ServeItem(w http.ResponseWriter, r *http.Request) {
	id := extractResourceID(r, "/api/products/")
	if id == "" {
		Error(w, http.StatusBadRequest, "شناسه کالا مشخص نشده است")
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

func (h *ProductHandler) list(w http.ResponseWriter, r *http.Request) {
	repCurr, err := ResolveReportingCurrency(r, h.cfg.ReportingCurrency)
	if err != nil {
		Error(w, http.StatusBadRequest, "واحد پول درخواستی معتبر نیست (فقط TOMAN یا RIAL)")
		return
	}

	query := r.URL.Query().Get("query")
	if query == "" {
		query = r.URL.Query().Get("q")
	}
	category := r.URL.Query().Get("category")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	items, err := h.repo.List(r.Context(), query, category, limit)
	if err != nil {
		Error(w, http.StatusInternalServerError, "خطا در دریافت فهرست کالاها")
		return
	}

	for i := range items {
		items[i].ApplyReportingCurrency(repCurr)
	}

	JSON(w, http.StatusOK, Envelope{
		"items":                  items,
		"totalCount":             len(items),
		"canonicalCurrency":      currency.Toman,
		"reportingCurrency":      repCurr,
		"reportingCurrencyLabel": currency.LabelPersian(repCurr),
	})
}

func (h *ProductHandler) getByID(w http.ResponseWriter, r *http.Request, id string) {
	repCurr, err := ResolveReportingCurrency(r, h.cfg.ReportingCurrency)
	if err != nil {
		Error(w, http.StatusBadRequest, "واحد پول درخواستی معتبر نیست")
		return
	}

	prod, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repositories.ErrProductNotFound) {
			Error(w, http.StatusNotFound, "کالای مورد نظر یافت نشد")
			return
		}
		Error(w, http.StatusInternalServerError, "خطا در دریافت اطلاعات کالا")
		return
	}

	prod.ApplyReportingCurrency(repCurr)
	JSON(w, http.StatusOK, prod)
}

func (h *ProductHandler) create(w http.ResponseWriter, r *http.Request) {
	repCurr, err := ResolveReportingCurrency(r, h.cfg.ReportingCurrency)
	if err != nil {
		Error(w, http.StatusBadRequest, "واحد پول درخواستی معتبر نیست")
		return
	}

	var input models.CreateProductInput
	if err := DecodeJSON(r, &input); err != nil {
		Error(w, http.StatusBadRequest, err.Error())
		return
	}

	created, err := h.repo.Create(r.Context(), input)
	if err != nil {
		if errors.Is(err, repositories.ErrProductExists) {
			Error(w, http.StatusConflict, "کالایی با این نام قبلاً ثبت شده است")
			return
		}
		Error(w, http.StatusBadRequest, err.Error())
		return
	}

	created.ApplyReportingCurrency(repCurr)
	JSON(w, http.StatusCreated, created)
}

func (h *ProductHandler) update(w http.ResponseWriter, r *http.Request, id string) {
	repCurr, err := ResolveReportingCurrency(r, h.cfg.ReportingCurrency)
	if err != nil {
		Error(w, http.StatusBadRequest, "واحد پول درخواستی معتبر نیست")
		return
	}

	var input models.UpdateProductInput
	if err := DecodeJSON(r, &input); err != nil {
		Error(w, http.StatusBadRequest, err.Error())
		return
	}

	updated, err := h.repo.Update(r.Context(), id, input)
	if err != nil {
		if errors.Is(err, repositories.ErrProductNotFound) {
			Error(w, http.StatusNotFound, "کالای مورد نظر یافت نشد")
			return
		}
		if errors.Is(err, repositories.ErrProductExists) {
			Error(w, http.StatusConflict, "کالای دیگری با این نام وجود دارد")
			return
		}
		Error(w, http.StatusBadRequest, err.Error())
		return
	}

	updated.ApplyReportingCurrency(repCurr)
	JSON(w, http.StatusOK, updated)
}

func (h *ProductHandler) delete(w http.ResponseWriter, r *http.Request, id string) {
	err := h.repo.Delete(r.Context(), id)
	if err != nil {
		if errors.Is(err, repositories.ErrProductNotFound) {
			Error(w, http.StatusNotFound, "کالای مورد نظر یافت نشد")
			return
		}
		if errors.Is(err, repositories.ErrProductInUse) {
			Error(w, http.StatusConflict, "این کالا در فاکتورهای خرید استفاده شده است و قابل حذف نیست")
			return
		}
		Error(w, http.StatusInternalServerError, "خطا در حذف کالا")
		return
	}

	JSON(w, http.StatusOK, Envelope{"deleted": true, "id": id})
}

func extractResourceID(r *http.Request, prefix string) string {
	if val := r.PathValue("id"); val != "" {
		return strings.TrimSpace(val)
	}
	trimmed := strings.TrimPrefix(r.URL.Path, prefix)
	trimmed = strings.Trim(trimmed, "/")
	return strings.TrimSpace(trimmed)
}
