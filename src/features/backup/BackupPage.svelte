<script lang="ts">
  import { backupService } from '../../services/BackupService';
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
        `آیا از بازیابی فایل پشتیبان اطمینان دارید؟\nتاریخ فایل: ${exportDateLabel}\nتعداد خریدها: ${formatNumber(count)} مورد\nاین اطلاعات جایگزین داده‌های فعلی مرورگر خواهد شد.`
      );
      if (!confirmed) return;

      await backupService.restoreBackup(parsed);
      await loadPurchases(false);
      showToast('تمامی اطلاعات از فایل پشتیبان با موفقیت بازیابی شد.');
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
      <p class="eyebrow">امنیت و انتقال داده‌های محلی (سازگار با نسخه‌های قبلی)</p>
      <h1 id="backupTitle">پشتیبان‌گیری و بازیابی</h1>
      <p class="subheading">
        دریافت خروجی استاندارد JSON از تمام اطلاعات ثبت‌شده، بازگردانی نسخه‌های پشتیبان و مدیریت داده‌های نمونه آزمایشی.
      </p>
    </div>
  </div>

  <div class="settings-grid">
    <section class="panel setting-card">
      <div class="setting-icon">⇧</div>
      <div class="setting-content">
        <h3>دریافت فایل پشتیبان (Export JSON)</h3>
        <p>
          خروجی کامل شامل {formatNumber($dashboardSummary.totalPurchasesCount)} خرید،
          {formatNumber($dashboardSummary.productsCount)} کالا،
          {formatNumber($dashboardSummary.suppliersCount)} تأمین‌کننده، موجودی انبار و هزینه‌ها.
        </p>
        <div class="setting-actions">
          <button
            id="backupBtn"
            type="button"
            class="primary-btn"
            style="max-width: 260px;"
            disabled={isProcessing}
            on:click={handleExportJSON}
          >
            <span>دانلود فایل پشتیبان JSON</span>
            <span class="btn-arrow">←</span>
          </button>
        </div>
        {#if lastExportedJalali}
          <small>آخرین خروجی تهیه‌شده در این نشست: {lastExportedJalali}</small>
        {/if}
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">▤</div>
      <div class="setting-content">
        <h3>بازیابی از فایل پشتیبان (Import & Validate JSON)</h3>
        <p>
          انتخاب فایل پشتیبان قبلی (نسخه ۱ یا ۲) برای بازگردانی اطلاعات. فایل پیش از اعمال به‌طور کامل بررسی و اعتبارسنجی می‌شود.
        </p>
        <div class="setting-actions">
          <button
            id="restoreBtn"
            type="button"
            class="secondary-btn"
            disabled={isProcessing}
            on:click={triggerRestore}
          >
            انتخاب فایل JSON برای بازیابی
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
        <small>
          عملیات بازیابی به‌صورت تراکنش اتمیک انجام می‌شود؛ در صورت نامعتبر بودن فایل، داده‌های فعلی شما دست‌نخورده باقی می‌ماند.
        </small>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">✳</div>
      <div class="setting-content">
        <h3>مدیریت داده‌های نمونه آزمایشی (Demo Data)</h3>
        <p>
          داده‌های نمونه صرفاً برای مشاهده ظاهر صفحات در مرحله تست بارگذاری شده‌اند و با برچسب «نمونه آزمایشی» از خریدهای واقعی شما متمایز هستند.
        </p>
        <div class="setting-actions">
          <button type="button" class="secondary-btn" on:click={handleReloadDemo}>
            بارگذاری مجدد داده‌های نمونه آزمایشی
          </button>
          <button type="button" class="quiet-btn" on:click={handleRemoveDemo}>
            حذف تمام داده‌های نمونه (حفظ خریدهای واقعی)
          </button>
        </div>
      </div>
    </section>
  </div>
</section>
