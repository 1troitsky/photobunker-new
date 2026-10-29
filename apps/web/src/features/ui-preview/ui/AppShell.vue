<script setup lang="ts">
import AppDock from './AppDock.vue'
import { useRoute } from 'vue-router'
const route = useRoute()
import AppIcon from './AppIcon.vue'
import { language, setLanguage, setTheme, text, theme } from './copy'
</script>
<template>
  <div class="preview-shell">
    <header class="shell-top">
      <RouterLink
        to="/welcome"
        class="shell-brand"
        aria-label="PhotoBunker — Welcome"
      >
        <img
          src="/icons/brand-logo.png"
          alt=""
          width="34"
          height="34"
        >
        <span>PhotoBunker</span>
      </RouterLink>
      <span
        v-if="!route.path.startsWith('/photos') && !route.path.startsWith('/assignments') && route.path!=='/camera'"
        class="shell-preview"
      >{{ text.preview }}</span>
      <div class="shell-tools">
        <button
          type="button"
          class="icon-button"
          :aria-label="text.theme"
          @click="setTheme(theme === 'dark' ? 'light' : 'dark')"
        >
          <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" />
        </button>
        <button
          type="button"
          class="language-button"
          :aria-label="text.language"
          @click="setLanguage(language === 'ru' ? 'en' : 'ru')"
        >
          <AppIcon name="globe" />{{ language.toUpperCase() }}
        </button>
      </div>
    </header>
    <main class="shell-main">
      <RouterView />
    </main>
    <AppDock />
  </div>
</template>
