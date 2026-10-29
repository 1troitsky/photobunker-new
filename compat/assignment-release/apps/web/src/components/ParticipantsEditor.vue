<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import AppSheet from './AppSheet.vue'
import ToggleRow from './ToggleRow.vue'
import { clone, type Participant } from '../studio/model'
import { account, type Person } from '../identity/store'
import { identityRequest } from '../identity/api'
import { a } from '../identity/text'
import { avatarColor, initials } from '../messages/presentation'
import { w } from '../workspace/text'
import { s } from '../studio/text'
const props = defineProps<{
  modelValue: Participant[]
  invitations?: boolean
  readOnly?: boolean
  ownerPublicId?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Participant[]] }>()
const open = ref(false),
  index = ref(-1),
  error = ref('')
const contacts = ref<Person[]>([]), contactsBusy = ref(false), contactsFailed = ref(false)
const draft = ref<Participant>({
  id: '',
  name: '',
  role: 'contributor',
  notify: true,
})
function edit(value?: Participant, i = -1) {
  index.value = i
  draft.value = value
    ? clone(value)
    : { id: '', name: '', role: 'contributor', notify: !!props.invitations }
  draft.value.photoScope ||= 'default'
  error.value = ''
  open.value = true
}
const availableContacts = computed(() => contacts.value.filter(person =>
  !props.modelValue.some(participant => participant.id.toLowerCase() === person.publicId.toLowerCase()) ||
  person.publicId.toLowerCase() === draft.value.id.toLowerCase(),
))
function contactName(person: Person) {
  return person.fields.name || (person.username ? '@' + person.username : person.fields.username || person.publicId)
}
function chooseContact(person: Person) {
  draft.value.id = person.publicId
  draft.value.name = person.fields.name || person.fields.username || person.username || ''
  error.value = ''
}
async function loadContacts() {
  const owner = account.value?.id
  if (!owner || contactsBusy.value) return
  contactsBusy.value = true
  contactsFailed.value = false
  try {
    const result = await identityRequest<{ contacts: Person[] }>('/contacts')
    if (owner === account.value?.id) contacts.value = result.contacts
  } catch {
    if (owner === account.value?.id) contactsFailed.value = true
  } finally {
    if (owner === account.value?.id) contactsBusy.value = false
  }
}
watch(open, value => { if (value && account.value) void loadContacts() })
watch(
  () => account.value?.id,
  () => {
    open.value = false
    contacts.value = []
    contactsFailed.value = false
    draft.value = { id: '', name: '', role: 'contributor', notify: true }
  },
)
function save() {
  const item = {
    ...draft.value,
    id: draft.value.id.trim(),
    name: draft.value.name.trim(),
  }
  if (item.id.length < 3 || item.id.length > 120 || /\s/.test(item.id)) {
    error.value = s('required')
    return
  }
  if (
    props.modelValue.some(
      (other, i) =>
        i !== index.value && other.id.toLowerCase() === item.id.toLowerCase(),
    )
  ) {
    error.value = s('duplicateId')
    return
  }
  const result = clone(props.modelValue)
  if (index.value < 0) result.push(item)
  else result[index.value] = item
  emit('update:modelValue', result)
  open.value = false
}
</script>
<template>
  <div class="participant-list">
    <div class="participant-row owner-row">
      <span class="person-avatar"><AppIcon name="user" /></span
      ><span
        ><strong>{{
          ownerPublicId && ownerPublicId !== account?.publicId
            ? ownerPublicId
            : s('you')
        }}</strong
        ><small>{{ s('owner') }}</small></span
      ><AppIcon name="check" />
    </div>
    <div v-for="(item, i) in modelValue" :key="item.id" class="participant-row">
      <button
        type="button"
        class="participant-main"
        :disabled="readOnly"
        @click="edit(item, i)"
      >
        <span class="person-avatar">{{
          (item.name || item.id).slice(0, 1).toUpperCase()
        }}</span
        ><span
          ><strong>{{ item.name || item.id }}</strong
          ><small
            >{{ s(item.role)
            }}<template v-if="account && item.state">
              · {{ w(item.state) }}</template
            ><template v-if="item.name"> · {{ item.id }}</template></small
          ></span
        ><AppIcon name="chevron" /></button
      ><button
        v-if="!readOnly"
        type="button"
        class="app-icon-button subtle-danger"
        :aria-label="`${s('remove')}: ${item.name || item.id}`"
        @click="
          () => {
            emit(
              'update:modelValue',
              modelValue.filter((_, position) => position !== i),
            )
          }
        "
      >
        <AppIcon name="close" />
      </button>
    </div>
    <button
      v-if="!readOnly"
      type="button"
      class="row-add"
      :disabled="modelValue.length >= 100"
      @click="edit()"
    >
      <AppIcon name="plus" />{{ s('addParticipant') }}
    </button>
  </div>
  <AppSheet
    :open="open"
    :title="s(index < 0 ? 'addParticipant' : 'editParticipant')"
    @close="open = false"
    ><form class="native-form" @submit.prevent.stop="save">
      <div v-if="account && index < 0" class="participant-contact-picker">
        <span class="field-hint">{{ a('contacts') }}</span>
        <p v-if="contactsBusy" class="field-hint" role="status">{{ a('contacts') }}…</p>
        <button
          v-for="person in availableContacts"
          :key="person.publicId"
          type="button"
          class="picker-row participant-contact-row"
          :aria-pressed="draft.id === person.publicId"
          @click="chooseContact(person)"
        >
          <span :class="['chat-avatar', avatarColor(person.publicId)]">{{ initials(contactName(person)) }}</span>
          <span class="participant-contact-copy"><strong>{{ contactName(person) }}</strong><small v-if="contactName(person) !== person.publicId">{{ person.publicId }}</small></span>
          <AppIcon :name="draft.id === person.publicId ? 'check' : 'chevron'" />
        </button>
        <p v-if="!contactsBusy && !contactsFailed && !availableContacts.length" class="field-hint">{{ a('emptyContacts') }}</p>
        <p v-if="contactsFailed" class="form-error" role="alert">{{ a('failed') }}</p>
      </div>
      <label
        >{{ s('participantId')
        }}<input
          v-model="draft.id"
          required
          minlength="3"
          maxlength="120"
          autocapitalize="off"
          spellcheck="false"
          :aria-label="s('participantId')" /></label
      ><label
        >{{ s('participantName')
        }}<input
          v-model="draft.name"
          maxlength="80"
          :placeholder="s('optional')" /></label
      ><label
        >{{ s('role')
        }}<select :aria-label="s('role')" v-model="draft.role">
          <option
            v-for="role in ['contributor', 'curator', 'viewer'] as const"
            :key="role"
            :value="role"
          >
            {{ s(role) }}
          </option>
        </select></label
      ><label v-if="account && invitations"
        >{{ w('photoScope')
        }}<select v-model="draft.photoScope" :aria-label="w('photoScope')">
          <option value="default">{{ w('defaultScope') }}</option>
          <option value="none">{{ w('none') }}</option>
          <option value="thumbnails">{{ w('thumbnails') }}</option>
          <option value="all">
            {{ w(draft.role === 'contributor' ? 'own' : 'all') }}
          </option>
        </select></label
      >
      <p v-if="account" class="field-hint">{{ w('inviteHint') }}</p>
      <ToggleRow
        v-if="invitations && !account"
        v-model="draft.notify"
        :label="s('notify')"
        :hint="s('notifyHint')"
      />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button type="submit" class="primary-button full-button">
        {{ s('done') }}
      </button>
    </form></AppSheet
  >
</template>
