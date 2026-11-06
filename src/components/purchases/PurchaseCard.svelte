<script lang="ts">
  import { MEASUREMENT_UNITS, type Purchase } from '../../models/types';
  import {
    formatMoney,
    formatNumber,
    parseNumericInput,
    toJalaliDate,
    toJalaliNumeric
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import {
    appSettings,
    employees,
    employeeByIdMap,
    resolvePurchaseEmployeeName,
    updatePurchase
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import JalaliDatePicker from '../common/JalaliDatePicker.svelte';

  export let purchase: Purchase;

  let isEditing = false;
  let editProductName = '';
  let editQuantity = '';
  let editUnit = 'کیلوگرم';
  let editPrice = '';
  let editDate = '';
  let editEmployeeId = '';
  let editSupplier = '';
  let editInvoice = '';
  let editNotes = '';
  let editError = '';

  $: avatarLetter = (purchase.productName || '؟').trim().charAt(0);
  $: employeeLabel = resolvePurchaseEmployeeName(purchase, $employeeByIdMap);
  $: hasEmployee = Boolean(purchase.employeeId);
  $: weekdayName = getPersianWeekdayName(purchase.purchaseDate);

  function startEdit() {
    editProductName = purchase.productName;
    editQuantity = String(purchase.quantity);
    editUnit = purchase.unit;
    editPrice = String(purchase.totalAmount);
    editDate = purchase.purchaseDate;
    editEmployeeId = purchase.employeeId || '';
    editSupplier = purchase.supplierName || '';
    editInvoice = purchase.invoiceNumber || '';
    editNotes = purchase.notes || '';
    editError = '';
    isEditing = true;
  }

  async function saveEdit() {
    editError = '';
    if (!editProductName.trim()) {
      editError = 'نام محصول الزامی است.';
      return;
    }
    const q = parseNumericInput(editQuantity);
    if (isNaN(q) || q <= 0) {
      editError = 'مقدار باید بزرگ‌تر از صفر باشد.';
      return;
    }
    const p = parseNumericInput(editPrice);
    if (isNaN(p) || p <= 0) {
      editError = 'مبلغ باید بزرگ‌تر از صفر باشد.';
      return;
    }

    try {
      await updatePurchase(purchase.id, {
        productName: editProductName,
        quantity: q,
        unit: editUnit,
        price: p,
        purchaseDate: editDate,
        employeeId: editEmployeeId,
        supplier: editSupplier,
        invoice: editInvoice,
        notes: editNotes
      });
      isEditing = false;
      showToast('اطلاعات خرید ویرایش شد.');
    } catch (err) {
      editError = err instanceof Error ? err.message : 'خطا در ویرایش خرید.';
    }
  }
</script>

{#if isEditing}
  <div class="panel card-pad" style="border-color: var(--green-2);">
    <form on:submit|preventDefault={saveEdit} novalidate>
      <div class="field-row">
        <div class="field">
          <label for={`edit_prod_${purchase.id}`}>نام محصول</label>
          <input id={`edit_prod_${purchase.id}`} bind:value={editProductName} required />
        </div>
        <div class="field">
          <label for={`edit_emp_${purchase.id}`}>خرید توسط</label>
          <select id={`edit_emp_${purchase.id}`} bind:value={editEmployeeId}>
            <option value="">بدون ثبت مسئول خرید</option>
            {#each $employees as emp (emp.id)}
              <option value={emp.id}>{emp.name} — {emp.role}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for={`edit_qty_${purchase.id}`}>مقدار</label>
          <input id={`edit_qty_${purchase.id}`} inputmode="decimal" bind:value={editQuantity} required />
        </div>
        <div class="field">
          <label for={`edit_unit_${purchase.id}`}>واحد</label>
          <select id={`edit_unit_${purchase.id}`} bind:value={editUnit}>
            {#each MEASUREMENT_UNITS as u}
              <option value={u}>{u}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for={`edit_price_${purchase.id}`}>مبلغ کل (تومان)</label>
          <input id={`edit_price_${purchase.id}`} inputmode="numeric" bind:value={editPrice} required />
        </div>
        <div class="field">
          <label for={`edit_date_${purchase.id}`}>تاریخ خرید</label>
          <JalaliDatePicker id={`edit_date_${purchase.id}`} bind:value={editDate} />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for={`edit_sup_${purchase.id}`}>فروشنده</label>
          <input id={`edit_sup_${purchase.id}`} bind:value={editSupplier} />
        </div>
        <div class="field">
          <label for={`edit_inv_${purchase.id}`}>شماره فاکتور</label>
          <input id={`edit_inv_${purchase.id}`} bind:value={editInvoice} />
        </div>
      </div>

      <div class="field">
        <label for={`edit_notes_${purchase.id}`}>توضیحات</label>
        <input id={`edit_notes_${purchase.id}`} bind:value={editNotes} />
      </div>

      {#if editError}
        <div class="form-error" role="alert">{editError}</div>
      {/if}

      <div class="setting-actions">
        <button type="submit" class="secondary-btn">ذخیره تغییرات ✓</button>
        <button type="button" class="quiet-btn" on:click={() => (isEditing = false)}>
          انصراف
        </button>
      </div>
    </form>
  </div>
{:else}
  <article class="purchase-item" style="flex-wrap: wrap;">
    <div class="product-avatar">{avatarLetter}</div>
    <div class="purchase-main">
      <div class="purchase-name">
        <span>{purchase.productName}</span>
        {#if $appSettings.showDemoBadges}
          {#if purchase.isDemo}
            <span class="badge-demo">نمونه آزمایشی</span>
          {:else}
            <span class="badge-real">ثبت واقعی</span>
          {/if}
        {/if}
        <span class={hasEmployee ? 'badge-employee' : 'badge-unassigned'}>
          خرید توسط: {employeeLabel}
        </span>
      </div>
      <div class="purchase-meta">
        <span>{formatNumber(purchase.quantity)} {purchase.unit}</span>
        {#if purchase.supplierName}
          <span>فروشنده: {purchase.supplierName}</span>
        {/if}
        {#if purchase.invoiceNumber}
          <span>فاکتور {purchase.invoiceNumber}</span>
        {/if}
        {#if purchase.notes}
          <span>({purchase.notes})</span>
        {/if}
      </div>
    </div>
    <div class="purchase-side" style="display: flex; align-items: center; gap: 10px;">
      <div>
        <div class="purchase-amount">{formatMoney(purchase.totalAmount)} تومان</div>
        <div class="purchase-date">
          {weekdayName ? `${weekdayName} ` : ''}{toJalaliDate(purchase.purchaseDate)}
          ({toJalaliNumeric(purchase.purchaseDate)})
        </div>
      </div>
      <button type="button" class="quiet-btn" on:click={startEdit}>
        ویرایش
      </button>
    </div>
  </article>
{/if}
