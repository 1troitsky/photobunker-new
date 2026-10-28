<script setup lang="ts">
/* Adapted minimal stroke vocabulary from legacy AppIcon.vue; no chat/RTC glyphs. */
defineProps<{ name: 'camera'|'photos'|'assignments'|'browser'|'profile'|'settings'|'lock'|'key'|'arrow'|'back'|'plus'|'search'|'filter'|'grid'|'list'|'folder'|'globe'|'moon'|'sun'|'chevron'|'close'|'edit'|'info'|'check'|'share'|'download'|'users'|'eye'|'shield'|'clock'|'image'|'star'|'sliders'|'more'|'check-circle' }>()
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name==='camera'"><path d="M3 7h5l2-3h4l2 3h5v13H3z" /><circle
      cx="12"
      cy="13"
      r="4"
    /></template>
    <template v-else-if="name==='photos' || name==='image'"><rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="4"
    /><circle
      cx="8"
      cy="8"
      r="1"
    /><path d="m4 17 5-5 4 4 3-3 5 5" /></template>
    <template v-else-if="name==='assignments'"><rect
      x="4"
      y="3"
      width="16"
      height="18"
      rx="3"
    /><path d="M8 8h8M8 12h5M8 16h8" /></template>
    <template v-else-if="name==='browser' || name==='folder'"><path d="M3 6h7l2 3h9v11H3z" /></template>
    <template v-else-if="name==='profile'"><circle
      cx="12"
      cy="8"
      r="4"
    /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></template>
    <template v-else-if="name==='settings' || name==='sliders'"><path d="M4 6h16M4 12h16M4 18h16" /><circle
      cx="9"
      cy="6"
      r="2"
      fill="currentColor"
    /><circle
      cx="15"
      cy="12"
      r="2"
      fill="currentColor"
    /><circle
      cx="9"
      cy="18"
      r="2"
      fill="currentColor"
    /></template>
    <template v-else-if="name==='lock'"><rect
      x="5"
      y="10"
      width="14"
      height="11"
      rx="3"
    /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></template>
    <template v-else-if="name==='key'"><circle
      cx="8"
      cy="15"
      r="4"
    /><path d="M11 12 20 3l2 2-3 3 2 2-3 3-2-2-5 5" /></template>
    <path
      v-else-if="name==='arrow'"
      d="M5 12h14m-5-5 5 5-5 5"
    />
    <path
      v-else-if="name==='back'"
      d="M19 12H5m5-5-5 5 5 5"
    />
    <path
      v-else-if="name==='plus'"
      d="M12 5v14M5 12h14"
    />
    <template v-else-if="name==='search'"><circle
      cx="10"
      cy="10"
      r="6"
    /><path d="m15 15 6 6" /></template>
    <path
      v-else-if="name==='filter'"
      d="M3 5h18M6 12h12M10 19h4"
    />
    <template v-else-if="name==='grid'"><rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="2"
    /><path d="M8 3v18M16 3v18M3 8h18M3 16h18" /></template>
    <path
      v-else-if="name==='list'"
      d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"
    />
    <template v-else-if="name==='globe'"><circle
      cx="12"
      cy="12"
      r="9"
    /><path d="M3 12h18m-9-9a17 17 0 0 0 0 18 17 17 0 0 0 0-18" /></template>
    <path
      v-else-if="name==='moon'"
      d="M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z"
    />
    <template v-else-if="name==='sun'"><circle
      cx="12"
      cy="12"
      r="4"
    /><path d="M12 2v2m0 16v2M4 12H2m20 0h-2M5 5 6.5 6.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19" /></template>
    <path
      v-else-if="name==='chevron'"
      d="m9 5 7 7-7 7"
    />
    <path
      v-else-if="name==='close'"
      d="m6 6 12 12M6 18 18 6"
    />
    <path
      v-else-if="name==='edit'"
      d="m4 16 12-12 4 4L8 20H4zM14 6l4 4"
    />
    <template v-else-if="name==='info'"><circle
      cx="12"
      cy="12"
      r="9"
    /><path d="M12 11v6m0-11v1" /></template>
    <path
      v-else-if="name==='check'"
      d="m5 12 4 4L19 6"
    />
    <path
      v-else-if="name==='share'"
      d="M12 16V2m-4 4 4-4 4 4M5 11v10h14V11"
    />
    <path
      v-else-if="name==='download'"
      d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"
    />
    <template v-else-if="name==='users'"><circle
      cx="9"
      cy="8"
      r="3"
    /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" /></template>
    <template v-else-if="name==='eye'"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle
      cx="12"
      cy="12"
      r="3"
    /></template>
    <path
      v-else-if="name==='shield'"
      d="M12 2 21 6v6c0 5-4 8-9 10-5-2-9-5-9-10V6z"
    />
    <template v-else-if="name==='clock'"><circle
      cx="12"
      cy="12"
      r="9"
    /><path d="M12 6v6l4 2" /></template>
    <path
      v-else-if="name==='star'"
      d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"
    />
    <template v-else-if="name==='more'"><circle
      cx="12"
      cy="5"
      r="1"
      fill="currentColor"
    /><circle
      cx="12"
      cy="12"
      r="1"
      fill="currentColor"
    /><circle
      cx="12"
      cy="19"
      r="1"
      fill="currentColor"
    /></template>
    <template v-else-if="name==='check-circle'"><circle
      cx="12"
      cy="12"
      r="9"
    /><path d="m8 12 3 3 5-6" /></template>
  </svg>
</template>
