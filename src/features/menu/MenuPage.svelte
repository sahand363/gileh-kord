<script lang="ts">
  import {
    menuItems,
    addMenuItem,
    updateMenuItem,
    deleteMenuItem
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatMoney,
    formatNumber,
    parseNumericInput
  } from '../../utils/formatters';
  import { MENU_CATEGORIES, type MenuCategory, type MenuItem } from '../../models/types';
  import EmptyState from '../../components/common/EmptyState.svelte';

  let name = '';
  let category: MenuCategory = 'غذای اصلی و کباب‌ها';
  let price = '';
  let description = '';
  let isAvailable = true;
  let editingId: string | null = null;
  let formError = '';

  let searchQuery = '';
  let filterCategory = '';

  $: filteredMenu = $menuItems.filter((item) => {
    const q = searchQuery.trim().toLocaleLowerCase('fa-IR');
    const matchesSearch =
      !q ||
      item.name.toLocaleLowerCase('fa-IR').includes(q) ||
      item.category.toLocaleLowerCase('fa-IR').includes(q) ||
      (item.description && item.description.toLocaleLowerCase('fa-IR').includes(q));
    const matchesCat = !filterCategory || item.category === filterCategory;
    return matchesSearch && matchesCat;
  });

  function startEdit(item: MenuItem) {
    editingId = item.id;
    name = item.name;
    category = item.category;
    price = String(item.price);
    description = item.description || '';
    isAvailable = item.isAvailable;
    formError = '';
  }

  function resetForm() {
    editingId = null;
    name = '';
    category = 'غذای اصلی و کباب‌ها';
    price = '';
    description = '';
    isAvailable = true;
    formError = '';
  }

  async function handleSaveMenuItem() {
    formError = '';
    if (!name.trim()) {
      formError = 'لطفاً نام غذا یا آیتم منو را وارد کنید.';
      return;
    }
    const parsedPrice = parseNumericInput(price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      formError = 'قیمت باید عددی معتبر به تومان باشد.';
      return;
    }

    try {
      if (editingId) {
        await updateMenuItem(editingId, {
          name,
          category,
          price: parsedPrice,
          isAvailable,
          description
        });
        showToast('آیتم منو ویرایش و در سرور ذخیره شد.');
      } else {
        await addMenuItem({
          name,
          category,
          price: parsedPrice,
          isAvailable,
          description
        });
        showToast('آیتم جدید به منوی رستوران اضافه شد.');
      }
      resetForm();
    } catch (err) {
      formError = err instanceof Error ? err.message : 'خطا در ذخیره آیتم منو.';
    }
  }

  async function handleToggleAvailable(item: MenuItem) {
    await updateMenuItem(item.id, { isAvailable: !item.isAvailable });
    showToast(
      !item.isAvailable
        ? `«${item.name}» در منو موجود شد.`
        : `«${item.name}» به حالت ناموجود تغییر یافت.`
    );
  }

  async function handleDelete(item: MenuItem) {
    if (!window.confirm(`حذف «${item.name}» از منوی رستوران؟`)) return;
    await deleteMenuItem(item.id);
    showToast('آیتم از منو حذف شد.');
  }
</script>

