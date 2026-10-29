<script setup lang="ts">
defineProps<{
  name:
    | 'phone'
    | 'video'
    | 'mic'
    | 'send'
    | 'profiles'
    | 'camera'
    | 'gallery'
    | 'settings'
    | 'lock'
    | 'key'
    | 'flip'
    | 'arrow'
    | 'offline'
    | 'globe'
    | 'device'
    | 'close'
    | 'star'
    | 'back'
    | 'trash'
    | 'download'
    | 'messages'
    | 'user'
    | 'appearance'
    | 'chevron'
    | 'plus'
    | 'more'
    | 'search'
    | 'filter'
    | 'check'
    | 'users'
    | 'edit'
    | 'copy'
    | 'archive'
    | 'folder'
    | 'bell-off'
    | 'share'
    | 'info'
    | 'eye-off'
    | 'grid'
    | 'rotate'
    | 'crop'
    | 'brush'
    | 'pencil'
    | 'eraser'
}>()
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
    <path
      v-if="name === 'phone'"
      d="M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4c0 2-2 3-4 2C9 19 5 15 3 7c-1-2 0-4 2-4Z"
    />
    <template v-else-if="name === 'video'">
      <rect x="3" y="5" width="13" height="14" rx="3" />
      <path d="m16 10 5-3v10l-5-3" />
    </template>
    <template v-else-if="name === 'mic'">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" />
    </template>
    <template v-else-if="name === 'profiles'">
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M8 8h8M8 12h5M8 16h8" />
    </template>
    <path v-else-if="name === 'send'" d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14" />
    <path v-else-if="name === 'plus'" d="M12 5v14M5 12h14" />
    <template v-else-if="name === 'more'">
      <circle cx="12" cy="5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </template>
    <path v-else-if="name === 'filter'" d="M3 5h18M6 12h12M10 19h4" />
    <path v-else-if="name === 'check'" d="m5 12 4 4L19 6" />
    <template v-else-if="name === 'users'">
      <circle cx="9" cy="8" r="3" />
      <path
        d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"
      />
    </template>
    <template v-else-if="name === 'edit'">
      <path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M3 6h7l2 3h9v11H3z" stroke-linejoin="round"/>
    </template>
    <template v-else-if="name === 'bell-off'">
      <path d="M4 4 20 20M9 5a4 4 0 0 1 7 3v4c0 1.5.5 2.5 1.5 4M5.5 16h13M10 20h4"/>
    </template>
    <template v-else-if="name === 'archive'">
      <path d="M4 8v13h16V8M9 12h6" />
      <rect x="2" y="3" width="20" height="5" rx="1" />
    </template>
    <template v-else-if="name === 'share'">
      <path d="M12 16V2m-4 4 4-4 4 4M5 11v10h14V11" />
    </template>
    <template v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-11v1" />
    </template>
    <template v-else-if="name === 'eye-off'">
      <path
        d="m3 3 18 18M10 5c6-1 11 7 11 7l-3 4M6 6c-3 2-5 6-5 6s4 7 11 7c2 0 3 0 4-1M10 10a3 3 0 0 0 4 4"
      />
    </template>
    <template v-else-if="name === 'grid'">
      <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </template>
    <template v-else-if="name === 'rotate'">
      <path d="M4 9V3m0 6h6M4 9a8 8 0 1 1 0 7" />
    </template>
    <path v-else-if="name === 'crop'" d="M7 3v14h14M3 7h14v14" />
    <template v-else-if="name === 'brush'">
      <path d="m14 5 4-3 4 4-3 4-8 8-4-4zM7 14c-2 0-4 2-4 5 0 2-1 3-2 3 6 1 10-1 10-5" />
    </template>
    <template v-else-if="name === 'pencil'">
      <path d="M4 20h5L21 8l-5-5L4 15zM13 6l5 5M4 15l5 5" />
    </template>
    <template v-else-if="name === 'eraser'">
      <path d="m3 15 10-11a3 3 0 0 1 4 0l4 4a3 3 0 0 1 0 4l-8 9H8zM8 10l8 8M13 21h8" />
    </template>
    <template v-else-if="name === 'messages'">
      <path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z" />
      <path d="M7 9h10M7 13h7" />
    </template>
    <template v-else-if="name === 'user'">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </template>
    <template v-else-if="name === 'appearance'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
    </template>
    <path v-else-if="name === 'chevron'" d="m9 5 7 7-7 7" />
    <template v-else-if="name === 'camera'">
      <path d="M3 7h5l2-3h4l2 3h5v13H3z" />
      <circle cx="12" cy="13" r="4" />
    </template>
    <template v-else-if="name === 'gallery'">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8" cy="8" r="1" />
      <path d="m4 17 5-5 4 4 3-3 5 5" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="9" cy="18" r="2" fill="currentColor" />
    </template>
    <template v-else-if="name === 'lock'">
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </template>
    <template v-else-if="name === 'key'">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12 20 3l2 2-3 3 2 2-3 3-2-2-5 5" />
    </template>
    <template v-else-if="name === 'flip'">
      <path d="M20 7h-5V2M4 17h5v5M20 7a8 8 0 0 0-14-2m-2 12a8 8 0 0 0 14 2" />
    </template>
    <path v-else-if="name === 'arrow'" d="M5 12h14m-5-5 5 5-5 5" />
    <template v-else-if="name === 'offline'">
      <path
        d="m3 3 18 18M8 8a10 10 0 0 1 13 1M3 9a14 14 0 0 1 2-1m3 5a6 6 0 0 1 8 0m-5 4h2"
      />
    </template>
    <template v-else-if="name === 'globe'">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18m-9-9a17 17 0 0 0 0 18 17 17 0 0 0 0-18" />
    </template>
    <template v-else-if="name === 'device'">
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <path d="M11 18h2" />
    </template>
    <path v-else-if="name === 'close'" d="m6 6 12 12M6 18 18 6" />
    <path
      v-else-if="name === 'star'"
      d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"
    />
    <path v-else-if="name === 'back'" d="M19 12H5m5-5-5 5 5 5" />
    <template v-else-if="name === 'trash'">
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" />
    </template>
  </svg>
</template>
