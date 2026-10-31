<script setup lang="ts">
import {identity,appLockState} from './features/identity'
import AppLockGate from './features/account/ui/AppLockGate.vue'
</script>
<template>
  <AppLockGate v-if="identity && appLockState.locked" />
  <RouterView v-else />
</template>
