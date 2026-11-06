<script lang="ts">
  import { expenses, addExpense } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatMoney,
    formatNumber,
    toJalaliDate,
    toJalaliNumeric,
    getTodayISODate,
    parseNumericInput
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import { calculateExpensesTotal } from '../../utils/calculations';
  import type { ExpenseCategory } from '../../models/types';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';

  const EXPENSE_CATEGORIES: ExpenseCategory[] = [
    'اجاره و قبوض',
    'حقوق و دستمزد',
    'تعمیر و نگهداری',
    'حمل و نقل',
    'بسته‌بندی و مصرفی',
    'سایر هزینه‌ها'
  ];

  let selectedCategory = '';
  let searchQuery = '';

  let title = '';
  let category: ExpenseCategory = 'حمل و نقل';
  let amount = '';
  let expenseDate = getTodayISODate();
  let notes = '';
  let formError = '';

  $: filteredExpenses = $expenses.filter((exp) => {
    const q = searchQuery.trim().toLocaleLowerCase('fa-IR');
    const matchesSearch =
      !q ||
      exp.title.toLocaleLowerCase('fa-IR').includes(q) ||
      exp.category.toLocaleLowerCase('fa-IR').includes(q);
    const matchesCat = !selectedCategory || exp.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  $: filteredTotal = calculateExpensesTotal(filteredExpenses);

  async function handleAddExpense() {
    formError = '';
    if (!title.trim()) {
      formError = 'لطفاً عنوان هزینه را وارد کنید.';
      return;
    }

    const parsedAmount = parseNumericInput(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      formError = 'مبلغ هزینه باید عددی بزرگ‌تر از صفر باشد.';
      return;
    }

    await addExpense({
      title,
      category,
      amount: parsedAmount,
      expenseDate,
      notes
    });

    title = '';
    amount = '';
    expenseDate = getTodayISODate();
    notes = '';
    showToast('هزینه جدید ثبت شد.');
  }
</script>

<section class="page active" aria-labelledby="expensesTitle">
  <div class="page-heading">
    <h1 id="expensesTitle">هزینه‌ها</h1>
  </div>

  <!-- Top: Expense Registration Form -->
  <section class="panel form-panel" style="max-width: 720px; margin: 0 auto 24px;">
    <div class="section-heading">
      <h2>ثبت هزینه جدید</h2>
    </div>

    <form on:submit|preventDefault={handleAddExpense} novalidate>
      <div class="field-row">
        <div class="field">
          <label for="expTitle">عنوان هزینه <b class="required">*</b></label>
          <input id="expTitle" bind:value={title} placeholder="مثلاً سرویس یخچال صنعتی" required />
        </div>

        <div class="field">
          <label for="expCat">سرفصل هزینه</label>
          <select id="expCat" bind:value={category}>
            {#each EXPENSE_CATEGORIES as cat}
              <option value={cat}>{cat}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="expAmount">مبلغ <span class="label-unit">تومان</span> <b class="required">*</b></label>
          <div class="input-wrap price-wrap">
            <input
              id="expAmount"
              inputmode="numeric"
              bind:value={amount}
              placeholder="مثلاً ۸۵۰٬۰۰۰"
              required
            />
            <span class="currency">تومان</span>
          </div>
        </div>

        <div class="field">
          <label for="expDate">تاریخ پرداخت</label>
          <JalaliDatePicker
            id="expDate"
            bind:value={expenseDate}
            ariaLabel="تاریخ پرداخت هزینه"
          />
        </div>
      </div>

      <div class="field">
        <label for="expNotes">توضیحات</label>
        <textarea id="expNotes" rows="2" bind:value={notes} placeholder="توضیحات..."></textarea>
      </div>

      {#if formError}
        <div class="form-error" role="alert">{formError}</div>
      {/if}

      <button type="submit" class="primary-btn">
        <span>ثبت هزینه</span>
        <span class="btn-arrow">←</span>
      </button>
    </form>
  </section>

  <!-- Bottom: Expense List & Search Bar at the Bottom -->
  <section class="panel history-panel">
    <div class="history-summary" style="margin-top: 0; border-top: 0; padding-top: 0;">
      <span>{formatNumber(filteredExpenses.length)} ردیف هزینه</span>
      <span>مجموع هزینه‌ها: <strong>{formatMoney(filteredTotal)} تومان</strong></span>
    </div>

    <div class="purchase-list" style="margin-bottom: 18px;">
      {#if filteredExpenses.length > 0}
        {#each filteredExpenses as exp (exp.id)}
          <article class="purchase-item">
            <div class="product-avatar">¤</div>
            <div class="purchase-main">
              <div class="purchase-name">
                <span>{exp.title}</span>
              </div>
              <div class="purchase-meta">
                <span>سرفصل: {exp.category}</span>
                {#if exp.notes}
                  <span>({exp.notes})</span>
                {/if}
              </div>
            </div>
            <div class="purchase-side">
              <div class="purchase-amount">{formatMoney(exp.amount)} تومان</div>
              <div class="purchase-date">
                {getPersianWeekdayName(exp.expenseDate)} {toJalaliDate(exp.expenseDate)} ({toJalaliNumeric(exp.expenseDate)})
              </div>
            </div>
          </article>
        {/each}
      {:else}
        <EmptyState
          title="هزینه‌ای یافت نشد"
          message="از فرم بالا هزینه جدید ثبت کنید."
        />
      {/if}
    </div>

    <!-- Search Bar Moved to the Bottom -->
    <div class="filters" style="border-top: 1px solid var(--line); padding-top: 14px;">
      <div class="search-box">
        <span>⌕</span>
        <input
          bind:value={searchQuery}
          placeholder="جست‌وجوی عنوان هزینه..."
          aria-label="جست‌وجوی هزینه"
        />
      </div>
      <select
        bind:value={selectedCategory}
        style="width: auto; min-width: 155px; height: 42px; font-size: 11px;"
        aria-label="دسته‌بندی هزینه"
      >
        <option value="">همه دسته‌بندی‌ها</option>
        {#each EXPENSE_CATEGORIES as cat}
          <option value={cat}>{cat}</option>
        {/each}
      </select>
      {#if searchQuery || selectedCategory}
        <button
          type="button"
          class="quiet-btn"
          on:click={() => {
            searchQuery = '';
            selectedCategory = '';
          }}
        >
          پاک کردن
        </button>
      {/if}
    </div>
  </section>
</section>
