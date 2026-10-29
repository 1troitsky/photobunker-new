<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
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
import { guardReload } from '../studio/unsaved'
const router = useRouter(),
  draft = ref<Account>(),
  busy = ref(false),
  error = ref(''),
  errorElement = ref<HTMLElement>(),
  conflict = ref(false)
let initial = '',
  saved = false
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
guardReload(dirty, busy)
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
    saved = true
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
      saved = true
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
async function save(event: Event) {
  if (!draft.value || busy.value) return
  error.value = ''
  conflict.value = false
  const form = event.currentTarget as HTMLFormElement
  if (!form.checkValidity()) {
    const invalid = form.querySelector<HTMLInputElement>(':invalid')
    await showError(
      a(invalid?.type === 'email' ? 'invalidEmail' : 'invalidFields'),
    )
    invalid?.setAttribute('aria-invalid', 'true')
    return
  }
  busy.value = true
  try {
    await saveProfile(draft.value)
    saved = true
    await router.replace('/profile')
  } catch (failure) {
    if(failure instanceof IdentityError && failure.code==='username_taken'){await showError('Этот @username уже занят. Выберите другой.');return}
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
onBeforeRouteLeave(
  () => saved || (!busy.value && (!dirty.value || confirm(s('leave')))),
)
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
      <p class="field-hint">{{ q('Уникальный @username: 3–32 символа, латинские буквы, цифры, дефис или подчёркивание. Начинается с буквы; поиск по нему общедоступен. Изменение вступает в силу после сохранения.') }}</p>
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
      <p class="field-hint">{{ a('privacyHint') }}</p>
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
            maxlength="120"
            autocomplete="off"
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
        <small v-if="field === 'username'" class="field-hint">{{ q('Публичный адрес @username доступен для поиска всем пользователям.') }}</small>
      </div>
      <footer class="editor-footer">
        <button
          type="button"
          class="secondary-button"
          :disabled="busy"
          @click="router.push('/profile')"
        >
          {{ s('cancel') }}</button
        ><button class="primary-button" :disabled="busy || !dirty">
          {{ s(busy ? 'saving' : 'save') }}
        </button>
      </footer>
    </form>
    <p v-else class="screen-body field-hint">{{ a('noAccount') }}</p>
  </section>
</template>
