<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { profiles, refreshProfiles } from '../profiles/store'
import { createAssignment, invite, revokeInvite, shareProfile, team, updateMember } from '../collaboration/api'
import { refreshAssignments } from '../collaboration/store'
import { c } from '../collaboration/text'
import type { Invitation, Member, Role, Space } from '../collaboration/model'
import { locale, t } from '../i18n'
const route = useRoute(); const router = useRouter()
const profile = computed(() => profiles.value.find(item => item.id === route.params.id))
const space = ref<Space>(); const members = ref<Member[]>([]); const invitations = ref<Invitation[]>([])
const busy = ref(false); const error = ref(false); const loaded = ref(false); const code = ref('')
const role = ref<Exclude<Role, 'owner'>>('contributor'); const readOwn = ref(false); const manageProfiles = ref(false); const duration = ref(86400)
const name = ref(''); const instructions = ref(''); const assignees = ref<string[]>([]); const shots = ref(''); const due = ref('')
const canManage = computed(() => ['owner','curator'].includes(space.value?.role ?? ''))
async function load() { error.value = false; try { await refreshProfiles(); if (profile.value?.spaceId) { const data = await team(profile.value.spaceId); space.value = data.space; members.value = data.members; invitations.value = data.invitations } shots.value ||= profile.value?.rules.shotList.join('\n') ?? '' } catch { error.value = true } finally { loaded.value = true } }
async function action(work: () => Promise<unknown>) { if (busy.value) return; busy.value = true; error.value = false; try { await work(); await load() } catch { error.value = true } finally { busy.value = false } }
function enable() { if (profile.value) void action(async () => { await shareProfile(profile.value!) }) }
function makeInvite() { if (space.value) void action(async () => { const result = await invite(space.value!.id, role.value, readOwn.value, manageProfiles.value, duration.value); code.value = result.code }) }
function removeInvite(id: string) { if (confirm(c('revokeConfirm'))) void action(() => revokeInvite(id)) }
function saveMember(member: Member, remove = false) { if (remove && !confirm(c('revokeConfirm'))) return; void action(() => updateMember(space.value!.id, { ...member, active: !remove })) }
async function makeTask() {
  await action(async () => {
    const task = await createAssignment({ profileId: profile.value!.id, name: name.value.trim(), instructions: instructions.value, assignees: assignees.value,
      shots: [...new Set(shots.value.split('\n').map(value => value.trim()).filter(Boolean))], dueAt: due.value ? new Date(due.value).getTime() : null })
    await refreshAssignments(); await router.push(`/assignments/${task.id}`)
  })
}
async function copy() { try { await navigator.clipboard.writeText(code.value) } catch { error.value = true } }
onMounted(load)
</script>
<template>
  <section class="content-screen team-screen"><RouterLink to="/camera/presets" class="back-link">← {{ c('profile') }}</RouterLink><header class="page-heading"><p class="eyebrow">{{ profile?.name }}</p><h1>{{ c('team') }}</h1></header><p v-if="error" class="server-warning" role="alert">{{ c('failed') }}</p><p v-if="loaded && !profile">{{ c('failed') }}</p>
    <div v-if="profile && !profile.spaceId" class="team-card"><p>{{ c('enableHint') }}</p><button class="primary-button" :disabled="busy" @click="enable">{{ c('enable') }}</button></div>
    <template v-if="space"><p class="team-role">{{ c(space.role) }} · {{ space.name }}</p><button class="quiet-button" :disabled="busy" @click="load">{{ c('refresh') }}</button><p v-if="space.role === 'contributor' && !space.readOwnPhotos" class="supporting-copy">{{ c('dropHint') }}</p><RouterLink class="secondary-button" :to="`/assignments?profile=${profile?.id}`">{{ c('tasks') }}</RouterLink>
      <section class="team-card"><h2>{{ c('members') }}</h2><article v-for="member in members" :key="member.id" class="member-row"><div><strong>{{ member.nickname || c(member.role) }}</strong><p>{{ c(member.role) }}<span v-if="!member.active"> · {{ c('revoked') }}</span></p></div><template v-if="space.role === 'owner' && member.role !== 'owner' && member.active"><label v-if="member.role === 'contributor'"><input v-model="member.readOwnPhotos" type="checkbox" :disabled="busy">{{ c('ownGallery') }}</label><label v-if="member.role === 'curator'"><input v-model="member.manageProfiles" type="checkbox" :disabled="busy">{{ c('manageProfiles') }}</label><button v-if="member.role !== 'viewer'" class="quiet-button" :disabled="busy" @click="saveMember(member)">{{ c('saveAccess') }}</button><button class="danger-button" :disabled="busy" @click="saveMember(member, true)">{{ c('revoke') }}</button></template></article></section>
      <section v-if="space.role === 'owner'" class="team-card"><h2>{{ c('invite') }}</h2><form class="team-form" @submit.prevent="makeInvite"><label>{{ c('role') }}<select v-model="role" :aria-label="c('role')" :disabled="busy"><option v-for="value in (['contributor','curator','viewer'] as const)" :key="value" :value="value">{{ c(value) }}</option></select></label><label v-if="role === 'contributor'"><input v-model="readOwn" type="checkbox" :disabled="busy">{{ c('ownGallery') }}</label><label v-if="role === 'curator'"><input v-model="manageProfiles" type="checkbox" :disabled="busy">{{ c('manageProfiles') }}</label><label>{{ c('inviteDuration') }}<select v-model.number="duration" :aria-label="c('inviteDuration')" :disabled="busy"><option :value="3600">{{ c('hour') }}</option><option :value="86400">{{ c('day') }}</option><option :value="604800">{{ c('week') }}</option></select></label><button class="primary-button" :disabled="busy">{{ c('invite') }}</button></form><div v-if="code" class="invitation-code"><p>{{ c('inviteHint') }}</p><label>{{ c('invitation') }}<textarea :value="code" readonly rows="3" spellcheck="false" autocapitalize="off" /></label><button class="quiet-button" @click="copy">{{ t('copyAccessCode') }}</button></div><h3>{{ c('invites') }}</h3><article v-for="item in invitations" :key="item.id" class="invitation-row"><span>{{ c(item.role) }} · {{ c(item.revoked ? 'revoked' : item.accepted ? 'used' : item.expiresAt <= Date.now() ? 'expired' : 'waiting') }} · {{ new Intl.DateTimeFormat(locale, { dateStyle:'short',timeStyle:'short' }).format(item.expiresAt) }}</span><button v-if="!item.revoked" class="quiet-button" :disabled="busy" @click="removeInvite(item.id)">{{ c('revoke') }}</button></article></section>
      <section v-if="canManage" class="team-card"><h2>{{ c('createTask') }}</h2><form class="team-form" @submit.prevent="makeTask"><label>{{ c('taskName') }}<input v-model="name" required maxlength="80" :disabled="busy"></label><label>{{ c('instructions') }}<textarea v-model="instructions" maxlength="4000" rows="3" :disabled="busy" /></label><fieldset :disabled="busy"><legend>{{ c('assignees') }}</legend><label v-for="member in members.filter(item => item.active && item.role !== 'viewer')" :key="member.id"><input v-model="assignees" type="checkbox" :value="member.id">{{ member.nickname || c(member.role) }}</label></fieldset><label>{{ c('shots') }}<textarea v-model="shots" maxlength="2430" rows="3" :disabled="busy" /></label><label>{{ c('due') }}<input v-model="due" type="datetime-local" :disabled="busy"></label><p class="field-hint">{{ c('dueHint') }}</p><button class="primary-button" :disabled="busy || !assignees.length">{{ c('createTask') }}</button></form></section>
    </template>
  </section>
</template>
