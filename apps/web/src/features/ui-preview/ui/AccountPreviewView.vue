<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { language, setLanguage, text } from './copy'

const route = useRoute()
const restoring = computed(() => route.path.endsWith('/restore'))
</script>
<template>
  <section class="account-preview">
    <div class="account-card">
      <header class="account-header">
        <RouterLink
          to="/welcome"
          class="icon-button"
          :aria-label="text.back"
        ><AppIcon name="back" /></RouterLink>
        <button
          type="button"
          class="language-button"
          :aria-label="text.language"
          @click="setLanguage(language==='ru'?'en':'ru')"
        >
          <AppIcon name="globe" /> {{ language.toUpperCase() }}
        </button>
      </header>
      <img
        src="/icons/brand-logo.png"
        alt=""
        class="account-logo"
        width="80"
        height="80"
      >
      <span class="eyebrow">{{ text.preview }}</span>
      <h1>{{ restoring ? text.recover : text.create }}</h1>
      <p class="account-lead">
        {{ restoring ? text.recoverDesc : text.createDesc }}
      </p>
      <div class="account-explanation">
        <span class="explanation-icon"><AppIcon :name="restoring ? 'key' : 'shield'" /></span>
        <div><strong>{{ text.privateKey }}</strong><p>{{ text.needKey }}</p></div>
      </div>
      <div
        class="account-key-placeholder"
        aria-disabled="true"
      >
        <AppIcon name="lock" />
        <span>{{ restoring ? text.restoreUnavailable : text.createUnavailable }}</span>
      </div>
      <p class="account-warning">
        <AppIcon name="info" /> {{ text.dontPaste }}
      </p>
      <RouterLink
        class="primary-button account-browse"
        to="/photos"
      >
        {{ text.browse }} <AppIcon name="arrow" />
      </RouterLink>
      <RouterLink
        class="account-alternative"
        :to="restoring ? '/account/create' : '/account/restore'"
      >
        {{ restoring ? text.create : text.recover }}
      </RouterLink>
    </div>
  </section>
</template>
