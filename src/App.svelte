<script lang="ts">
  import { onMount } from 'svelte';
  import { currentPage } from './stores/navigationStore';
  import { loadPurchases } from './stores/purchaseStore';
  import Topbar from './components/common/Topbar.svelte';
  import BottomNav from './components/common/BottomNav.svelte';
  import Toast from './components/common/Toast.svelte';
  import PurchaseEntryPage from './features/purchases/PurchaseEntryPage.svelte';
  import PurchaseHistoryPage from './features/history/PurchaseHistoryPage.svelte';
  import SettingsPage from './features/settings/SettingsPage.svelte';

  onMount(async () => {
    await loadPurchases();
  });
</script>

<div class="app-shell">
  <Topbar />

  <main class="main-wrap">
    {#if $currentPage === 'entry'}
      <PurchaseEntryPage />
    {:else if $currentPage === 'history'}
      <PurchaseHistoryPage />
    {:else if $currentPage === 'settings'}
      <SettingsPage />
    {/if}
  </main>

  <BottomNav />
  <Toast />
</div>
