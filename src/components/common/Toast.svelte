<script lang="ts">
  import { toastState } from '../../stores/toastStore';
</script>

<div 
  class="toast" 
  class:show={$toastState.show} 
  role="status" 
  aria-live="polite"
>
  {$toastState.message}
</div>
