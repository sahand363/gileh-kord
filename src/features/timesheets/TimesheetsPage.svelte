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
        `برای این کارمند در تاریخ ${toJalaliDate(workDate)} شیفت دیگری (${overlapWarning.clockIn} تا ${overlapWarning.clockOut}) ثبت شده است. ثبت شود؟`
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
        showToast('ساعت کاری اصلاح شد.');
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
        showToast('ساعت کاری ثبت شد.');
      }
    } catch (err) {
      formError =
        err instanceof Error ? err.message : 'خطا در ثبت ساعت کاری.';
    }
  }

  async function handleDeleteShift(entry: TimesheetEntry) {
    const empName = $employeeByIdMap.get(entry.employeeId)?.name || 'کارمند';
    const confirmed = window.confirm(
      `حذف رکورد ساعت کاری «${empName}» در تاریخ ${toJalaliDate(entry.date)}؟`
    );
    if (!confirmed) return;
    await deleteTimesheetEntry(entry.id);
    showToast('رکورد حذف شد.');
  }
</script>

<section class="page active" aria-labelledby="timesheetsTitle">
  <div class="page-heading">
    <h1 id="timesheetsTitle">تایم‌شیت</h1>
  </div>

  <div class="entry-layout">
    <section class="panel form-panel">
      <div class="section-heading">
        <h2>{editingEntryId ? 'اصلاح ساعت کاری' : 'ثبت ساعت کاری'}</h2>
        {#if editingEntryId}
          <button type="button" class="quiet-btn" on:click={cancelEditShift}>
            انصراف
          </button>
        {/if}
      </div>

      <form on:submit|preventDefault={handleSubmitTimesheet} novalidate>
        <div class="field-row">
          <div class="field">
            <label for="tsEmployee">کارمند <b class="required">*</b></label>
            <select
              id="tsEmployee"
              bind:value={employeeId}
              disabled={Boolean(editingEntryId)}
              required
            >
              {#each $employees as emp (emp.id)}
                <option value={emp.id}>
                  {emp.name} {!emp.isActive ? '(غیرفعال)' : ''}
                </option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="tsDate">تاریخ</label>
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
            <label for="tsBreak">استراحت (دقیقه)</label>
            <input
              id="tsBreak"
              inputmode="numeric"
              bind:value={breakMinutes}
              placeholder="۶۰"
            />
          </div>
          <div class="field" style="display: flex; align-items: center; padding-top: 22px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 0;">
              <input
                type="checkbox"
                bind:checked={allowOvernight}
                style="width: 18px; height: 18px;"
              />
              <span>شیفت شبانه</span>
            </label>
          </div>
        </div>

        {#if livePreview.isValid}
          <div class="demo-banner-box" style="margin-bottom: 14px; background: #eef5f0; border-color: #cfe0d4; color: #173d32;">
            <span>
              <strong>کارکرد خالص:</strong>
              {formatMinutesToPersianHours(livePreview.netMinutes)}
            </span>
          </div>
        {/if}

        {#if editingEntryId}
          <div class="field">
            <label for="tsEditReason">علت اصلاح</label>
            <input id="tsEditReason" bind:value={editReason} />
          </div>
        {/if}

        <div class="field">
          <label for="tsNotes">توضیحات</label>
          <input id="tsNotes" bind:value={notes} />
        </div>

        {#if formError}
          <div class="form-error" role="alert">{formError}</div>
        {/if}

        <button type="submit" class="primary-btn">
          <span>{editingEntryId ? 'ذخیره' : 'ثبت'}</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </section>

    <aside class="side-column">
      <section class="panel insight-card">
        <div class="card-topline">
          <span class="mini-icon">◷</span>
          <span>مجموع کارکرد</span>
        </div>
        <div class="stat-number" style="font-size: 22px;">
          {formatMinutesToPersianHours(summaryStats.totalWorkingMinutes)}
        </div>
        <p class="stat-caption">
          <strong>{formatNumber(summaryStats.workingDaysCount)}</strong> روز کاری
        </p>
      </section>
    </aside>
  </div>

  <section class="recent-section">
    <div class="panel history-panel">
      <div class="filters">
        <select
          bind:value={filterEmployeeId}
          style="width: auto; min-width: 170px; height: 42px; font-size: 11px;"
          aria-label="فیلتر کارمند"
        >
          <option value="">همه کارکنان</option>
          {#each $employees as emp (emp.id)}
            <option value={emp.id}>{emp.name}</option>
          {/each}
        </select>

        <div class="date-filter">
          <span>از تاریخ</span>
          <div class="date-picker-filter-wrap">
            <JalaliDatePicker
              id="tsFilterFrom"
              bind:value={filterDateFrom}
              placeholder="همه تاریخ‌ها"
              allowEmpty={true}
            />
          </div>
        </div>

        <div class="date-filter">
          <span>تا تاریخ</span>
          <div class="date-picker-filter-wrap">
            <JalaliDatePicker
              id="tsFilterTo"
              bind:value={filterDateTo}
              placeholder="همه تاریخ‌ها"
              allowEmpty={true}
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
            پاک کردن
          </button>
        {/if}
      </div>

      <div class="purchase-list" style="margin-top: 14px;">
        {#if filteredTimesheets.length > 0}
          {#each filteredTimesheets as entry (entry.id)}
            {@const emp = $employeeByIdMap.get(entry.employeeId)}
            <article class="purchase-item" style="flex-wrap: wrap;">
              <div class="product-avatar">{emp ? emp.name.charAt(0) : '؟'}</div>
              <div class="purchase-main">
                <div class="purchase-name">
                  <span>{emp ? emp.name : 'کارمند'}</span>
                  <span class="badge-employee">
                    {getPersianWeekdayName(entry.date)} {toJalaliDate(entry.date)} ({toJalaliNumeric(entry.date)})
                  </span>
                </div>
                <div class="purchase-meta">
                  <span>ورود: <strong dir="ltr">{entry.clockIn}</strong></span>
                  <span>خروج: <strong dir="ltr">{entry.clockOut}</strong></span>
                  <span>استراحت: {formatNumber(entry.breakMinutes)} دقیقه</span>
                </div>
              </div>

              <div class="purchase-side" style="display: flex; align-items: center; gap: 8px;">
                <div class="purchase-amount">
                  {formatMinutesToPersianHours(entry.netMinutes)}
                </div>
                <button type="button" class="quiet-btn" on:click={() => startEditShift(entry)}>
                  ویرایش
                </button>
                <button type="button" class="quiet-btn" on:click={() => handleDeleteShift(entry)}>
                  حذف
                </button>
              </div>
            </article>
          {/each}
        {:else}
          <EmptyState title="رکوردی یافت نشد" message="هنوز ساعت کاری ثبت نشده است." />
        {/if}
      </div>
    </div>
  </section>
</section>
