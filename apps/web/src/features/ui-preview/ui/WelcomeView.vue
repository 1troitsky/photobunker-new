<script setup lang="ts">
import {onMounted, ref} from 'vue'
import {revokedDeviceStatuses} from '../../account'
import AppIcon from './AppIcon.vue'
import { language, setLanguage, setTheme, text, theme } from './copy'

const slide = ref(0)
const hasDeviceRevocation=ref(false)
onMounted(()=>{void revokedDeviceStatuses().then(rows=>{hasDeviceRevocation.value=rows.length>0}).catch(()=>{})})
const benefitIcons = ['camera', 'shield', 'users', 'info', 'key'] as const
function choose(index: number) {
  slide.value = (index + text.value.benefits.length) % text.value.benefits.length
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') { event.preventDefault(); choose(slide.value + 1) }
  if (event.key === 'ArrowLeft') { event.preventDefault(); choose(slide.value - 1) }
}
let started: number | undefined
function touchStart(event: TouchEvent) { started = event.changedTouches[0]?.clientX }
function touchEnd(event: TouchEvent) {
  const end = event.changedTouches[0]?.clientX
  if (started !== undefined && end !== undefined && Math.abs(end - started) > 45) {
    choose(slide.value + (end < started ? 1 : -1))
  }
  started = undefined
}
</script>
<template>
  <section class="welcome-screen">
    <header class="welcome-topbar">
      <RouterLink
        class="welcome-enter-preview"
        to="/"
      >{{ text.preview }} <AppIcon name="arrow" /></RouterLink>
      <button
        class="language-button"
        type="button"
        :aria-label="text.language"
        @click="setLanguage(language==='ru'?'en':'ru')"
      >
        <AppIcon name="globe" /> {{ language.toUpperCase() }}
      </button>
      <button
        type="button"
        class="icon-button"
        :aria-label="text.theme"
        @click="setTheme(theme==='dark'?'light':'dark')"
      >
        <AppIcon :name="theme==='dark'?'sun':'moon'" />
      </button>
    </header>
    <div class="welcome-content">
      <div class="welcome-intro">
        <img
          class="welcome-logo"
          src="/icons/brand-logo.png"
          width="104"
          height="104"
          alt=""
        >
        <h1>PhotoBunker</h1>
        <p>{{ text.lead }}</p>
      </div>
      <nav
        class="welcome-actions"
        :aria-label="text.welcome"
      >
        <RouterLink
          to="/account/create"
          class="welcome-action welcome-create"
        >
          <span class="welcome-action-icon"><AppIcon name="profile" /><span class="welcome-small-plus"><AppIcon name="plus" /></span></span>
          <span class="welcome-action-copy"><strong>{{ text.create }}</strong><small>{{ text.anonymous }}</small></span>
          <AppIcon name="arrow" />
        </RouterLink>
        <RouterLink
          to="/account/restore"
          class="welcome-action welcome-recover"
        >
          <span class="welcome-action-icon"><AppIcon name="key" /></span>
          <span class="welcome-action-copy"><strong>{{ text.recover }}</strong><small>{{ text.privateKey }}</small></span>
          <AppIcon name="arrow" />
        </RouterLink>
      </nav>
      <RouterLink v-if="hasDeviceRevocation" to="/device-revocation/status" class="welcome-disclaimer">
        {{language==='ru'?'Проверить отзыв доступа устройства':'Check device revocation status'}}
      </RouterLink>
      <section
        class="welcome-why"
        aria-labelledby="welcome-why-heading"
      >
        <div
          class="welcome-carousel"
          role="region"
          aria-roledescription="carousel"
          :aria-label="text.why"
          :title="text.why"
          tabindex="0"
          @keydown="keydown"
          @touchstart.passive="touchStart"
          @touchend.passive="touchEnd"
          @touchcancel="started=undefined"
        >
          <h2 id="welcome-why-heading">
            {{ text.why }}
          </h2>
          <div
            class="welcome-slide"
            role="group"
            aria-roledescription="slide"
            :aria-label="(slide+1)+' / '+text.benefits.length"
            aria-live="polite"
          >
            <div class="welcome-slide-icon">
              <AppIcon :name="benefitIcons[slide] ?? 'camera'" />
            </div>
            <div class="welcome-slide-copy">
              <h3>{{ String(slide+1).padStart(2, '0') }}. {{ text.benefits[slide]?.title }}</h3>
              <p>{{ text.benefits[slide]?.description }}</p>
            </div>
          </div>
          <div class="welcome-carousel-controls">
            <button
              type="button"
              class="welcome-arrow"
              :aria-label="text.prevSlide"
              @click="choose(slide-1)"
            >
              <AppIcon name="back" />
            </button>
            <div
              class="welcome-dots"
              role="group"
              :aria-label="text.why"
            >
              <button
                v-for="(_,index) in text.benefits"
                :key="index"
                type="button"
                class="welcome-dot"
                :class="{ 'is-selected': index===slide }"
                :aria-label="text.showSlide+' '+(index+1)"
                :aria-current="index===slide ? 'true' : undefined"
                @click="choose(index)"
              >
                <span class="welcome-dot-mark" />
              </button>
            </div>
            <button
              type="button"
              class="welcome-arrow"
              :aria-label="text.nextSlide"
              @click="choose(slide+1)"
            >
              <AppIcon name="arrow" />
            </button>
          </div>
        </div>
      </section>
      <p
        class="welcome-disclaimer"
        role="note"
      >
        {{ text.previewInfo }}
      </p>
    </div>
  </section>
</template>
