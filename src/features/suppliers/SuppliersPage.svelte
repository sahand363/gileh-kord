<script lang="ts">
  import { suppliers, addSupplier } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import { formatMoney, formatNumber, toJalaliDate } from '../../utils/formatters';
  import EmptyState from '../../components/common/EmptyState.svelte';

  let searchQuery = '';
  let name = '';
  let category = 'مواد غذایی و پروتئینی';
  let phone = '';
  let city = 'رشت';
  let notes = '';
  let formError = '';

  $: filteredSuppliers = $suppliers.filter((s) => {
    const q = searchQuery.trim().toLocaleLowerCase('fa-IR');
    return (
      !q ||
      s.name.toLocaleLowerCase('fa-IR').includes(q) ||
      s.category.toLocaleLowerCase('fa-IR').includes(q) ||
      s.city.toLocaleLowerCase('fa-IR').includes(q)
    );
  });

  async function handleAddSupplier() {
    formError = '';
    if (!name.trim()) {
      formError = 'لطفاً نام فروشنده یا تأمین‌کننده را وارد کنید.';
      return;
    }

    await addSupplier({ name, category, phone, city, notes });
    name = '';
    phone = '';
    notes = '';
    showToast('تأمین‌کننده جدید با موفقیت ثبت شد.');
  }
</script>

<section class="page active" aria-labelledby="suppliersTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">مدیریت طرف‌حساب‌ها</p>
      <h1 id="suppliersTitle">تأمین‌کنندگان و فروشندگان</h1>
      <p class="subheading">فهرست فروشگاه‌ها و تأمین‌کنندگان مواد اولیه رستوران به همراه حجم خرید از هر فروشنده.</p>
    </div>
  </div>

  <div class="entry-layout">
    <section class="panel history-panel">
      <div class="filters">
        <div class="search-box">
          <span>⌕</span>
          <input
            bind:value={searchQuery}
            placeholder="جست‌وجوی نام فروشنده، رسته یا شهر..."
            aria-label="جست‌وجوی فروشنده"
          />
        </div>
      </div>

      <div class="history-summary">
        <span>{formatNumber(filteredSuppliers.length)} تأمین‌کننده ثبت‌شده</span>
        <span>بروزرسانی خودکار حجم خرید هنگام ثبت فاکتور</span>
      </div>

      <div class="purchase-list">
        {#if filteredSuppliers.length > 0}
          {#each filteredSuppliers as sup (sup.id)}
            <article class="purchase-item">
              <div class="product-avatar">{sup.name.charAt(0)}</div>
              <div class="purchase-main">
                <div class="purchase-name">
                  <span>{sup.name}</span>
                  {#if sup.isDemo}
                    <span class="badge-demo">نمونه آزمایشی</span>
                  {:else}
                    <span class="badge-real">ثبت واقعی</span>
                  {/if}
                </div>
                <div class="purchase-meta">
                  <span>حوزه: {sup.category}</span>
                  <span>شهر: {sup.city}</span>
                  <span>تلفن: {sup.phone}</span>
                  {#if sup.notes}
                    <span>({sup.notes})</span>
                  {/if}
                </div>
              </div>
              <div class="purchase-side">
                <div class="purchase-amount">{formatMoney(sup.totalPurchasesAmount)} تومان</div>
                <div class="purchase-date">
                  {formatNumber(sup.purchasesCount)} فاکتور
                  {sup.lastPurchaseDate ? `| ${toJalaliDate(sup.lastPurchaseDate)}` : ''}
                </div>
              </div>
            </article>
          {/each}
        {:else}
          <EmptyState
            title="فروشنده‌ای یافت نشد"
            message="از فرم روبه‌رو فروشنده جدید اضافه کنید."
          />
        {/if}
      </div>
    </section>

    <aside class="panel form-panel">
      <div class="section-heading">
        <div>
          <h2>افزودن تأمین‌کننده جدید</h2>
          <p>ثبت اطلاعات تماس فروشنده در حافظه محلی</p>
        </div>
      </div>

      <form on:submit|preventDefault={handleAddSupplier} novalidate>
        <div class="field">
          <label for="supName">نام فروشگاه / تأمین‌کننده <b class="required">*</b></label>
          <input id="supName" bind:value={name} placeholder="مثلاً پروتئینی مرکزی" required />
        </div>

        <div class="field">
          <label for="supCategory">رسته فعالیت</label>
          <input id="supCategory" bind:value={category} placeholder="مثلاً غلات، گوشت، تره‌بار" />
        </div>

        <div class="field-row">
          <div class="field">
            <label for="supPhone">شماره تماس</label>
            <input id="supPhone" bind:value={phone} placeholder="۰۱۳-۳۳..." />
          </div>
          <div class="field">
            <label for="supCity">شهر</label>
            <input id="supCity" bind:value={city} placeholder="رشت / سنندج / تهران" />
          </div>
        </div>

        <div class="field">
          <label for="supNotes">توضیحات</label>
          <textarea id="supNotes" rows="2" bind:value={notes} placeholder="شرایط تسویه یا ساعت ارسال..."></textarea>
        </div>

        {#if formError}
          <div class="form-error" role="alert">{formError}</div>
        {/if}

        <button type="submit" class="primary-btn">
          <span>ذخیره تأمین‌کننده</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </aside>
  </div>
</section>
