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
      formError = 'لطفاً شرح هزینه را وارد کنید.';
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
    showToast('هزینه جدید با موفقیت ثبت شد.');
  }
</script>

<section class="page active" aria-labelledby="expensesTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">مدیریت هزینه‌های جاری و عملیاتی (شمسی)</p>
      <h1 id="expensesTitle">هزینه‌های رستوران</h1>
      <p class="subheading">ثبت و پیگیری هزینه‌های غیرکالایی مانند کرایه حمل، تعمیرات تجهیزات، قبوض و خدمات.</p>
    </div>
  </div>

  <div class="entry-layout">
    <section class="panel history-panel">
      <div class="filters">
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

      <div class="history-summary">
        <span>{formatNumber(filteredExpenses.length)} ردیف هزینه</span>
        <span>مجموع هزینه‌ها: <strong>{formatMoney(filteredTotal)} تومان</strong></span>
      </div>

      <div class="purchase-list">
        {#if filteredExpenses.length > 0}
          {#each filteredExpenses as exp (exp.id)}
            <article class="purchase-item">
              <div class="product-avatar">¤</div>
              <div class="purchase-main">
                <div class="purchase-name">
                  <span>{exp.title}</span>
                  {#if exp.isDemo}
                    <span class="badge-demo">نمونه آزمایشی</span>
                  {:else}
                    <span class="badge-real">ثبت واقعی</span>
                  {/if}
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
                  {toJalaliDate(exp.expenseDate)} ({toJalaliNumeric(exp.expenseDate)})
                </div>
              </div>
            </article>
          {/each}
        {:else}
          <EmptyState
            title="هزینه‌ای یافت نشد"
            message="از فرم روبه‌رو هزینه‌های جاری رستوران را ثبت کنید."
          />
        {/if}
      </div>
    </section>

    <aside class="panel form-panel">
      <div class="section-heading">
        <div>
          <h2>ثبت هزینه جدید</h2>
          <p>افزودن هزینه جاری به گزارش مالی</p>
        </div>
      </div>

      <form on:submit|preventDefault={handleAddExpense} novalidate>
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
          <label for="expDate">تاریخ پرداخت (شمسی)</label>
          <JalaliDatePicker
            id="expDate"
            bind:value={expenseDate}
            ariaLabel="تاریخ پرداخت هزینه"
          />
        </div>

        <div class="field">
          <label for="expNotes">توضیحات</label>
          <textarea id="expNotes" rows="2" bind:value={notes} placeholder="شماره رسید یا توضیحات..."></textarea>
        </div>

        {#if formError}
          <div class="form-error" role="alert">{formError}</div>
        {/if}

        <button type="submit" class="primary-btn">
          <span>ثبت هزینه</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </aside>
  </div>
</section>
