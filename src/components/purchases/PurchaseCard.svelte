<script lang="ts">
  import type { Purchase } from '../../models/types';
  import { formatMoney, formatNumber, toJalaliDate } from '../../utils/formatters';

  export let purchase: Purchase;

  $: avatarLetter = (purchase.productName || '؟').trim().charAt(0);
</script>

<article class="purchase-item">
  <div class="product-avatar">{avatarLetter}</div>
  <div class="purchase-main">
    <div class="purchase-name">{purchase.productName}</div>
    <div class="purchase-meta">
      <span>{formatNumber(purchase.quantity)} {purchase.unit}</span>
      {#if purchase.supplierName}
        <span>{purchase.supplierName}</span>
      {/if}
      {#if purchase.invoiceNumber}
        <span>فاکتور {purchase.invoiceNumber}</span>
      {/if}
    </div>
  </div>
  <div class="purchase-side">
    <div class="purchase-amount">{formatMoney(purchase.totalAmount)} تومان</div>
    <div class="purchase-date">{toJalaliDate(purchase.purchaseDate)}</div>
  </div>
</article>
