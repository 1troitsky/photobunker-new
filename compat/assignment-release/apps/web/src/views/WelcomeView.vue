<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import { locale, setLocale } from '../i18n'
import {
  account,
  hasConfirmedIdentity,
  offlineCaptureIdentity,
  sessionState,
} from '../identity/store'
import { launchPath } from '../app/preferences'
import { welcomeText } from '../welcome/text'

const router = useRouter()
const text = computed(welcomeText)
const slide = ref(0)
const icons = ['camera', 'lock', 'users', 'gallery', 'messages', 'device'] as const

// Presentation hint only. Never treat localStorage as proof of login:
// Identity R0-02 still owns the actual server/device verification.
const knownDevice = (() => {
  try { return !!localStorage.getItem('pb-active-device') && localStorage.getItem('pb-signed-out') !== 'true' }
  catch { return false }
})()
const checkingPreviousSession = computed(() =>
  knownDevice && ['initial', 'checking'].includes(sessionState.value) && !offlineCaptureIdentity.value,
)

watch(
  [sessionState, () => account.value?.id, offlineCaptureIdentity],
  () => {
    const offlineTrusted = offlineCaptureIdentity.value && !!account.value &&
      ['offline', 'checking'].includes(sessionState.value)
    if (hasConfirmedIdentity() || offlineTrusted) void router.replace(launchPath())
  },
  { immediate: true },
)

function choose(index: number) {
  const length = text.value.features.length
  slide.value = ((index % length) + length) % length
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') { event.preventDefault(); choose(slide.value + 1) }
  if (event.key === 'ArrowLeft') { event.preventDefault(); choose(slide.value - 1) }
}
let touchStart: number | undefined
function startSwipe(event: TouchEvent) {
  touchStart = event.changedTouches[0]?.clientX
}
function finishSwipe(event: TouchEvent) {
  const end = event.changedTouches[0]?.clientX
  if (touchStart !== undefined && end !== undefined && Math.abs(end - touchStart) >= 45)
    choose(slide.value + (end < touchStart ? 1 : -1))
  touchStart = undefined
}
function toggleLanguage() { setLocale(locale.value === 'ru' ? 'en' : 'ru') }
</script>

<template>
  <section class="welcome-screen" aria-labelledby="welcome-heading">
    <header class="welcome-topbar">
      <button type="button" class="welcome-language" :aria-label="text.changeLanguage"
        @click="toggleLanguage"><AppIcon name="globe" />{{ locale === 'ru' ? 'RU' : 'EN' }}</button>
    </header>

    <div v-if="checkingPreviousSession" class="welcome-resuming" role="status">
      <img src="/icons/brand-logo.png" width="88" height="88" alt="" />
      <h1 id="welcome-heading" class="welcome-resume-title">PhotoBunker</h1>
      <span>{{ text.restoring }}</span>
    </div>

    <div v-else class="welcome-content">
      <div class="welcome-intro">
        <img class="welcome-logo" src="/icons/brand-logo.png" width="100" height="100" alt="" />
        <h1 id="welcome-heading">{{ text.brand }}</h1>
        <p>{{ text.lead }}</p>
      </div>

      <nav class="welcome-actions" :aria-label="text.brand">
        <RouterLink class="welcome-action welcome-create"
          :to="{ path: '/profile/account', query: { mode: 'create', from: 'welcome' } }">
          <span class="welcome-action-icon welcome-create-icon"><AppIcon name="user" /><AppIcon name="plus" /></span>
          <span class="welcome-action-copy"><strong>{{ text.create }}</strong><small>{{ text.createHint }}</small></span>
          <AppIcon name="arrow" />
        </RouterLink>
        <RouterLink class="welcome-action welcome-recover"
          :to="{ path: '/profile/account', query: { mode: 'recover', from: 'welcome' } }">
          <span class="welcome-action-icon"><AppIcon name="key" /></span>
          <span class="welcome-action-copy"><strong>{{ text.recover }}</strong><small>{{ text.recoverHint }}</small></span>
          <AppIcon name="arrow" />
        </RouterLink>
      </nav>

      <section class="welcome-why" aria-labelledby="welcome-why-heading">
        <div class="welcome-carousel" role="region" aria-roledescription="carousel"
          :aria-label="text.why" tabindex="0" :title="text.carouselHelp"
          @keydown="onKeydown" @touchstart.passive="startSwipe" @touchend.passive="finishSwipe"
          @touchcancel="touchStart = undefined">
          <h2 id="welcome-why-heading">{{ text.why }}</h2>
          <div class="welcome-slide" role="group" aria-roledescription="slide"
            :aria-label="(slide + 1) + ' ' + text.position + ' ' + text.features.length"
            aria-live="polite" aria-atomic="true">
            <div class="welcome-slide-icon"><AppIcon :name="icons[slide] ?? 'camera'" /></div>
            <div class="welcome-slide-copy">
              <h3>{{ String(slide + 1).padStart(2, '0') }}. {{ text.features[slide]?.title }}</h3>
              <p>{{ text.features[slide]?.description }}</p>
            </div>
          </div>
          <div class="welcome-carousel-controls">
            <button type="button" class="welcome-arrow" :aria-label="text.previous"
              @click="choose(slide - 1)"><AppIcon name="back" /></button>
            <div class="welcome-dots" role="group" :aria-label="text.why">
              <button v-for="(_, index) in text.features" :key="index" type="button"
                class="welcome-dot" :class="{ 'is-selected': index === slide }"
                :aria-label="text.goTo + ' ' + (index + 1)"
                :aria-current="index === slide ? 'true' : undefined"
                @click="choose(index)"><span class="welcome-dot-mark" /></button>
            </div>
            <button type="button" class="welcome-arrow" :aria-label="text.next"
              @click="choose(slide + 1)"><AppIcon name="arrow" /></button>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
