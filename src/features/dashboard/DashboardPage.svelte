<script lang="ts">
  import {
    purchases,
    expenses,
    revenues,
    employeeByIdMap,
    resolvePurchaseEmployeeName,
    appSettings
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatReportingMoney,
    getCurrencyLabel,
    formatNumber,
    toJalaliDate,
    toJalaliNumeric,
    getTodayISODate
  } from '../../utils/formatters';
  import {
    formatJalaliDayMonth,
    formatJalaliYearMonthLabel,
    getJalaliMonthLength,
    getJalaliYearMonthKey,
    getPersianWeekdayName,
    isoToJalaliParts,
    jalaliPartsToISO
  } from '../../utils/jalali';
  import {
    getEffectiveDayRevenue,
    sortPurchasesDescending
  } from '../../utils/calculations';
  import type {
    Expense,
    Purchase,
    ReportingCurrency,
    RevenueDayRecord
  } from '../../models/types';
  import ColumnChart, { type ColumnChartItem } from '../../components/common/ColumnChart.svelte';

  type AnalyticsPeriod = '7d' | '30d' | 'current_month';

  const todayISO = getTodayISODate();
  const currentMonthKey = getJalaliYearMonthKey(todayISO);
  const currentMonthLabel = formatJalaliYearMonthLabel(currentMonthKey);
  const todayJalali = `${getPersianWeekdayName(todayISO)} ${formatJalaliDayMonth(todayISO)} (${toJalaliNumeric(todayISO)})`;

  let selectedPeriod: AnalyticsPeriod = '7d';

  $: repCurr = ($appSettings.reportingCurrency || 'TOMAN') as ReportingCurrency;
  $: currLabel = getCurrencyLabel(repCurr);
  $: scaleMultiplier = repCurr === 'RIAL' ? 10 : 1;

  $: periodTitle =
    selectedPeriod === '7d'
      ? '۷ روز گذشته'
      : selectedPeriod === '30d'
        ? '۳۰ روز گذشته'
        : `ماه جاری (${currentMonthLabel})`;

  // Build the list of ISO dates (oldest to newest) for the selected period
  $: activePeriodISOs = (() => {
    if (selectedPeriod === 'current_month') {
      const parts = isoToJalaliParts(todayISO);
      if (parts) {
        const days: string[] = [];
        for (let jd = 1; jd <= parts.jd; jd++) {
          const iso = jalaliPartsToISO(parts.jy, parts.jm, jd);
          if (iso) days.push(iso);
        }
        if (days.length > 0) return days;
      }
    }

    const totalDays = selectedPeriod === '30d' ? 30 : 7;
    const days: string[] = [];
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(getTodayISODate(d));
    }
    return days;
  })();

  // Chart 1: Selected Period Income Day-by-Day
  $: periodIncomeColumns = activePeriodISOs.map((iso: string): ColumnChartItem => {
    const revRec = $revenues.find((r: RevenueDayRecord) => r.date === iso && !r.isDemo);
    const incomeVal = revRec ? getEffectiveDayRevenue(revRec) : 0;
    return {
      id: `inc_${selectedPeriod}_${iso}`,
      label: getPersianWeekdayName(iso),
      subLabel: toJalaliNumeric(iso).slice(5),
      value: incomeVal * scaleMultiplier,
      tone: 'primary'
    };
  });

  $: periodIncomeTotalToman = activePeriodISOs.reduce((sum: number, iso: string) => {
    const revRec = $revenues.find((r: RevenueDayRecord) => r.date === iso && !r.isDemo);
    return sum + (revRec ? getEffectiveDayRevenue(revRec) : 0);
  }, 0);

  // Chart 2: Selected Period Spendings Day-by-Day (Purchases + Expenses)
  $: periodSpendingColumns = activePeriodISOs.map((iso: string): ColumnChartItem => {
    const dayPurchSum = $purchases
      .filter((p: Purchase) => p.purchaseDate === iso && !p.isDemo)
      .reduce((s: number, p: Purchase) => s + (Number(p.totalAmount) || 0), 0);
    const dayExpSum = $expenses
      .filter((e: Expense) => e.expenseDate === iso && !e.isDemo)
      .reduce((s: number, e: Expense) => s + (Number(e.amount) || 0), 0);
    return {
      id: `spd_${selectedPeriod}_${iso}`,
      label: getPersianWeekdayName(iso),
      subLabel: toJalaliNumeric(iso).slice(5),
      value: (dayPurchSum + dayExpSum) * scaleMultiplier,
      tone: 'danger'
    };
  });

  $: periodSpendingTotalToman = activePeriodISOs.reduce((sum: number, iso: string) => {
    const dayPurchSum = $purchases
      .filter((p: Purchase) => p.purchaseDate === iso && !p.isDemo)
      .reduce((s: number, p: Purchase) => s + (Number(p.totalAmount) || 0), 0);
    const dayExpSum = $expenses
      .filter((e: Expense) => e.expenseDate === iso && !e.isDemo)
      .reduce((s: number, e: Expense) => s + (Number(e.amount) || 0), 0);
    return sum + dayPurchSum + dayExpSum;
  }, 0);

  $: periodNetToman = periodIncomeTotalToman - periodSpendingTotalToman;

  // Table rows shown newest-first for easy reading on 30-day & current-month views
  $: tablePeriodISOs = [...activePeriodISOs].reverse();

  // Available Jalali months across purchases, revenues, and expenses (plus current month)
  $: availableMonths = (() => {
    const set = new Set<string>();
    if (currentMonthKey) set.add(currentMonthKey);
    for (const p of $purchases) {
      if (!p.isDemo) {
        const ym = getJalaliYearMonthKey(p.purchaseDate);
        if (ym) set.add(ym);
      }
    }
    for (const r of $revenues) {
      if (!r.isDemo) {
        const ym = getJalaliYearMonthKey(r.date);
        if (ym) set.add(ym);
      }
    }
    for (const e of $expenses) {
      if (!e.isDemo) {
        const ym = getJalaliYearMonthKey(e.expenseDate);
        if (ym) set.add(ym);
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  })();

  let selectedExportMonth = currentMonthKey;
  $: if (!selectedExportMonth && availableMonths.length > 0) {
    selectedExportMonth = availableMonths[0];
  }

  // Monthly Report Data for Selected Month (automatically handles mid-month up to today)
  $: monthlyReportData = (() => {
    const ym = selectedExportMonth || currentMonthKey;
    const isCurrentMonth = ym === currentMonthKey;
    const todayParts = isoToJalaliParts(todayISO);
    const [jyStr, jmStr] = (ym || '1405/08').split('/');
    const jy = Number(jyStr) || 1405;
    const jm = Number(jmStr) || 8;
    const totalDaysInMonth = getJalaliMonthLength(jy, jm);
    const elapsedDays =
      isCurrentMonth && todayParts ? todayParts.jd : totalDaysInMonth;

    const monthPurchases = sortPurchasesDescending(
      $purchases.filter(
        (p: Purchase) =>
          !p.isDemo &&
          getJalaliYearMonthKey(p.purchaseDate) === ym &&
          (!isCurrentMonth || p.purchaseDate <= todayISO)
      )
    );

    const monthExpenses = $expenses.filter(
      (e: Expense) =>
        !e.isDemo &&
        getJalaliYearMonthKey(e.expenseDate) === ym &&
        (!isCurrentMonth || e.expenseDate <= todayISO)
    );

    const monthRevenues = $revenues.filter(
      (r: RevenueDayRecord) =>
        !r.isDemo &&
        getJalaliYearMonthKey(r.date) === ym &&
        (!isCurrentMonth || r.date <= todayISO)
    );

    const totalPurchasesToman = monthPurchases.reduce(
      (s: number, p: Purchase) => s + (Number(p.totalAmount) || 0),
      0
    );
    const totalExpensesToman = monthExpenses.reduce(
      (s: number, e: Expense) => s + (Number(e.amount) || 0),
      0
    );
    const totalRevenueToman = monthRevenues.reduce(
      (s: number, r: RevenueDayRecord) => s + getEffectiveDayRevenue(r),
      0
    );
    const totalSpendingsToman = totalPurchasesToman + totalExpensesToman;
    const netBalanceToman = totalRevenueToman - totalSpendingsToman;

    return {
      ym,
      monthLabel: formatJalaliYearMonthLabel(ym),
      isCurrentMonth,
      elapsedDays,
      totalDaysInMonth,
      periodSubtitle: isCurrentMonth
        ? `گزارش میان‌دوره: ۱ تا ${formatNumber(elapsedDays)} ${formatJalaliYearMonthLabel(ym)} (${formatNumber(elapsedDays)} روز سپری‌شده)`
        : `گزارش کامل ماه: ۱ تا ${formatNumber(totalDaysInMonth)} ${formatJalaliYearMonthLabel(ym)}`,
      monthPurchases,
      monthExpenses,
      monthRevenues,
      totalPurchasesToman,
      totalExpensesToman,
      totalSpendingsToman,
      totalRevenueToman,
      netBalanceToman,
      avgDailyRevenueToman:
        elapsedDays > 0 ? Math.round(totalRevenueToman / elapsedDays) : 0,
      avgDailySpendingToman:
        elapsedDays > 0 ? Math.round(totalSpendingsToman / elapsedDays) : 0
    };
  })();

  function escapeHtml(str: string): string {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function handleExportMonthlyPDF() {
    const rpt = monthlyReportData;
    const purchaseRowsHtml =
      rpt.monthPurchases.length > 0
        ? rpt.monthPurchases
            .map((p: Purchase, idx: number) => {
              const empName = resolvePurchaseEmployeeName(p, $employeeByIdMap);
              return `
                <tr>
                  <td>${formatNumber(idx + 1)}</td>
                  <td><strong>${escapeHtml(p.productName)}</strong></td>
                  <td>${formatNumber(p.quantity)} ${escapeHtml(p.unit)}</td>
                  <td>${formatJalaliDayMonth(p.purchaseDate)} (${toJalaliNumeric(p.purchaseDate)})</td>
                  <td>${escapeHtml(empName)}</td>
                  <td>${escapeHtml(p.supplierName || '—')}</td>
                  <td><strong>${formatReportingMoney(p.totalAmount, repCurr)} ${currLabel}</strong></td>
                </tr>
              `;
            })
            .join('')
        : `<tr><td colspan="7" style="text-align:center; padding: 18px;">هیچ خریدی در این ماه ثبت نشده است.</td></tr>`;

    const expenseRowsHtml =
      rpt.monthExpenses.length > 0
        ? rpt.monthExpenses
            .map(
              (e: Expense, idx: number) => `
                <tr>
                  <td>${formatNumber(idx + 1)}</td>
                  <td><strong>${escapeHtml(e.title)}</strong></td>
                  <td>${escapeHtml(e.category)}</td>
                  <td>${formatJalaliDayMonth(e.expenseDate)} (${toJalaliNumeric(e.expenseDate)})</td>
                  <td><strong>${formatReportingMoney(e.amount, repCurr)} ${currLabel}</strong></td>
                </tr>
              `
            )
            .join('')
        : '';

    const htmlContent = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>گزارش ماهانه گیله‌کرد — ${escapeHtml(rpt.monthLabel)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; font-family: Vazirmatn, IRANSansX, Tahoma, Arial, sans-serif; }
    body { margin: 0; padding: 0; direction: rtl; color: #1b2621; background: #fff; font-size: 11.5px; }
    .header { background: #173f35; color: #fff; padding: 18px 22px; border-radius: 14px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header h1 { margin: 0; font-size: 20px; }
    .header p { margin: 5px 0 0; font-size: 11px; opacity: 0.9; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
    .kpi { border: 1px solid #d5dfd8; border-radius: 12px; padding: 12px; background: #f8faf8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .kpi span { display: block; font-size: 10px; color: #5b6b61; font-weight: bold; }
    .kpi strong { display: block; font-size: 15px; color: #173f35; margin-top: 6px; }
    .kpi small { display: block; font-size: 9.5px; color: #6e7d74; margin-top: 4px; }
    h2 { font-size: 14px; color: #173f35; border-bottom: 2px solid #173f35; padding-bottom: 6px; margin: 18px 0 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 16px; }
    th { background: #eaf1ec; color: #173f35; padding: 8px; text-align: right; border: 1px solid #cfe0d4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { padding: 7px 8px; border: 1px solid #e1e8e3; }
    tr:nth-child(even) td { background: #fbfcfa; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .footer-sum { display: flex; justify-content: space-between; padding: 12px 16px; background: #eaf1ec; border-radius: 10px; font-weight: bold; color: #173f35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>گزارش تحلیل و فهرست خرید ماهانه — کافه گیله‌کُرد</h1>
      <p>${escapeHtml(rpt.periodSubtitle)} | واحد مبالغ: ${escapeHtml(currLabel)}</p>
    </div>
    <div style="text-align: left; font-size: 11px;">
      <div>تاریخ استخراج: ${toJalaliDate(todayISO)}</div>
      <div>(${toJalaliNumeric(todayISO)})</div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi">
      <span>مجموع درآمد ماه</span>
      <strong>${formatReportingMoney(rpt.totalRevenueToman, repCurr)} ${currLabel}</strong>
      <small>میانگین روزانه: ${formatReportingMoney(rpt.avgDailyRevenueToman, repCurr)} ${currLabel}</small>
    </div>
    <div class="kpi">
      <span>مجموع خریدها (${formatNumber(rpt.monthPurchases.length)} فاکتور)</span>
      <strong>${formatReportingMoney(rpt.totalPurchasesToman, repCurr)} ${currLabel}</strong>
      <small>کالاها و ملزومات خریداری‌شده</small>
    </div>
    <div class="kpi">
      <span>هزینه‌های جاری (${formatNumber(rpt.monthExpenses.length)} مورد)</span>
      <strong>${formatReportingMoney(rpt.totalExpensesToman, repCurr)} ${currLabel}</strong>
      <small>مجموع کل مخارج: ${formatReportingMoney(rpt.totalSpendingsToman, repCurr)} ${currLabel}</small>
    </div>
    <div class="kpi">
      <span>تراز خالص ماه</span>
      <strong style="color: ${rpt.netBalanceToman >= 0 ? '#173f35' : '#b9574d'};">
        ${formatReportingMoney(rpt.netBalanceToman, repCurr)} ${currLabel}
      </strong>
      <small>درآمد منهای کل مخارج</small>
    </div>
  </div>

  <h2>فهرست کامل اقلام خریداری‌شده در ${escapeHtml(rpt.monthLabel)} (${formatNumber(rpt.monthPurchases.length)} ردیف)</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>نام محصول</th>
        <th>مقدار و واحد</th>
        <th>تاریخ خرید</th>
        <th>خرید توسط</th>
        <th>فروشنده</th>
        <th>مبلغ (${escapeHtml(currLabel)})</th>
      </tr>
    </thead>
    <tbody>
      ${purchaseRowsHtml}
    </tbody>
  </table>

  <div class="footer-sum">
    <span>جمع کل خریدهای ${escapeHtml(rpt.monthLabel)}: ${formatNumber(rpt.monthPurchases.length)} فاکتور</span>
    <span>${formatReportingMoney(rpt.totalPurchasesToman, repCurr)} ${currLabel}</span>
  </div>

  ${
    rpt.monthExpenses.length > 0
      ? `
        <h2>فهرست هزینه‌های جاری در ${escapeHtml(rpt.monthLabel)} (${formatNumber(rpt.monthExpenses.length)} ردیف)</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>عنوان هزینه</th>
              <th>دسته‌بندی</th>
              <th>تاریخ</th>
              <th>مبلغ (${escapeHtml(currLabel)})</th>
            </tr>
          </thead>
          <tbody>
            ${expenseRowsHtml}
          </tbody>
        </table>
      `
      : ''
  }

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 250);
    };
  <\/script>
</body>
</html>`;

    const printWin = window.open('', '_blank');
    if (!printWin) {
      showToast('لطفاً باز شدن پنجره پاپ‌آپ (Pop-up) را در مرورگر مجاز کنید.');
      return;
    }
    printWin.document.open();
    printWin.document.write(htmlContent);
    printWin.document.close();
  }

  function handleExportMonthlyImage() {
    const rpt = monthlyReportData;
    const rows = rpt.monthPurchases;
    const rowHeight = 36;
    const baseHeight = 410;
    const canvasWidth = 1080;
    const canvasHeight = Math.max(
      620,
      baseHeight + Math.max(1, rows.length) * rowHeight + 80
    );

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.direction = 'rtl';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#f4f2eb';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.fillStyle = '#173f35';
    ctx.fillRect(30, 26, canvasWidth - 60, 105);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px Vazirmatn, Tahoma, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`گزارش ماهانه گیله‌کُرد — ${rpt.monthLabel}`, canvasWidth - 56, 62);

    ctx.fillStyle = '#d6c39e';
    ctx.font = '15px Vazirmatn, Tahoma, Arial, sans-serif';
    ctx.fillText(
      `${rpt.periodSubtitle}   |   واحد مبالغ: ${currLabel}`,
      canvasWidth - 56,
      102
    );

    const kpiItems = [
      {
        title: 'مجموع درآمد ماه',
        val: `${formatReportingMoney(rpt.totalRevenueToman, repCurr)} ${currLabel}`
      },
      {
        title: `کل خریدها (${formatNumber(rows.length)} فاکتور)`,
        val: `${formatReportingMoney(rpt.totalPurchasesToman, repCurr)} ${currLabel}`
      },
      {
        title: `هزینه‌های جاری (${formatNumber(rpt.monthExpenses.length)} مورد)`,
        val: `${formatReportingMoney(rpt.totalExpensesToman, repCurr)} ${currLabel}`
      },
      {
        title: 'تراز خالص ماه',
        val: `${formatReportingMoney(rpt.netBalanceToman, repCurr)} ${currLabel}`
      }
    ];

    const boxW = (canvasWidth - 60 - 36) / 4;
    kpiItems.forEach((item, i) => {
      const x = canvasWidth - 30 - (i + 1) * boxW - i * 12;
      const y = 150;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, boxW, 92);
      ctx.strokeStyle = '#d5dfd8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, boxW, 92);

      ctx.fillStyle = '#627168';
      ctx.font = 'bold 13px Vazirmatn, Tahoma, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(item.title, x + boxW - 14, y + 30);

      ctx.fillStyle = '#173f35';
      ctx.font = 'bold 17px Vazirmatn, Tahoma, Arial, sans-serif';
      ctx.fillText(item.val, x + boxW - 14, y + 66);
    });

    ctx.fillStyle = '#173f35';
    ctx.font = 'bold 19px Vazirmatn, Tahoma, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `فهرست اقلام خریداری‌شده در ${rpt.monthLabel} (${formatNumber(rows.length)} مورد)`,
      canvasWidth - 34,
      276
    );

    const tableTop = 304;
    ctx.fillStyle = '#eaf1ec';
    ctx.fillRect(30, tableTop, canvasWidth - 60, 40);
    ctx.fillStyle = '#173f35';
    ctx.font = 'bold 14px Vazirmatn, Tahoma, Arial, sans-serif';

    ctx.textAlign = 'right';
    ctx.fillText('ردیف و نام کالا', canvasWidth - 46, tableTop + 20);
    ctx.fillText('مقدار', canvasWidth - 380, tableTop + 20);
    ctx.fillText('تاریخ خرید', canvasWidth - 530, tableTop + 20);
    ctx.fillText('مسئول خرید', canvasWidth - 720, tableTop + 20);
    ctx.textAlign = 'left';
    ctx.fillText(`مبلغ (${currLabel})`, 48, tableTop + 20);

    if (rows.length === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(30, tableTop + 42, canvasWidth - 60, 50);
      ctx.fillStyle = '#77837b';
      ctx.textAlign = 'center';
      ctx.font = '15px Vazirmatn, Tahoma, Arial, sans-serif';
      ctx.fillText('هیچ خریدی در این ماه ثبت نشده است.', canvasWidth / 2, tableTop + 67);
    } else {
      rows.forEach((p: Purchase, idx: number) => {
        const ry = tableTop + 42 + idx * rowHeight;
        ctx.fillStyle = idx % 2 === 0 ? '#ffffff' : '#fafaf6';
        ctx.fillRect(30, ry, canvasWidth - 60, rowHeight);

        ctx.fillStyle = '#202b26';
        ctx.font = '13.5px Vazirmatn, Tahoma, Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(
          `${formatNumber(idx + 1)}. ${p.productName}`,
          canvasWidth - 46,
          ry + rowHeight / 2
        );
        ctx.fillText(
          `${formatNumber(p.quantity)} ${p.unit}`,
          canvasWidth - 380,
          ry + rowHeight / 2
        );
        ctx.fillText(
          toJalaliNumeric(p.purchaseDate),
          canvasWidth - 530,
          ry + rowHeight / 2
        );
        ctx.fillText(
          resolvePurchaseEmployeeName(p, $employeeByIdMap),
          canvasWidth - 720,
          ry + rowHeight / 2
        );

        ctx.fillStyle = '#173f35';
        ctx.font = 'bold 14px Vazirmatn, Tahoma, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(
          `${formatReportingMoney(p.totalAmount, repCurr)}`,
          48,
          ry + rowHeight / 2
        );
      });
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gileh-kord-report-${rpt.ym.replace('/', '-')}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`تصویر گزارش ماه ${rpt.monthLabel} دانلود شد.`);
    }, 'image/png');
  }
</script>

<section class="page active dashboard-page" aria-labelledby="dashboardTitle">
  <!-- Green Welcome Space -->
  <header class="dashboard-hero">
    <div>
      <p class="eyebrow">پیشخوان مدیریت کافه</p>
      <h1 id="dashboardTitle">خوش آمدید به گیله‌کُرد</h1>
      <p>تحلیل روزبه‌روز درآمد و مخارج (۷ روزه، ۳۰ روزه و ماه جاری) و خروجی گزارش ماهانه.</p>
    </div>
    <div class="dashboard-hero-date">▦ &nbsp; {todayJalali}</div>
  </header>

  <!-- Monthly Report Export Bar (PDF or PNG Image for any chosen month) -->
  <section class="panel card-pad" style="margin-bottom: 16px;">
    <div class="section-heading" style="margin-bottom: 12px;">
      <div>
        <h2>خروجی گزارش تحلیل ماهانه و فهرست خریدها (PDF / تصویر)</h2>
        <p>{monthlyReportData.periodSubtitle}</p>
      </div>
    </div>

    <div class="filters" style="margin-bottom: 0;">
      <div class="date-filter">
        <span>انتخاب ماه شمسی:</span>
        <select
          bind:value={selectedExportMonth}
          style="width: auto; min-width: 185px; height: 42px; font-size: 12px; font-weight: 700;"
          aria-label="انتخاب ماه گزارش"
        >
          {#each availableMonths as ym (ym)}
            <option value={ym}>
              {formatJalaliYearMonthLabel(ym)}
              {ym === currentMonthKey ? '(ماه جاری — تا امروز)' : ''}
            </option>
          {/each}
        </select>
      </div>

      <button
        type="button"
        class="primary-btn"
        style="width: auto; min-height: 42px; padding: 0 18px;"
        on:click={handleExportMonthlyPDF}
      >
        <span>🖨 دریافت PDF ماهانه (تحلیل + لیست خرید)</span>
      </button>

      <button
        type="button"
        class="secondary-btn"
        style="min-height: 42px; padding: 0 16px;"
        on:click={handleExportMonthlyImage}
      >
        <span>🖼 ذخیره تصویر گزارش (PNG)</span>
      </button>
    </div>
  </section>

  <!-- Period Toggle Bar: 7 Days / 30 Days / Current Jalali Month -->
  <section class="panel card-pad" style="margin-bottom: 16px;">
    <div class="section-heading" style="margin-bottom: 12px;">
      <div>
        <h2>بازه زمانی تحلیل نمودارها و جدول: {periodTitle}</h2>
        <p>
          تعداد روزهای دوره: <strong>{formatNumber(activePeriodISOs.length)} روز</strong>
          | تراز خالص دوره:
          <strong style="color: {periodNetToman >= 0 ? 'var(--green)' : 'var(--danger)'};">
            {formatReportingMoney(periodNetToman, repCurr)} {currLabel}
          </strong>
        </p>
      </div>

      <div class="setting-actions">
        <button
          type="button"
          class={selectedPeriod === '7d' ? 'secondary-btn' : 'quiet-btn'}
          on:click={() => (selectedPeriod = '7d')}
        >
          {selectedPeriod === '7d' ? '● ' : ''}۷ روز گذشته
        </button>

        <button
          type="button"
          class={selectedPeriod === '30d' ? 'secondary-btn' : 'quiet-btn'}
          on:click={() => (selectedPeriod = '30d')}
        >
          {selectedPeriod === '30d' ? '● ' : ''}۳۰ روز گذشته
        </button>

        <button
          type="button"
          class={selectedPeriod === 'current_month' ? 'secondary-btn' : 'quiet-btn'}
          on:click={() => (selectedPeriod = 'current_month')}
        >
          {selectedPeriod === 'current_month' ? '● ' : ''}ماه جاری ({currentMonthLabel})
        </button>
      </div>
    </div>
  </section>

  <!-- Income & Spendings Charts for Selected Period -->
  <div class="two-col-grid" style="margin-bottom: 16px;">
    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>درآمد {periodTitle} (روزبه‌روز)</h2>
          <p>
            مجموع درآمد دوره:
            <strong>{formatReportingMoney(periodIncomeTotalToman, repCurr)} {currLabel}</strong>
          </p>
        </div>
      </div>
      <ColumnChart items={periodIncomeColumns} height={210} unitLabel={currLabel} />
    </section>

    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>کل مخارج {periodTitle} (روزبه‌روز)</h2>
          <p>
            مجموع خریدها و هزینه‌های دوره:
            <strong>{formatReportingMoney(periodSpendingTotalToman, repCurr)} {currLabel}</strong>
          </p>
        </div>
      </div>
      <ColumnChart items={periodSpendingColumns} height={210} unitLabel={currLabel} />
    </section>
  </div>

  <!-- Day-by-Day Breakdown Table for Selected Period -->
  <section class="panel card-pad">
    <div class="section-heading">
      <h2>جدول تفکیکی {periodTitle} ({currLabel})</h2>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>روز و تاریخ</th>
            <th>درآمد روز ({currLabel})</th>
            <th>کل مخارج روز (خرید + هزینه)</th>
            <th>مانده روز</th>
          </tr>
        </thead>
        <tbody>
          {#each tablePeriodISOs as iso (iso)}
            {@const revRec = $revenues.find(
              (r: RevenueDayRecord) => r.date === iso && !r.isDemo
            )}
            {@const dayIncToman = revRec ? getEffectiveDayRevenue(revRec) : 0}
            {@const dayPurchToman = $purchases
              .filter((p: Purchase) => p.purchaseDate === iso && !p.isDemo)
              .reduce((s: number, p: Purchase) => s + (Number(p.totalAmount) || 0), 0)}
            {@const dayExpToman = $expenses
              .filter((e: Expense) => e.expenseDate === iso && !e.isDemo)
              .reduce((s: number, e: Expense) => s + (Number(e.amount) || 0), 0)}
            {@const daySpdToman = dayPurchToman + dayExpToman}
            {@const dayNetToman = dayIncToman - daySpdToman}
            <tr>
              <td>
                <strong>{getPersianWeekdayName(iso)}</strong>
                ({toJalaliNumeric(iso)})
              </td>
              <td>
                <strong style="color: var(--green);">
                  {formatReportingMoney(dayIncToman, repCurr)}
                </strong>
              </td>
              <td>
                <strong style="color: var(--danger);">
                  {formatReportingMoney(daySpdToman, repCurr)}
                </strong>
              </td>
              <td
                style="color: {dayNetToman >= 0
                  ? 'var(--green)'
                  : 'var(--danger)'}; font-weight: 800;"
              >
                {formatReportingMoney(dayNetToman, repCurr)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</section>
