<script setup lang="ts">
// Adapted from Chatify v2 ChatifyApp.vue presentation structure.
// Responsive panel visibility is controlled by the host's .has-conversation
// state and stylesheet; the component does not know routes or Matrix rooms.
</script>

<template>
  <div class="messenger-workspace chatify-messenger-layout">
    <slot />
  </div>
</template>
