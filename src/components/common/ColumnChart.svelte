<script lang="ts">
  import { formatMoney } from '../../utils/formatters';

  export interface ColumnChartItem {
    id: string;
    label: string;
    subLabel?: string;
    value: number;
    secondaryValue?: number;
    tone?: 'primary' | 'gold' | 'danger';
  }

  export let items: ColumnChartItem[] = [];
  export let height: number = 185;
  export let unitLabel: string = 'تومان';
  export let primaryLegend: string = '';
  export let secondaryLegend: string = '';
  export let showSecondary: boolean = false;

  $: maxValue =
    items.length > 0
      ? Math.max(
          1,
          ...items.map((item) =>
            Math.max(
              Number(item.value) || 0,
              showSecondary ? Number(item.secondaryValue) || 0 : 0
            )
          )
        )
      : 1;

  function calcPercent(val: number | undefined): number {
    const num = Math.abs(Number(val) || 0);
    if (num === 0) return 4;
    return Math.max(8, Math.min(100, Math.round((num / maxValue) * 100)));
  }

  function compactAmount(val: number): string {
    const abs = Math.abs(val);
    if (abs >= 1_000_000_000) {
      return `${formatMoney(Number((val / 1_000_000_000).toFixed(1)))}B`;
    }
    if (abs >= 1_000_000) {
      return `${formatMoney(Math.round(val / 1_000_000))}M`;
    }
    if (abs >= 1_000) {
      return `${formatMoney(Math.round(val / 1_000))}K`;
    }
    return formatMoney(val);
  }
</script>

<div class="col-chart-wrap">
  {#if primaryLegend || (showSecondary && secondaryLegend)}
    <div class="col-chart-legend">
      {#if primaryLegend}
        <span class="legend-item">
          <i class="legend-dot primary"></i>
          {primaryLegend}
        </span>
      {/if}
      {#if showSecondary && secondaryLegend}
        <span class="legend-item">
          <i class="legend-dot secondary"></i>
          {secondaryLegend}
        </span>
      {/if}
    </div>
  {/if}

  <div class="col-chart-scroll">
    <div class="col-chart-stage" style="min-height: {height}px;">
      {#each items as item (item.id)}
        <div class="col-chart-Slot">
          <div class="col-bars-pair" style="height: {height - 46}px;">
            <div class="col-bar-track">
              <span class="col-val-tag" title="{formatMoney(item.value)} {unitLabel}">
                {compactAmount(item.value)}
              </span>
              <div
                class="col-bar primary {item.tone || ''}"
                style="height: {calcPercent(item.value)}%;"
                title="{item.label}: {formatMoney(item.value)} {unitLabel}"
              ></div>
            </div>

            {#if showSecondary && item.secondaryValue !== undefined}
              <div class="col-bar-track">
                <span
                  class="col-val-tag secondary"
                  title="{formatMoney(item.secondaryValue)} {unitLabel}"
                >
                  {compactAmount(item.secondaryValue)}
                </span>
                <div
                  class="col-bar secondary"
                  style="height: {calcPercent(item.secondaryValue)}%;"
                  title="{item.label}: {formatMoney(item.secondaryValue)} {unitLabel}"
                ></div>
              </div>
            {/if}
          </div>

          <div class="col-x-axis">
            <strong class="col-x-label">{item.label}</strong>
            {#if item.subLabel}
              <span class="col-x-sub">{item.subLabel}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
