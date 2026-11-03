<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    JALALI_MONTH_NAMES,
    JALALI_WEEKDAYS_SHORT,
    formatJalaliLong,
    formatJalaliNumeric,
    getJalaliMonthMatrix,
    isoToJalaliParts,
    jalaliPartsToISO,
    parseJalaliInputToISO,
    toPersianDigits
  } from '../../utils/jalali';
  import { getTodayISODate } from '../../utils/formatters';

  export let id: string = '';
  export let value: string = ''; // YYYY-MM-DD or ''
  export let placeholder: string = 'انتخاب تاریخ شمسی...';
  export let allowEmpty: boolean = false;
  export let ariaLabel: string = 'انتخاب تاریخ شمسی';

  const dispatch = createEventDispatcher<{ change: string }>();

  let isOpen = false;
  let pickerRoot: HTMLDivElement;
  let manualJalaliInput = '';
  let manualError = '';

  const todayISO = getTodayISODate();
  const todayParts = isoToJalaliParts(todayISO) || { jy: 1405, jm: 8, jd: 12 };

  let viewYear = todayParts.jy;
  let viewMonth = todayParts.jm;

  $: selectedParts = value ? isoToJalaliParts(value) : null;
  $: displayText = value
    ? `${formatJalaliLong(value)} (${formatJalaliNumeric(value)})`
    : '';
  $: calendarCells = getJalaliMonthMatrix(viewYear, viewMonth);

  const availableYears: number[] = [];
  for (let y = todayParts.jy - 10; y <= todayParts.jy + 5; y++) {
    availableYears.push(y);
  }

  function openPicker() {
    const base = selectedParts || isoToJalaliParts(getTodayISODate()) || todayParts;
    viewYear = base.jy;
    viewMonth = base.jm;
    manualJalaliInput = value ? formatJalaliNumeric(value) : '';
    manualError = '';
    isOpen = true;
  }

  function togglePicker() {
    if (isOpen) {
      isOpen = false;
    } else {
      openPicker();
    }
  }

  function prevMonth() {
    if (viewMonth === 1) {
      viewMonth = 12;
      viewYear -= 1;
    } else {
      viewMonth -= 1;
    }
  }

  function nextMonth() {
    if (viewMonth === 12) {
      viewMonth = 1;
      viewYear += 1;
    } else {
      viewMonth += 1;
    }
  }

  function selectDate(iso: string) {
    value = iso;
    manualJalaliInput = formatJalaliNumeric(iso);
    manualError = '';
    isOpen = false;
    dispatch('change', value);
  }

  function selectToday() {
    const today = getTodayISODate();
    selectDate(today);
  }

  function clearDate() {
    value = '';
    manualJalaliInput = '';
    manualError = '';
    isOpen = false;
    dispatch('change', '');
  }

  function applyManualJalali() {
    manualError = '';
    if (!manualJalaliInput.trim()) {
      if (allowEmpty) {
        clearDate();
        return;
      }
      manualError = 'تاریخ را به صورت ۱۴۰۵/۰۸/۱۲ وارد کنید.';
      return;
    }
    const iso = parseJalaliInputToISO(manualJalaliInput);
    if (!iso) {
      manualError = 'تاریخ شمسی واردشده معتبر نیست.';
      return;
    }
    selectDate(iso);
  }

  function handleWindowClick(event: MouseEvent) {
    if (!isOpen) return;
    const target = event.target as Node | null;
    if (pickerRoot && target && !pickerRoot.contains(target)) {
      isOpen = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && isOpen) {
      isOpen = false;
    }
  }
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleKeydown} />

<div class="jalali-picker" bind:this={pickerRoot}>
  <button
    type="button"
    {id}
    class="jalali-trigger"
    aria-label={ariaLabel}
    aria-haspopup="dialog"
    aria-expanded={isOpen}
    on:click={togglePicker}
  >
    <span class:placeholder={!displayText}>
      {displayText || placeholder}
    </span>
    <span class="calendar-icon">▦</span>
  </button>

  {#if isOpen}
    <div class="jalali-popover" role="dialog" aria-label="تقویم شمسی">
      <div class="jalali-header">
        <button
          type="button"
          class="jalali-nav-btn"
          title="ماه قبل"
          on:click={prevMonth}
        >
          →
        </button>

        <div class="jalali-selectors">
          <select
            aria-label="انتخاب ماه شمسی"
            bind:value={viewMonth}
            class="jalali-select"
          >
            {#each JALALI_MONTH_NAMES as mName, idx}
              <option value={idx + 1}>{mName}</option>
            {/each}
          </select>

          <select
            aria-label="انتخاب سال شمسی"
            bind:value={viewYear}
            class="jalali-select"
          >
            {#each availableYears as yr}
              <option value={yr}>{toPersianDigits(yr)}</option>
            {/each}
          </select>
        </div>

        <button
          type="button"
          class="jalali-nav-btn"
          title="ماه بعد"
          on:click={nextMonth}
        >
          ←
        </button>
      </div>

      <div class="jalali-weekdays">
        {#each JALALI_WEEKDAYS_SHORT as wd}
          <span>{wd}</span>
        {/each}
      </div>

      <div class="jalali-days-grid">
        {#each calendarCells as cell}
          {#if cell}
            <button
              type="button"
              class="jalali-day-btn"
              class:selected={cell.isoDate === value}
              class:today={cell.isoDate === todayISO}
              on:click={() => selectDate(cell.isoDate)}
            >
              {toPersianDigits(cell.jd)}
            </button>
          {:else}
            <span class="jalali-day-empty"></span>
          {/if}
        {/each}
      </div>

      <div class="jalali-manual-row">
        <input
          type="text"
          dir="ltr"
          class="jalali-manual-input"
          bind:value={manualJalaliInput}
          placeholder="۱۴۰۵/۰۸/۱۲"
          aria-label="ورود دستی تاریخ شمسی"
          on:keydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyManualJalali();
            }
          }}
        />
        <button type="button" class="quiet-btn" on:click={applyManualJalali}>
          اعمال
        </button>
      </div>

      {#if manualError}
        <div class="jalali-error">{manualError}</div>
      {/if}

      <div class="jalali-footer">
        <button type="button" class="secondary-btn" on:click={selectToday}>
          امروز ({formatJalaliNumeric(todayISO)})
        </button>
        {#if allowEmpty && value}
          <button type="button" class="quiet-btn" on:click={clearDate}>
            پاک کردن
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>
