<script setup lang="ts">
// Adapted from Chatify v2 Sidebar.vue: compact identity/navigation header.
// Intent buttons are provided by the host so account and navigation policy
// never enter the shared UI package.
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="screen-header messenger-list-header chatify-sidebar-header">
    <slot name="leading" />
    <div class="screen-title">
      <h1>{{ title }}</h1>
      <small v-if="subtitle" role="status">{{ subtitle }}</small>
    </div>
    <div class="screen-actions"><slot name="actions" /></div>
  </header>
</template>
