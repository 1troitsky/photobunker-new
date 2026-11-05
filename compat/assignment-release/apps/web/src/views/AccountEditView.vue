<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import {
  account,
  loadIdentity,
  saveProfile,
  profileSaved,
  type Account,
  type ProfileField,
} from '../identity/store'
import { IdentityError } from '../identity/api'
import { a } from '../identity/text'
import { q } from '../crypto/text'
import { s } from '../studio/text'
import { clone } from '../studio/model'
const router = useRouter(),
  draft = ref<Account>(),
  avatarInput = ref<HTMLInputElement>(),
  avatarBusy = ref(false),
  busy = ref(false),
  error = ref(''),
  errorElement = ref<HTMLElement>(),
  conflict = ref(false)
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let saveTimer: ReturnType<typeof setTimeout> | undefined
let initial = ''
const fields: ProfileField[] = [
  'name',
  'username',
  'email',
  'phone',
  'links',
  'about',
]
const dirty = computed(
  () => !!draft.value && JSON.stringify(draft.value) !== initial,
)
const fieldErrors = computed<Partial<Record<ProfileField, string>>>(() => {
  const errors: Partial<Record<ProfileField, string>> = {}
  const username = draft.value?.fields.username.trim().replace(/^@/, '') || ''
  const email = draft.value?.fields.email.trim() || ''
  if (username && !/^[a-z][a-z0-9_-]{2,14}$/i.test(username))
    errors.username = a('invalidUsername')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = a('invalidEmail')
  return errors
})
const hasFieldErrors = computed(() => Object.keys(fieldErrors.value).length > 0)
function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))
}
function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
async function changeAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!draft.value || !file) return
  if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) {
    await showError(a('avatarInvalid'))
    return
  }
  avatarBusy.value = true
  error.value = ''
  const url = URL.createObjectURL(file), image = new Image()
  try {
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error('avatar.invalid')
    let output: Blob | null = null
    for (const [maximum, quality] of [[512, .8], [384, .74], [320, .68]] as const) {
      const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      output = await canvasBlob(canvas, 'image/webp', quality) ||
        await canvasBlob(canvas, 'image/jpeg', quality)
      canvas.width = canvas.height = 0
      if (output && output.size <= 160_000) break
    }
    if (!output || output.size > 160_000) throw new Error('avatar.large')
    const encoded = await blobDataUrl(output)
    if (!/^data:image\/(?:webp|jpeg);base64,/.test(encoded)) throw new Error('avatar.format')
    draft.value.fields.avatar = encoded
  } catch {
    await showError(a('avatarInvalid'))
  } finally {
    image.src = ''
    URL.revokeObjectURL(url)
    avatarBusy.value = false
  }
}
function copyProfile() {
  if (account.value) {
    draft.value = clone(account.value)
    initial = JSON.stringify(draft.value)
  }
}
onMounted(async () => {
  profileSaved.value = false
  await loadIdentity()
  if (!account.value) {
    await router.replace('/profile')
    return
  }
  copyProfile()
})
watch(
  () => account.value?.id,
  (id, previous) => {
    if (previous && id !== previous) {
      draft.value = undefined
      initial = ''
      void router.replace('/profile')
    }
  },
)
async function showError(message: string) {
  error.value = message
  await nextTick()
  errorElement.value?.focus({ preventScroll: true })
  errorElement.value?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
}
async function reloadProfile() {
  if (dirty.value && !confirm(s('leave'))) return
  busy.value = true
  try {
    await loadIdentity(true)
    copyProfile()
    error.value = ''
    conflict.value = false
  } catch {
    await showError(a('saveUnavailable'))
  } finally {
    busy.value = false
  }
}
async function save() {
  if (!draft.value || busy.value) return
  error.value = ''
  conflict.value = false
  if (hasFieldErrors.value) {
    saveState.value = 'error'
    await showError(Object.values(fieldErrors.value)[0] ?? a('invalidFields'))
    return
  }
  busy.value = true
  saveState.value = 'saving'
  try {
    await saveProfile(draft.value)
    copyProfile()
    saveState.value = 'saved'
  } catch (failure) {
    saveState.value = 'error'
    if(failure instanceof IdentityError && failure.code==='username_taken'){await showError(a('usernameTaken'));return}
    const status = failure instanceof IdentityError ? failure.status : 0
    conflict.value = status === 409
    await showError(
      a(
        status === 409
          ? 'profileConflict'
          : status === 422
            ? 'invalidFields'
            : status === 403
              ? 'saveDenied'
              : 'saveUnavailable',
      ),
    )
  } finally {
    busy.value = false
  }
}
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  if (!dirty.value) return
  saveState.value = hasFieldErrors.value ? 'error' : 'idle'
  if (!hasFieldErrors.value) saveTimer = setTimeout(() => { void save() }, 350)
}
watch(draft, scheduleSave, { deep: true, flush: 'post' })
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (dirty.value && !hasFieldErrors.value && !busy.value) void save()
})
</script>
<template>
  <section class="native-screen native-editor">
    <ScreenHeader :title="a('editProfile')" back="/profile" />
    <form
      v-if="draft"
      class="native-form editor-body"
      novalidate
      @submit.prevent="save"
    >
      <p class="field-hint">{{ q('Уникальный @username: 3–15 символов, латинские буквы, цифры, дефис или подчёркивание. Начинается с буквы; поиск по нему общедоступен.') }}</p>
      <p
        v-if="error"
        ref="errorElement"
        class="form-error"
        role="alert"
        tabindex="-1"
      >
        {{ error }}
      </p>
      <button
        v-if="conflict"
        type="button"
        class="secondary-button"
        :disabled="busy"
        @click="reloadProfile"
      >
        {{ a('reloadProfile') }}
      </button>
      <button v-else-if="error && !hasFieldErrors" type="button" class="secondary-button profile-retry"
        :disabled="busy" @click="save">{{ q('Повторить') }}</button>
      <p class="field-hint">{{ a('privacyHint') }}</p>
      <div class="profile-avatar-editor profile-field-group">
        <div class="profile-avatar-preview">
          <img v-if="draft.fields.avatar" :src="draft.fields.avatar" :alt="a('avatar')" />
          <span v-else aria-hidden="true">{{ (draft.fields.name || draft.fields.username || 'PB').slice(0, 2).toUpperCase() }}</span>
        </div>
        <div class="profile-avatar-actions">
          <strong>{{ a('avatar') }}</strong>
          <input ref="avatarInput" class="visually-hidden" type="file"
            accept="image/jpeg,image/png,image/webp" @change="changeAvatar" />
          <div class="inline-actions">
            <button type="button" class="secondary-button" :disabled="avatarBusy"
              @click="avatarInput?.click()">{{ a('chooseAvatar') }}</button>
            <button v-if="draft.fields.avatar" type="button" class="quiet-button subtle-danger"
              :disabled="avatarBusy" @click="draft.fields.avatar = ''">{{ a('removeAvatar') }}</button>
          </div>
          <label class="visibility-field">{{ a('visibility') }}
            <select v-model="draft.visibility.avatar">
              <option v-for="value in ['private', 'contacts', 'public'] as const"
                :key="value" :value="value">{{ a(value) }}</option>
            </select>
          </label>
        </div>
      </div>
      <p class="profile-save-state" :class="`is-${saveState}`" role="status">
        {{ saveState === 'saving' ? a('savingProfile') : saveState === 'saved' ? a('profileSavedNow') : '' }}
      </p>
      <div v-for="field in fields" :key="field" class="profile-field-group">
        <label
          >{{ a(field)
          }}<textarea
            v-if="['about', 'links'].includes(field)"
            v-model="draft.fields[field]"
            rows="3"
            maxlength="1000" /><input
            v-else
            v-model="draft.fields[field]"
            :type="field === 'email' ? 'email' : 'text'"
            :maxlength="field === 'username' ? 15 : 120"
            autocomplete="off"
            :aria-invalid="!!fieldErrors[field]"
            @input="
              ($event) => {
                ;($event.target as HTMLInputElement).removeAttribute(
                  'aria-invalid',
                )
              }
            " /></label
        ><label v-if="field !== 'username'" class="visibility-field"
          >{{ a('visibility')
          }}<select
            v-model="draft.visibility[field]"
            :aria-label="`${a('visibility')}: ${a(field)}`"
          >
            <option
              v-for="value in ['private', 'contacts', 'public'] as const"
              :key="value"
              :value="value"
            >
              {{ a(value) }}
            </option>
          </select></label
        >
        <small v-if="fieldErrors[field]" class="field-error" role="alert">{{ fieldErrors[field] }}</small>
        <small v-if="field === 'username'" class="field-hint">{{ q('Публичный адрес @username доступен для поиска всем пользователям.') }}</small>
      </div>
    </form>
    <p v-else class="screen-body field-hint">{{ a('noAccount') }}</p>
  </section>
</template>
