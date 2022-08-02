<script lang="ts">
  let count: number = 0
  const increment = () => {
    count += 1
  }
</script>

<!--Add this line to your web component-->
<svelte:options tag="hls-player" />

<button on:click={increment}>
  count is {count}
</button>
