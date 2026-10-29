<script setup lang="ts">
import { computed, ref } from 'vue'
import { receipts } from '../workspace/state'
import { protectionEnabled } from '../crypto/store'
import { respond as encryptedRespond } from '../crypto/photos'
import { request } from '../workspace/api'
import { refreshLibrary } from '../local/library'
import { workspaceError } from '../workspace/errors'
import { c } from '../collaboration/text'
import { w } from '../workspace/text'
const props = defineProps<{ assignmentId: string }>(),
  busy = ref(''),
  error = ref(''),
  answers = ref<Record<string, string>>({})
const rows = computed(() =>
  receipts.value.filter((item) => item.assignmentId === props.assignmentId),
)
async function answer(item: (typeof receipts.value)[number]) {
  if (busy.value || !answers.value[item.id]?.trim()) return
  busy.value = item.id
  try {
    if(protectionEnabled.value)await encryptedRespond(item.id,answers.value[item.id]!,item.reviewRevision??1)
    else await request(`/photos/${item.id}/response`, 'POST', {
      revision: item.reviewRevision ?? 1,
      comment: answers.value[item.id],
    })
    answers.value[item.id] = ''
    await refreshLibrary()
  } catch (failure) {
    error.value = workspaceError(failure)
  } finally {
    busy.value = ''
  }
}
</script>
<template>
  <section v-if="rows.length" class="workspace-receipts">
    <h2>{{ w('uploaded') }}</h2>
    <article v-for="item in rows" :key="item.id" class="form-card">
      <strong>{{ item.id.slice(0, 8).toUpperCase() }}</strong>
      <p>
        {{ w('received') }} ·
        {{
          c(
            (item.reviewState ?? 'pending') as
              'pending' | 'accepted' | 'correction' | 'reshoot' | 'rejected',
          )
        }}
      </p>
      <p v-if="item.reviewComment">{{ item.reviewComment }}</p>
      <p v-if="item.responseComment">{{ item.responseComment }}</p>
      <form
        v-if="['correction', 'reshoot'].includes(item.reviewState ?? '')"
        class="native-form"
        @submit.prevent="answer(item)"
      >
        <label
          >{{ c('comment')
          }}<textarea
            v-model="answers[item.id]"
            rows="2"
            maxlength="2000"
            required
          /></label
        ><button class="secondary-button" :disabled="!!busy">
          {{ w('save') }}
        </button>
      </form>
    </article>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>