<div class="menu-manager-subview">
  <section class="panel form-panel" style="max-width: 720px; margin: 0 auto 20px;">
    <div class="section-heading">
      <h2>{editingId ? 'ویرایش آیتم منو' : 'افزودن آیتم جدید به منوی رستوران'}</h2>
      {#if editingId}
        <button type="button" class="quiet-btn" on:click={resetForm}>
          انصراف
        </button>
      {/if}
    </div>

    <form on:submit|preventDefault={handleSaveMenuItem} novalidate>
      <div class="field-row">
        <div class="field">
          <label for="menuItemName">نام غذا / آیتم <b class="required">*</b></label>
          <input
            id="menuItemName"
            bind:value={name}
            placeholder="مثلاً چلوکباب کوبیده یا میرزاقاسمی"
            required
          />
        </div>

        <div class="field">
          <label for="menuItemCat">دسته‌بندی منو</label>
          <select id="menuItemCat" bind:value={category}>
            {#each MENU_CATEGORIES as cat}
              <option value={cat}>{cat}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="menuItemPrice">قیمت <span class="label-unit">تومان</span> <b class="required">*</b></label>
          <div class="input-wrap price-wrap">
            <input
              id="menuItemPrice"
              inputmode="numeric"
              bind:value={price}
              placeholder="مثلاً ۳۲۰٬۰۰۰"
              required
            />
            <span class="currency">تومان</span>
          </div>
        </div>

        <div class="field" style="display: flex; align-items: center; padding-top: 22px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 0;">
            <input
              type="checkbox"
              bind:checked={isAvailable}
              style="width: 18px; height: 18px; min-height: 18px;"
            />
            <span>موجود و قابل سفارش</span>
          </label>
        </div>
      </div>

      <div class="field">
        <label for="menuItemDesc">توضیحات / مخلفات (اختیاری)</label>
        <input
          id="menuItemDesc"
          bind:value={description}
          placeholder="مثلاً همراه با برنج ایرانی، گوجه کبابی و دورچین..."
        />
      </div>

      {#if formError}
        <div class="form-error" role="alert">{formError}</div>
      {/if}

      <button type="submit" class="primary-btn">
        <span>{editingId ? 'ذخیره تغییرات منو' : '＋ افزودن به منو'}</span>
        <span class="btn-arrow">←</span>
      </button>
    </form>
  </section>

  <section class="panel history-panel">
    <div class="section-heading">
      <h2>فهرست منوی رستوران ({formatNumber(filteredMenu.length)} مورد)</h2>
    </div>

    <div class="filters">
      <div class="search-box">
        <span>⌕</span>
        <input
          bind:value={searchQuery}
          placeholder="جست‌وجوی نام غذا در منو..."
          aria-label="جست‌وجوی منو"
        />
      </div>
      <select
        bind:value={filterCategory}
        style="width: auto; min-width: 170px; height: 42px; font-size: 11px;"
      >
        <option value="">همه دسته‌های منو</option>
        {#each MENU_CATEGORIES as cat}
          <option value={cat}>{cat}</option>
        {/each}
      </select>
    </div>

    <div class="purchase-list">
      {#if filteredMenu.length > 0}
        {#each filteredMenu as item (item.id)}
          <article class="purchase-item" style="flex-wrap: wrap;">
            <div class="product-avatar">{item.name.charAt(0)}</div>
            <div class="purchase-main">
              <div class="purchase-name">
                <span>{item.name}</span>
                <span class="badge-employee">{item.category}</span>
                {#if item.isAvailable}
                  <span class="badge-real">موجود</span>
                {:else}
                  <span class="badge-low">ناموجود</span>
                {/if}
              </div>
              {#if item.description}
                <div class="purchase-meta">
                  <span>{item.description}</span>
                </div>
              {/if}
            </div>

            <div class="purchase-side" style="display: flex; align-items: center; gap: 8px;">
              <div class="purchase-amount">{formatMoney(item.price)} تومان</div>
              <button
                type="button"
                class="quiet-btn"
                on:click={() => handleToggleAvailable(item)}
              >
                {item.isAvailable ? 'ناموجود کردن' : 'موجود کردن'}
              </button>
              <button
                type="button"
                class="secondary-btn"
                on:click={() => startEdit(item)}
              >
                ویرایش
              </button>
              <button
                type="button"
                class="quiet-btn"
                on:click={() => handleDelete(item)}
              >
                حذف
              </button>
            </div>
          </article>
        {/each}
      {:else}
        <EmptyState
          title="منوی رستوران خالی است"
          message="از فرم بالا غذاها و قیمت‌های منوی رستوران را اضافه کنید."
        />
      {/if}
    </div>
  </section>
</div>
