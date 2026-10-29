<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { teamProfilePath } from '../studio/team-profile'
import { invitations } from '../workspace/state'
import { respond } from '../workspace/api'
import { workspaceError } from '../workspace/errors'
import { loadStudio } from '../studio/store'
import { w } from '../workspace/text'
import { s } from '../studio/text'
const router = useRouter()
const props = defineProps<{ kind: 'team' | 'task' }>()
const rows = computed(() =>
    invitations.value.filter((item) => item.kind === props.kind),
  ),
  busy = ref(''),
  error = ref('')
async function answer(id: string, accept: boolean) {
  if (busy.value) return
  busy.value = id
  error.value = ''
  try {
    const result = await respond(id, accept)
    await loadStudio()
    if (accept && props.kind === 'team' && result.recordId)
      await router.push(teamProfilePath(result.recordId))
  } catch (failure) {
    error.value = workspaceError(failure)
  } finally {
    busy.value = ''
  }
}
</script>
<template>
  <section v-if="rows.length" class="workspace-invitations">
    <h2>{{ w('invitations') }}</h2>
    <article v-for="item in rows" :key="item.id" class="form-card">
      <strong>{{ item.name }}</strong>
      <p class="field-hint">
        {{ item.ownerPublicId }} ·
        {{ s(item.role as 'contributor' | 'curator' | 'viewer') }}
      </p>
      <p v-if="item.expiresAt <= Date.now()" class="field-hint">
        {{ w('expired') }}
      </p>
      <div class="inline-actions">
        <button
          class="primary-button"
          :disabled="!!busy || item.expiresAt <= Date.now()"
          @click="answer(item.id, true)"
        >
          {{ w('accept') }}</button
        ><button
          class="secondary-button"
          :disabled="!!busy"
          @click="answer(item.id, false)"
        >
          {{ w('decline') }}
        </button>
      </div>
    </article>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>
