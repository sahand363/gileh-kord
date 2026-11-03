<script lang="ts">
  import { onMount } from 'svelte';
  import { currentPage } from './stores/navigationStore';
  import { loadPurchases } from './stores/purchaseStore';
  import Topbar from './components/common/Topbar.svelte';
  import BottomNav from './components/common/BottomNav.svelte';
  import Toast from './components/common/Toast.svelte';

  import DashboardPage from './features/dashboard/DashboardPage.svelte';
  import PurchaseEntryPage from './features/purchases/PurchaseEntryPage.svelte';
  import PurchaseHistoryPage from './features/history/PurchaseHistoryPage.svelte';
  import ProductsPage from './features/products/ProductsPage.svelte';
  import SuppliersPage from './features/suppliers/SuppliersPage.svelte';
  import InventoryPage from './features/inventory/InventoryPage.svelte';
  import ExpensesPage from './features/expenses/ExpensesPage.svelte';
  import ReportsPage from './features/reports/ReportsPage.svelte';
  import SettingsPage from './features/settings/SettingsPage.svelte';
  import BackupPage from './features/backup/BackupPage.svelte';

  onMount(async () => {
    await loadPurchases(true);
  });
</script>

<div class="app-shell">
  <Topbar />

  <main class="main-wrap">
    {#if $currentPage === 'dashboard'}
      <DashboardPage />
    {:else if $currentPage === 'entry'}
      <PurchaseEntryPage />
    {:else if $currentPage === 'history'}
      <PurchaseHistoryPage />
    {:else if $currentPage === 'products'}
      <ProductsPage />
    {:else if $currentPage === 'suppliers'}
      <SuppliersPage />
    {:else if $currentPage === 'inventory'}
      <InventoryPage />
    {:else if $currentPage === 'expenses'}
      <ExpensesPage />
    {:else if $currentPage === 'reports'}
      <ReportsPage />
    {:else if $currentPage === 'backup'}
      <BackupPage />
    {:else if $currentPage === 'settings'}
      <SettingsPage />
    {/if}
  </main>

  <BottomNav />
  <Toast />
</div>
