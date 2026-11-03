<script lang="ts">
  import {
    employees,
    activeEmployees,
    employeeByIdMap,
    timesheets,
    addTimesheetEntry,
    updateTimesheetEntry,
    deleteTimesheetEntry
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatNumber,
    getTodayISODate,
    parseNumericInput,
    toJalaliDate,
    toJalaliNumeric
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import {
    calculateEmployeeTimesheetSummary,
    calculateShiftDuration,
    compareShiftWithExpectedSchedule,
    findOverlappingShift,
    formatMinutesToPersianHours
  } from '../../utils/timesheetUtils';
  import type { TimesheetEntry } from '../../models/types';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';

  let employeeId = '';
  let workDate = getTodayISODate();
  let clockIn = '08:00';
  let clockOut = '17:30';
  let breakMinutes = '60';
  let allowOvernight = false;
  let notes = '';

  let editingEntryId: string | null = null;
  let editReason = '';
  let formError = '';

  // Filters for attendance list & analytics
  let filterEmployeeId = '';
  let filterDateFrom = '';
  let filterDateTo = '';

  $: if (!employeeId && $activeEmployees.length > 0) {
    employeeId = $activeEmployees[0].id;
  }

  $: livePreview = calculateShiftDuration({
    clockIn,
    clockOut,
    breakMinutes: parseNumericInput(breakMinutes) || 0,
    allowOvernight
  });

  $: overlapWarning = employeeId
    ? findOverlappingShift($timesheets, {
        employeeId,
        date: workDate,
        clockIn,
        clockOut,
        excludeShiftId: editingEntryId || undefined
      })
    : null;

  $: filteredTimesheets = $timesheets.filter((t) => {
    if (filterEmployeeId && t.employeeId !== filterEmployeeId) return false;
    if (filterDateFrom && t.date < filterDateFrom) return false;
    if (filterDateTo && t.date > filterDateTo) return false;
    return true;
  });

  $: selectedFilterEmployee = filterEmployeeId
    ? $employeeByIdMap.get(filterEmployeeId) || null
    : null;

  $: summaryStats = calculateEmployeeTimesheetSummary(
    filteredTimesheets,
    selectedFilterEmployee
  );

  function startEditShift(entry: TimesheetEntry) {
    editingEntryId = entry.id;
    employeeId = entry.employeeId;
    workDate = entry.date;
    clockIn = entry.clockIn;
    clockOut = entry.clockOut;
    breakMinutes = String(entry.breakMinutes);
    allowOvernight = entry.overnight;
    notes = entry.notes || '';
    editReason = '';
    formError = '';
  }

  function cancelEditShift() {
    editingEntryId = null;
    clockIn = '08:00';
    clockOut = '17:30';
    breakMinutes = '60';
    allowOvernight = false;
    notes = '';
    editReason = '';
    formError = '';
  }

  async function handleSubmitTimesheet() {
    formError = '';
    const brk = parseNumericInput(breakMinutes);
    const cleanBreak = !isNaN(brk) && brk >= 0 ? Math.round(brk) : 0;

    if (overlapWarning) {
      const proceed = window.confirm(
        `هشدار تداخل شیفت: برای این کارمند در تاریخ ${toJalaliDate(workDate)} شیفت دیگری (${overlapWarning.clockIn} تا ${overlapWarning.clockOut}) ثبت شده است. آیا مایل به ثبت این شیفت هستید؟`
      );
      if (!proceed) return;
    }

    try {
      if (editingEntryId) {
        await updateTimesheetEntry(editingEntryId, {
          clockIn,
          clockOut,
          breakMinutes: cleanBreak,
          allowOvernight,
          notes,
          editReason
        });
        showToast('ساعت کاری کارمند اصلاح شد و در تاریخچه ویرایش ثبت گردید.');
        cancelEditShift();
      } else {
        await addTimesheetEntry({
          employeeId,
          date: workDate,
          clockIn,
          clockOut,
          breakMinutes: cleanBreak,
          allowOvernight,
          notes
        });
        notes = '';
        showToast('ساعت ورود و خروج کارمند با موفقیت ثبت شد.');
      }
    } catch (err) {
      formError =
        err instanceof Error ? err.message : 'خطا در ثبت ساعت کاری.';
    }
  }

  async function handleDeleteShift(entry: TimesheetEntry) {
    const empName = $employeeByIdMap.get(entry.employeeId)?.name || 'کارمند';
    const confirmed = window.confirm(
      `آیا از حذف رکورد ساعت کاری «${empName}» در تاریخ ${toJalaliDate(entry.date)} مطمئن هستید؟`
    );
    if (!confirmed) return;
    await deleteTimesheetEntry(entry.id);
    showToast('رکورد حضور و غیاب حذف شد.');
  }
</script>

<section class="page active" aria-labelledby="timesheetsTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">حضور و غیاب، شیفت‌های کاری و مقایسه با برنامه مورد انتظار</p>
      <h1 id="timesheetsTitle">تایم‌شیت و ساعت کار کارکنان</h1>
      <p class="subheading">
        ثبت ساعت ورود، خروج و استراحت روزانه کارکنان به تاریخ شمسی با پشتیبانی از شیفت‌های شبانه (عبوری از نیمه‌شب).
      </p>
    </div>
  </div>

  <div class="entry-layout">
    <section class="panel form-panel">
      <div class="section-heading">
        <div>
          <h2>{editingEntryId ? 'اصلاح رکورد ساعت کاری' : 'ثبت ورود و خروج جدید'}</h2>
          <p>ساعت را به فرمت ۲۴ ساعته (مثلاً 08:00 تا 17:30) وارد کنید</p>
        </div>
        {#if editingEntryId}
          <button type="button" class="quiet-btn" on:click={cancelEditShift}>
            انصراف از ویرایش
          </button>
        {/if}
      </div>

      <form on:submit|preventDefault={handleSubmitTimesheet} novalidate>
        <div class="field-row">
          <div class="field">
            <label for="tsEmployee">انتخاب کارمند <b class="required">*</b></label>
            <select
              id="tsEmployee"
              bind:value={employeeId}
              disabled={Boolean(editingEntryId)}
              required
            >
              {#each $employees as emp (emp.id)}
                <option value={emp.id}>
                  {emp.name} ({emp.role}) {!emp.isActive ? '— غیرفعال' : ''}
                </option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="tsDate">تاریخ کاری (شمسی)</label>
            <JalaliDatePicker
              id="tsDate"
              bind:value={workDate}
              ariaLabel="تاریخ کاری شمسی"
            />
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="tsClockIn">ساعت ورود <b class="required">*</b></label>
            <input
              id="tsClockIn"
              type="text"
              dir="ltr"
              bind:value={clockIn}
              placeholder="08:00"
              required
            />
          </div>
          <div class="field">
            <label for="tsClockOut">ساعت خروج <b class="required">*</b></label>
            <input
              id="tsClockOut"
              type="text"
              dir="ltr"
              bind:value={clockOut}
              placeholder="17:30"
              required
            />
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="tsBreak">مدت استراحت (دقیقه)</label>
            <input
              id="tsBreak"
              inputmode="numeric"
              bind:value={breakMinutes}
              placeholder="مثلاً ۶۰"
            />
          </div>
          <div class="field" style="display: flex; align-items: center; padding-top: 22px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 0;">
              <input
                type="checkbox"
                bind:checked={allowOvernight}
                style="width: 18px; height: 18px;"
              />
              <span>شیفت شبانه (خروج پس از نیمه‌شب)</span>
            </label>
          </div>
        </div>

        {#if livePreview.isValid}
          <div class="demo-banner-box" style="margin-bottom: 14px; background: #eef5f0; border-color: #cfe0d4; color: #173d32;">
            <span>
              <strong>محاسبه خودکار کارکرد خالص:</strong>
              {formatMinutesToPersianHours(livePreview.netMinutes)}
              {livePreview.overnight ? '(شیفت عبوری از نیمه‌شب)' : ''}
            </span>
          </div>
        {/if}

        {#if overlapWarning}
          <div class="form-error" style="background: #fff8eb; color: #8a5a10;">
            توجه: در این تاریخ یک شیفت دیگر ({overlapWarning.clockIn} تا {overlapWarning.clockOut}) برای این کارمند ثبت شده است که با ساعت واردشده تداخل دارد.
          </div>
        {/if}

        {#if editingEntryId}
          <div class="field">
            <label for="tsEditReason">علت اصلاح ساعت کاری</label>
            <input
              id="tsEditReason"
              bind:value={editReason}
              placeholder="مثلاً فراموشی ثبت خروج یا اصلاح استراحت..."
            />
          </div>
        {/if}

        <div class="field">
          <label for="tsNotes">توضیحات شیفت</label>
          <input
            id="tsNotes"
            bind:value={notes}
            placeholder="توضیحات اختیاری درباره شیفت..."
          />
        </div>

        {#if formError}
          <div class="form-error" role="alert">{formError}</div>
        {/if}

        <button type="submit" class="primary-btn">
          <span>{editingEntryId ? 'ذخیره اصلاحیه تایم‌شیت' : 'ثبت ساعت کاری'}</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </section>

    <aside class="side-column">
      <section class="panel insight-card">
        <div class="card-topline">
          <span class="mini-icon">◫</span>
          <span>
            خلاصه کارکرد {selectedFilterEmployee ? selectedFilterEmployee.name : 'همه کارکنان'}
          </span>
        </div>
        <div class="stat-number" style="font-size: 22px;">
          {formatMinutesToPersianHours(summaryStats.totalWorkingMinutes)}
        </div>
        <p class="stat-caption">
          در <strong>{formatNumber(summaryStats.workingDaysCount)}</strong> روز کاری
          ({formatNumber(summaryStats.shiftsCount)} شیفت)
        </p>
        <div class="stat-divider"></div>
        <div class="stat-foot">
          <span>میانگین کارکرد روزانه</span>
          <strong>{formatMinutesToPersianHours(summaryStats.averageDailyMinutes)}</strong>
        </div>

        {#if selectedFilterEmployee && summaryStats.expectedTotalMinutes > 0}
          <div class="stat-divider" style="margin-top: 10px;"></div>
          <div style="margin-top: 10px; font-size: 10px; color: var(--muted); display: grid; gap: 4px;">
            <div>
              ساعت مورد انتظار طبق برنامه:
              <strong>{formatMinutesToPersianHours(summaryStats.expectedTotalMinutes)}</strong>
            </div>
            <div>
              تأخیر ورود:
              <strong>
                {formatNumber(summaryStats.lateArrivalsCount)} مورد ({formatMinutesToPersianHours(summaryStats.totalLateMinutes)})
              </strong>
            </div>
            <div>
              تعجیل خروج:
              <strong>
                {formatNumber(summaryStats.earlyDeparturesCount)} مورد ({formatMinutesToPersianHours(summaryStats.totalEarlyMinutes)})
              </strong>
            </div>
            <div>
              اضافه‌کاری:
              <strong style="color: var(--green);">
                {formatMinutesToPersianHours(summaryStats.totalOvertimeMinutes)}
              </strong>
            </div>
          </div>
        {/if}
      </section>

      <section class="tip-card">
        <span class="tip-icon">✳</span>
        <div>
          <strong>مقایسه برنامه کاری مورد انتظار با حضور واقعی</strong>
          <p>
            با انتخاب یک کارمند از فیلتر پایین، تأخیر ورود، تعجیل خروج و اضافه‌کاری او بر اساس برنامه کاری تعریف‌شده در بخش «کارکنان» محاسبه می‌شود.
          </p>
        </div>
      </section>
    </aside>
  </div>

  <section class="recent-section">
    <div class="panel history-panel">
      <div class="filters">
        <select
          bind:value={filterEmployeeId}
          style="width: auto; min-width: 180px; height: 42px; font-size: 11px;"
          aria-label="فیلتر کارمند در تایم‌شیت"
        >
          <option value="">همه کارکنان (نمای کلی)</option>
          {#each $employees as emp (emp.id)}
            <option value={emp.id}>{emp.name} — {emp.role}</option>
          {/each}
        </select>

        <div class="date-filter">
          <span>از تاریخ (شمسی)</span>
          <div class="date-picker-filter-wrap">
            <JalaliDatePicker
              id="tsFilterFrom"
              bind:value={filterDateFrom}
              placeholder="همه تاریخ‌ها"
              allowEmpty={true}
              ariaLabel="از تاریخ شمسی"
            />
          </div>
        </div>

        <div class="date-filter">
          <span>تا تاریخ (شمسی)</span>
          <div class="date-picker-filter-wrap">
            <JalaliDatePicker
              id="tsFilterTo"
              bind:value={filterDateTo}
              placeholder="همه تاریخ‌ها"
              allowEmpty={true}
              ariaLabel="تا تاریخ شمسی"
            />
          </div>
        </div>

        {#if filterEmployeeId || filterDateFrom || filterDateTo}
          <button
            type="button"
            class="quiet-btn"
            on:click={() => {
              filterEmployeeId = '';
              filterDateFrom = '';
              filterDateTo = '';
            }}
          >
            پاک کردن فیلترها
          </button>
        {/if}
      </div>

      <div class="history-summary">
        <span>{formatNumber(filteredTimesheets.length)} شیفت ثبت‌شده</span>
        <span>
          مجموع ساعت کاری: <strong>{formatMinutesToPersianHours(summaryStats.totalWorkingMinutes)}</strong>
        </span>
      </div>

      <div class="purchase-list">
        {#if filteredTimesheets.length > 0}
          {#each filteredTimesheets as entry (entry.id)}
            {@const emp = $employeeByIdMap.get(entry.employeeId)}
            {@const cmp = compareShiftWithExpectedSchedule(entry, emp)}
            <article class="purchase-item" style="flex-wrap: wrap;">
              <div class="product-avatar">{emp ? emp.name.charAt(0) : '؟'}</div>
              <div class="purchase-main">
                <div class="purchase-name">
                  <span>{emp ? emp.name : 'کارمند نامشخص'}</span>
                  <span class="badge-employee">
                    {getPersianWeekdayName(entry.date)} {toJalaliDate(entry.date)} ({toJalaliNumeric(entry.date)})
                  </span>
                  {#if entry.overnight}
                    <span class="badge-demo">شیفت شبانه</span>
                  {/if}
                  {#if entry.isDemo}
                    <span class="badge-demo">نمونه آزمایشی</span>
                  {:else}
                    <span class="badge-real">ثبت واقعی</span>
                  {/if}
                </div>
                <div class="purchase-meta">
                  <span>ورود: <strong dir="ltr">{entry.clockIn}</strong></span>
                  <span>خروج: <strong dir="ltr">{entry.clockOut}</strong></span>
                  <span>استراحت: {formatNumber(entry.breakMinutes)} دقیقه</span>
                  {#if cmp.hasExpectedSchedule}
                    {#if cmp.lateArrivalMinutes > 0}
                      <span style="color: var(--danger);">
                        تأخیر ورود: {formatNumber(cmp.lateArrivalMinutes)} دقیقه
                      </span>
                    {/if}
                    {#if cmp.overtimeMinutes > 0}
                      <span style="color: var(--green);">
                        اضافه‌کاری: {formatMinutesToPersianHours(cmp.overtimeMinutes)}
                      </span>
                    {/if}
                  {/if}
                  {#if entry.notes}
                    <span>({entry.notes})</span>
                  {/if}
                  {#if entry.editHistory && entry.editHistory.length > 0}
                    <span>(اصلاح‌شده: {formatNumber(entry.editHistory.length)} بار)</span>
                  {/if}
                </div>
              </div>

              <div class="purchase-side" style="display: flex; align-items: center; gap: 8px;">
                <div class="purchase-amount">
                  {formatMinutesToPersianHours(entry.netMinutes)}
                </div>
                <button
                  type="button"
                  class="quiet-btn"
                  on:click={() => startEditShift(entry)}
                >
                  اصلاح
                </button>
                <button
                  type="button"
                  class="quiet-btn"
                  on:click={() => handleDeleteShift(entry)}
                >
                  حذف
                </button>
              </div>
            </article>
          {/each}
        {:else}
          <EmptyState
            title="رکورد حضور و غیابی یافت نشد"
            message="از فرم بالا ساعت ورود و خروج کارکنان را ثبت کنید."
          />
        {/if}
      </div>
    </div>
  </section>
</section>
