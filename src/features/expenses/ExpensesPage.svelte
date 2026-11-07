<script lang="ts">
  import {
    expenses,
    addExpense,
    updateExpense,
    deleteExpense
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatMoney,
    formatNumber,
    formatLivePriceInput,
    toJalaliDate,
    toJalaliNumeric,
    getTodayISODate,
    parseNumericInput
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import { calculateExpensesTotal } from '../../utils/calculations';
  import type { Expense, ExpenseCategory } from '../../models/types';
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

  // Inline Editing State
  let editingId: string | null = null;
  let editTitle = '';
  let editCategory: ExpenseCategory | string = 'حمل و نقل';
  let editAmount = '';
  let editDate = '';
  let editNotes = '';
  let editError = '';

  $: filteredExpenses = $expenses.filter((exp) => {
    const q = searchQuery.trim().toLocaleLowerCase('fa-IR');
    const matchesSearch =
      !q ||
      exp.title.toLocaleLowerCase('fa-IR').includes(q) ||
      exp.category.toLocaleLowerCase('fa-IR').includes(q) ||
      (exp.notes && exp.notes.toLocaleLowerCase('fa-IR').includes(q));
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

  function startEdit(exp: Expense) {
    editingId = exp.id;
    editTitle = exp.title;
    editCategory = exp.category;
    editAmount = formatLivePriceInput(exp.amount);
    editDate = exp.expenseDate;
    editNotes = exp.notes || '';
    editError = '';
  }

  function cancelEdit() {
    editingId = null;
    editError = '';
  }

  async function saveEdit(id: string) {
    editError = '';
    if (!editTitle.trim()) {
      editError = 'عنوان هزینه الزامی است.';
      return;
    }

    const parsedAmount = parseNumericInput(editAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      editError = 'مبلغ هزینه باید عددی بزرگ‌تر از صفر باشد.';
      return;
    }

    try {
      await updateExpense(id, {
        title: editTitle,
        category: editCategory,
        amount: parsedAmount,
        expenseDate: editDate,
        notes: editNotes
      });
      editingId = null;
      showToast('اطلاعات هزینه با موفقیت ویرایش شد.');
    } catch (err) {
      editError = err instanceof Error ? err.message : 'خطا در ویرایش هزینه.';
    }
  }

  async function handleDelete(exp: Expense) {
    if (!window.confirm(`حذف هزینه «${exp.title}» به مبلغ ${formatMoney(exp.amount)} تومان؟`)) {
      return;
    }
    await deleteExpense(exp.id);
    showToast('ردیف هزینه حذف شد.');
  }
</script>

<section class="page active" aria-labelledby="expensesTitle">
  <div class="page-heading">
    <h1 id="expensesTitle">هزینه‌ها</h1>
  </div>

  <section class="panel form-panel" style="max-width: 720px; margin: 0 auto 24px;">
    <div class="section-heading">
      <h2>ثبت هزینه جدید</h2>
    </div>

    <form on:submit|preventDefault={handleAddExpense} novalidate>
      <div class="field-row">
        <div class="field">
          <label for="expTitle">عنوان هزینه <b class="required">*</b></label>
          <input id="expTitle" bind:value={title} placeholder="مثلاً سرویس دستگاه اسپرسوساز" required />
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
              type="text"
              dir="ltr"
              inputmode="numeric"
              value={amount}
              on:input={(e) => {
                const t = e.currentTarget;
                amount = formatLivePriceInput(t.value);
                t.value = amount;
              }}
              placeholder="850،000"
              style="text-align: right;"
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

  <section class="panel history-panel">
    <div class="history-summary" style="margin-top: 0; border-top: 0; padding-top: 0;">
      <span>{formatNumber(filteredExpenses.length)} ردیف هزینه</span>
      <span>مجموع هزینه‌ها: <strong>{formatMoney(filteredTotal)} تومان</strong></span>
    </div>

    <div class="purchase-list" style="margin-bottom: 18px;">
      {#if filteredExpenses.length > 0}
        {#each filteredExpenses as exp (exp.id)}
          {#if editingId === exp.id}
            <div class="panel card-pad" style="border-color: var(--green-2);">
              <form on:submit|preventDefault={() => saveEdit(exp.id)} novalidate>
                <div class="field-row">
                  <div class="field">
                    <label for={`edit_exp_title_${exp.id}`}>عنوان هزینه</label>
                    <input
                      id={`edit_exp_title_${exp.id}`}
                      bind:value={editTitle}
                      required
                    />
                  </div>
                  <div class="field">
                    <label for={`edit_exp_cat_${exp.id}`}>سرفصل هزینه</label>
                    <select id={`edit_exp_cat_${exp.id}`} bind:value={editCategory}>
                      {#each EXPENSE_CATEGORIES as cat}
                        <option value={cat}>{cat}</option>
                      {/each}
                    </select>
                  </div>
                </div>

                <div class="field-row">
                  <div class="field">
                    <label for={`edit_exp_amt_${exp.id}`}>مبلغ (تومان)</label>
                    <input
                      id={`edit_exp_amt_${exp.id}`}
                      type="text"
                      dir="ltr"
                      inputmode="numeric"
                      value={editAmount}
                      on:input={(e) => {
                        const t = e.currentTarget;
                        editAmount = formatLivePriceInput(t.value);
                        t.value = editAmount;
                      }}
                      style="text-align: right;"
                      required
                    />
                  </div>
                  <div class="field">
                    <label for={`edit_exp_date_${exp.id}`}>تاریخ پرداخت</label>
                    <JalaliDatePicker
                      id={`edit_exp_date_${exp.id}`}
                      bind:value={editDate}
                    />
                  </div>
                </div>

                <div class="field">
                  <label for={`edit_exp_notes_${exp.id}`}>توضیحات</label>
                  <input
                    id={`edit_exp_notes_${exp.id}`}
                    bind:value={editNotes}
                    placeholder="توضیحات..."
                  />
                </div>

                {#if editError}
                  <div class="form-error" role="alert">{editError}</div>
                {/if}

                <div class="setting-actions">
                  <button type="submit" class="secondary-btn">ذخیره تغییرات ✓</button>
                  <button type="button" class="quiet-btn" on:click={cancelEdit}>
                    انصراف
                  </button>
                </div>
              </form>
            </div>
          {:else}
            <article class="purchase-item" style="flex-wrap: wrap;">
              <div class="product-avatar">¤</div>
              <div class="purchase-main">
                <div class="purchase-name">
                  <span>{exp.title}</span>
                  <span class="badge-employee">{exp.category}</span>
                </div>
                <div class="purchase-meta">
                  <span>
                    {getPersianWeekdayName(exp.expenseDate)} {toJalaliDate(exp.expenseDate)} ({toJalaliNumeric(exp.expenseDate)})
                  </span>
                  {#if exp.notes}
                    <span>({exp.notes})</span>
                  {/if}
                </div>
              </div>
              <div class="purchase-side" style="display: flex; align-items: center; gap: 8px;">
                <div class="purchase-amount">{formatMoney(exp.amount)} تومان</div>
                <button
                  type="button"
                  class="secondary-btn"
                  on:click={() => startEdit(exp)}
                >
                  ویرایش
                </button>
                <button
                  type="button"
                  class="quiet-btn"
                  on:click={() => handleDelete(exp)}
                >
                  حذف
                </button>
              </div>
            </article>
          {/if}
        {/each}
      {:else}
        <EmptyState
          title="هزینه‌ای یافت نشد"
          message="از فرم بالا هزینه جدید ثبت کنید."
        />
      {/if}
    </div>

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
