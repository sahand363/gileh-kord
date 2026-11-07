<script lang="ts">
  import { backupService } from '../../services/BackupService';
  import { apiClient, backendStatus } from '../../services/api/apiClient';
  import {
    loadPurchases,
    loadDemoDataset,
    clearDemoDataset,
    dashboardSummary
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatNumber,
    getTodayISODate,
    toJalaliDateTime,
    toJalaliNumeric
  } from '../../utils/formatters';
  import { validateBackupPayload } from '../../utils/validators';

  let fileInput: HTMLInputElement;
  let backupError = '';
  let sqliteSyncMessage = '';
  let lastExportedJalali = '';
  let isProcessing = false;

  async function handleExportJSON() {
    if (isProcessing) return;
    backupError = '';
    isProcessing = true;

    try {
      const backup = await backupService.exportBackup();
      lastExportedJalali = toJalaliDateTime(backup.exportedAt);
      const jalaliSlug = toJalaliNumeric(getTodayISODate()).replace(/\//g, '-');
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gileh-kord-backup-${jalaliSlug}.json`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('فایل پشتیبان JSON با موفقیت دانلود شد.');
    } catch (err) {
      console.error(err);
      backupError = 'خطا در تولید فایل پشتیبان.';
    } finally {
      isProcessing = false;
    }
  }

  function triggerRestore() {
    backupError = '';
    fileInput?.click();
  }

  async function handleRestoreFile(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    backupError = '';
    sqliteSyncMessage = '';
    isProcessing = true;

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        backupError = 'فایل انتخاب‌شده فرمت JSON معتبری ندارد.';
        return;
      }

      const validation = validateBackupPayload(parsed);
      if (!validation.isValid || !validation.normalizedBackup) {
        backupError = validation.error || 'ساختار فایل پشتیبان معتبر نیست.';
        return;
      }

      const count = validation.normalizedBackup.purchases.length;
      const exportDateLabel = toJalaliDateTime(validation.normalizedBackup.exportedAt);
      const confirmed = window.confirm(
        `آیا از بازیابی فایل پشتیبان اطمینان دارید؟\nتاریخ فایل: ${exportDateLabel}\nتعداد خریدها: ${formatNumber(count)} مورد`
      );
      if (!confirmed) return;

      // 1. Restore locally to IndexedDB
      const normalized = await backupService.restoreBackup(parsed);

      // 2. Also sync immediately to Go SQLite backend if reachable
      try {
        const res = await apiClient.importBackupToSQLite(normalized);
        sqliteSyncMessage = `فایل پشتیبان هم در مرورگر و هم در سرور Go SQLite (${formatNumber(res.importedPurchases)} خرید و ${formatNumber(res.importedProducts)} کالا) همگام‌سازی شد.`;
      } catch {
        sqliteSyncMessage =
          'اطلاعات در مرورگر بازیابی شد (در صورت روشن بودن سرور Go، دکمه همگام‌سازی پایین را بزنید).';
      }

      await loadPurchases(false);
      showToast('اطلاعات قدیمی شما با موفقیت بازیابی و همگام‌سازی شد.');
    } catch (err) {
      console.error(err);
      backupError =
        err instanceof Error
          ? err.message
          : 'خطا در بازیابی فایل پشتیبان. اطلاعات قبلی حفظ شد.';
    } finally {
      isProcessing = false;
      target.value = '';
    }
  }

  async function handlePushToSQLiteBackend() {
    if (isProcessing) return;
    backupError = '';
    sqliteSyncMessage = '';
    isProcessing = true;

    try {
      const backup = await backupService.exportBackup();
      const res = await apiClient.importBackupToSQLite(backup);
      await loadPurchases(false);
      sqliteSyncMessage = `همگام‌سازی کامل انجام شد: ${formatNumber(res.importedPurchases)} فاکتور خرید، ${formatNumber(res.importedProducts)} کالا و ${formatNumber(res.importedEmployees)} کارمند در پایگاه داده SQLite سرور ثبت شدند.`;
      showToast('تمام اطلاعات با پایگاه داده Go SQLite سرور همگام شد.');
    } catch (err) {
      backupError =
        err instanceof Error
          ? err.message
          : 'خطا در ارتباط با سرور Go SQLite.';
    } finally {
      isProcessing = false;
    }
  }

  async function handleReloadDemo() {
    await loadDemoDataset();
    showToast('داده‌های نمونه آزمایشی بارگذاری شدند.');
  }

  async function handleRemoveDemo() {
    await clearDemoDataset();
    showToast('داده‌های نمونه آزمایشی حذف شدند و فقط اطلاعات واقعی باقی ماند.');
  }
</script>

<section class="page active" aria-labelledby="backupTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">وارد کردن اطلاعات نسخه قبلی و همگام‌سازی با سرور Go SQLite</p>
      <h1 id="backupTitle">پشتیبان‌گیری و انتقال اطلاعات</h1>
    </div>
  </div>

  <div class="settings-grid">
    <!-- Step 1: Import Old JSON Backup File -->
    <section class="panel setting-card" style="border-color: var(--green-2); background: #f8fbf9;">
      <div class="setting-icon">۱</div>
      <div class="setting-content">
        <h3>گام اول: وارد کردن اطلاعات از نسخه قبلی (فایل JSON)</h3>
        <p>
          اگر از نسخه قبلی فایل پشتیبان (`.json`) دارید، آن را انتخاب کنید تا تمام خریدها، کالاها، کارکنان و درآمدهای قبلی شما وارد سیستم شده و به صورت خودکار به سرور Go نیز منتقل شوند.
        </p>
        <div class="setting-actions">
          <button
            id="restoreBtn"
            type="button"
            class="primary-btn"
            style="max-width: 290px;"
            disabled={isProcessing}
            on:click={triggerRestore}
          >
            <span>انتخاب فایل پشتیبان قبلی (.json)</span>
            <span class="btn-arrow">←</span>
          </button>
          <input
            id="restoreFile"
            type="file"
            bind:this={fileInput}
            accept="application/json,.json"
            on:change={handleRestoreFile}
            hidden
          />
        </div>
        {#if backupError}
          <div class="form-error" role="alert" style="margin-top: 10px; margin-bottom: 0;">
            {backupError}
          </div>
        {/if}
      </div>
    </section>

    <!-- Step 2: Sync Current Browser Data directly with Go SQLite Server -->
    <section class="panel setting-card" style="border-color: var(--green-2); background: #f8fbf9;">
      <div class="setting-icon">۲</div>
      <div class="setting-content">
        <h3>
          گام دوم: همگام‌سازی اطلاعات فعلی مرورگر با سرور Go (SQLite)
          {#if $backendStatus === 'connected'}
            <span class="badge-real">سرور Go متصل است</span>
          {/if}
        </h3>
        <p>
          با زدن این دکمه، تمام اطلاعات موجود در این مرورگر ({formatNumber($dashboardSummary.totalPurchasesCount)} خرید و {formatNumber($dashboardSummary.productsCount)} کالا) مستقیماً در پایگاه داده SQLite سرور ذخیره و همگام می‌شوند.
        </p>
        <div class="setting-actions">
          <button
            type="button"
            class="secondary-btn"
            disabled={isProcessing}
            on:click={handlePushToSQLiteBackend}
          >
            ⇄ همگام‌سازی فوری اطلاعات با سرور Go (SQLite)
          </button>
        </div>
        {#if sqliteSyncMessage}
          <p style="color: var(--green); font-weight: 800; margin-top: 10px; margin-bottom: 0;">
            ✓ {sqliteSyncMessage}
          </p>
        {/if}
      </div>
    </section>

    <!-- Export JSON Backup -->
    <section class="panel setting-card">
      <div class="setting-icon">⇧</div>
      <div class="setting-content">
        <h3>دریافت فایل پشتیبان جدید (Export JSON)</h3>
        <p>
          دانلود یک نسخه کامل JSON از تمام اطلاعات فعلی برای نگهداری امن.
        </p>
        <div class="setting-actions">
          <button
            id="backupBtn"
            type="button"
            class="secondary-btn"
            disabled={isProcessing}
            on:click={handleExportJSON}
          >
            دانلود فایل پشتیبان JSON
          </button>
        </div>
        {#if lastExportedJalali}
          <small>آخرین خروجی: {lastExportedJalali}</small>
        {/if}
      </div>
    </section>

    <!-- Demo Data Controls -->
    <section class="panel setting-card">
      <div class="setting-icon">✳</div>
      <div class="setting-content">
        <h3>پاک کردن داده‌های نمونه آزمایشی</h3>
        <p>
          حذف ردیف‌های آزمایشی و نگه داشتن فقط اطلاعات واقعی رستوران شما.
        </p>
        <div class="setting-actions">
          <button type="button" class="quiet-btn" on:click={handleRemoveDemo}>
            حذف تمام داده‌های نمونه (حفظ خریدهای واقعی)
          </button>
          <button type="button" class="quiet-btn" on:click={handleReloadDemo}>
            بارگذاری مجدد داده‌های نمونه
          </button>
        </div>
      </div>
    </section>
  </div>
</section>
