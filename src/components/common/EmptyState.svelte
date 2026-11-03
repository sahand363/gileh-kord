<script lang="ts">
  export let title: string;
  export let message: string;
</script>

<div class="empty-state">
  <div class="empty-icon">▤</div>
  <strong>{title}</strong>
  <p>{message}</p>
</div>
