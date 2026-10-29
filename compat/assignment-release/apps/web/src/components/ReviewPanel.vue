<script setup lang="ts">
import { ref, watch } from 'vue'
import { review } from '../collaboration/api'
import { c } from '../collaboration/text'
import type { ReviewState } from '../collaboration/model'
import { IdentityError } from '../identity/api'
import { ServerError } from '../server/api'
const props = defineProps<{
  id: string
  revision: number
  state: ReviewState
  comment?: string
}>()
const emit = defineEmits<{ changed: [] }>()
const decision = ref<Exclude<ReviewState, 'pending'>>('accepted')
const comment = ref('')
const busy = ref(false)
const edited = ref(false)
const base = ref(props.revision)
const status = ref<'reviewed' | 'failed' | 'conflict'>()
function reset() {
  decision.value = props.state === 'pending' ? 'accepted' : props.state
  comment.value = props.comment ?? ''
  base.value = props.revision
  edited.value = false
  status.value = undefined
}
watch(
  () => props.revision,
  () => {
    if (edited.value) status.value = 'conflict'
    else reset()
  },
  { immediate: true },
)
async function save() {
  if (busy.value) return
  busy.value = true
  status.value = undefined
  try {
    await review(props.id, decision.value, comment.value, base.value)
    edited.value = false
    status.value = 'reviewed'
    emit('changed')
  } catch (error) {
    status.value =
      (error instanceof ServerError || error instanceof IdentityError) &&
      error.status === 409
        ? 'conflict'
        : 'failed'
    emit('changed')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <form class="review-panel" @submit.prevent="save">
    <h3>{{ c('review') }}</h3>
    <label
      >{{ c('decision')
      }}<select
        v-model="decision"
        :aria-label="c('decision')"
        :disabled="busy"
        @change="edited = true"
      >
        <option
          v-for="value in [
            'accepted',
            'correction',
            'reshoot',
            'rejected',
          ] as const"
          :key="value"
          :value="value"
        >
          {{ c(value) }}
        </option>
      </select></label
    ><label
      >{{ c('comment')
      }}<textarea
        v-model="comment"
        :aria-label="c('comment')"
        :required="decision !== 'accepted'"
        maxlength="2000"
        rows="2"
        :disabled="busy"
        @input="edited = true"
      /></label
    ><button class="primary-button" :disabled="busy || status === 'conflict'">
      {{ c('reviewSave') }}</button
    ><button
      v-if="status === 'conflict'"
      type="button"
      class="quiet-button"
      @click="reset"
    >
      {{ c('refresh') }}
    </button>
    <p v-if="status" role="status">{{ c(status) }}</p>
  </form>
</template>
