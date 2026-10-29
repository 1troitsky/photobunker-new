<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { accept } from '../collaboration/api'
import { c } from '../collaboration/text'
import { refreshProfiles } from '../profiles/store'
import { refreshAssignments } from '../collaboration/store'
import { libraryChanged } from '../local/library'
const router = useRouter(); const code = ref(''); const nickname = ref(''); const busy = ref(false); const error = ref(false)
async function join() { busy.value = true; error.value = false; try { await accept(code.value, nickname.value); code.value = ''; await Promise.all([refreshProfiles(), refreshAssignments()]); libraryChanged(); await router.push('/assignments') } catch { error.value = true } finally { busy.value = false } }
</script>
<template><section class="content-screen team-screen"><RouterLink to="/camera/presets" class="back-link">← {{ c('profile') }}</RouterLink><header class="page-heading"><h1>{{ c('join') }}</h1><p>{{ c('joinHint') }}</p></header><form class="team-form" @submit.prevent="join"><label>{{ c('invitation') }}<input v-model="code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required pattern="[a-fA-F0-9]{64}" :disabled="busy"></label><label>{{ c('nickname') }}<input v-model="nickname" required maxlength="80" :disabled="busy"></label><button class="primary-button" :disabled="busy">{{ c('join') }}</button><p v-if="error" role="alert">{{ c('failed') }}</p></form></section></template>
