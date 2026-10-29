<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from './AppIcon.vue'
import ScreenHeader from './ScreenHeader.vue'
import { identity, IdentityPanel } from '../../identity'
import { StorageDiagnostics } from '../../local-storage'
import { CameraScreen } from '../../camera'
import {GalleryScreen} from '../../gallery'
import { language, setLanguage, setTheme, text, theme } from './copy'
import { photoFixtures } from './fixtures'

const route = useRoute()
const editorTool = ref<'brush'|'text'|'shape'>('brush')

const title = computed(() => {
  switch (route.path) {
    case '/photos': return text.value.photos
    case '/camera': return text.value.camera
    case '/assignments': return text.value.assignments
    case '/browser': return text.value.browser
    case '/profile': return text.value.profile
    case '/editor/preview': return text.value.editor
    case '/photo-card/preview': return text.value.card
    case '/pin/preview': return text.value.pin
    default: return text.value.preview
  }
})
</script>

<template>
  <section
    class="screen"
    :class="{ 'camera-route': route.path === '/camera' }"
    :data-screen="String(route.name ?? '')"
  >
    <ScreenHeader
      :title="title"
      :subtitle="['/photos','/camera'].includes(route.path)?undefined:text.preview"
      :back="['/editor/preview','/photo-card/preview'].includes(route.path)?'/photos': route.path === '/pin/preview'?'/profile':undefined"
    >
      <button
        v-if="route.path==='/profile'"
        type="button"
        class="icon-button"
        :aria-label="text.theme"
        @click="setTheme(theme === 'dark'?'light':'dark')"
      >
        <AppIcon :name="theme==='dark'?'sun':'moon'" />
      </button>
    </ScreenHeader>

    <div class="screen-body">
      <div
        v-if="!['/photos','/camera'].includes(route.path)"
        class="preview-notice"
        role="note"
      >
        <AppIcon name="info" />{{ text.previewInfo }}
      </div>

      <!-- R2-06: real encrypted photos and camera; no preview fixtures. -->
      <template v-if="route.path==='/photos'">
        <GalleryScreen />
      </template>
      <template v-else-if="route.path==='/camera'">
        <CameraScreen />
      </template>

      <!-- PROFILE: no invented real identity; only local display preferences -->
      <template v-else-if="route.path==='/profile'">
        <div
          v-if="!identity"
          class="profile-hero"
        >
          <div class="profile-avatar">
            <AppIcon name="profile" />
          </div>
          <div><span class="eyebrow">{{ text.demo }}</span><h2>{{ text.profileAnon }}</h2><p>{{ text.profileDemo }}</p></div>
        </div>
        <div
          v-if="!identity"
          class="profile-quicklinks"
        >
          <RouterLink
            to="/account/create"
            class="profile-action"
          ><AppIcon name="key" /><span>{{ text.create }}</span><AppIcon name="chevron" /></RouterLink>
          <RouterLink
            to="/account/restore"
            class="profile-action"
          ><AppIcon name="shield" /><span>{{ text.recover }}</span><AppIcon name="chevron" /></RouterLink>
          <RouterLink
            to="/pin/preview"
            class="profile-action"
          ><AppIcon name="lock" /><span>{{ text.pin }}</span><AppIcon name="chevron" /></RouterLink>
        </div>
        <section
          class="settings-panel"
          aria-labelledby="settings-title"
        >
          <h2 id="settings-title">
            {{ text.settings }}
          </h2>
          <p>{{ text.settingsHint }}</p>
          <div class="setting-row">
            <span>{{ text.theme }}</span>
            <div
              class="pill-group"
              :aria-label="text.theme"
            >
              <button
                type="button"
                :class="{selected:theme==='light'}"
                :aria-pressed="theme==='light'"
                @click="setTheme('light')"
              >
                {{ text.light }}
              </button>
              <button
                type="button"
                :class="{selected:theme==='dark'}"
                :aria-pressed="theme==='dark'"
                @click="setTheme('dark')"
              >
                {{ text.dark }}
              </button>
            </div>
          </div>
          <div class="setting-row">
            <span>{{ text.language }}</span>
            <div
              class="pill-group"
              :aria-label="text.language"
            >
              <button
                type="button"
                lang="ru"
                :class="{selected:language==='ru'}"
                :aria-pressed="language==='ru'"
                @click="setLanguage('ru')"
              >
                RU
              </button>
              <button
                type="button"
                lang="en"
                :class="{selected:language==='en'}"
                :aria-pressed="language==='en'"
                @click="setLanguage('en')"
              >
                EN
              </button>
            </div>
          </div>
        </section>
        <nav class="profile-quicklinks" aria-label="Teams and contacts">
          <RouterLink to="/teams" class="profile-action">{{ language==='ru'?'Команды':'Teams' }}</RouterLink>
          <RouterLink to="/contacts" class="profile-action">{{ language==='ru'?'Контакты':'Contacts' }}</RouterLink>
        </nav>
        <IdentityPanel />
        <StorageDiagnostics />
      </template>

      <!-- CONTEXT ROUTES: purely visual previews, no save, public shares or PIN setup -->
      <template v-else-if="route.path==='/editor/preview'">
        <div class="context-panel">
          <span class="eyebrow">{{ text.demo }}</span><h2>{{ text.editor }}</h2><p>{{ text.editorHint }}</p>
          <div class="context-photo art-four">
            <span class="fake-photo-label">{{ text.demo }}</span>
          </div>
          <div
            class="tool-choice"
            role="group"
            :aria-label="text.editor"
          >
            <button
              type="button"
              :class="{selected:editorTool==='brush'}"
              :aria-pressed="editorTool==='brush'"
              @click="editorTool='brush'"
            >
              <AppIcon name="edit" />{{ text.brush }}
            </button>
            <button
              type="button"
              :class="{selected:editorTool==='text'}"
              :aria-pressed="editorTool==='text'"
              @click="editorTool='text'"
            >
              {{ text.textTool }}
            </button>
            <button
              type="button"
              :class="{selected:editorTool==='shape'}"
              :aria-pressed="editorTool==='shape'"
              @click="editorTool='shape'"
            >
              <AppIcon name="grid" />{{ text.shape }}
            </button>
          </div>
          <p class="hint">
            {{ text.demoAction }}
          </p>
          <RouterLink
            class="subtle-button"
            to="/photos"
          ><AppIcon name="back" />{{ text.back }}</RouterLink>
        </div>
      </template>
      <template v-else-if="route.path==='/photo-card/preview'">
        <div class="context-panel card-preview">
          <span class="eyebrow">{{ text.demo }}</span><div class="context-photo art-one">
            <span class="fake-photo-label">{{ text.demo }}</span>
          </div>
          <h2>{{ photoFixtures[0]?.title[language] }}</h2><p>{{ text.cardHint }}</p>
          <div class="card-details">
            <span>ABCD0001</span><span><AppIcon name="clock" /> 45d · {{ text.demo }}</span>
          </div>
          <div class="context-actions">
            <RouterLink
              class="subtle-button"
              to="/photos"
            ><AppIcon name="photos" />{{ text.photos }}</RouterLink><RouterLink
              class="subtle-button"
              to="/editor/preview"
            ><AppIcon name="edit" />{{ text.editor }}</RouterLink>
          </div>
        </div>
      </template>
      <template v-else-if="route.path==='/pin/preview'">
        <div class="context-panel">
          <span class="eyebrow">{{ text.demo }}</span><h2>{{ text.pin }}</h2><p>{{ text.pinHint }}</p>
          <div class="pin-preview-list">
            <div
              v-for="item in ([text.lockPin,text.deletePin,text.emergencyPin])"
              :key="item"
              class="pin-row"
            >
              <AppIcon name="lock" /><span>{{ item }}</span><small>{{ text.locked }}</small>
            </div>
          </div>
          <p class="hint">
            <AppIcon name="key" />{{ text.keyNotice }}
          </p><RouterLink
            class="subtle-button"
            to="/profile"
          ><AppIcon name="back" />{{ text.back }}</RouterLink>
        </div>
      </template>
    </div>
  </section>
</template>
