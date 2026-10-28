<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { prepareCreate, pendingCreate, finishCreate, restore, beginPairing, finishPairing } from '../index'
import { AppIcon, language, setLanguage } from '../../ui-preview'

const route=useRoute(),router=useRouter()
const creating=computed(()=>route.path.endsWith('/create'))
const key=ref(''),confirmed=ref(false),busy=ref(false),error=ref(''),generated=ref(false)
const pending=ref(false),mode=ref<'key'|'pair'>('key'),pairAccount=ref(''),pairId=ref(''),fingerprint=ref('')
const ru=computed(()=>language.value==='ru')
const txt=computed(()=>({
  create:ru.value?'Создать анонимный аккаунт':'Create anonymous account',
  restore:ru.value?'Восстановить доступ':'Restore access',
  intro:ru.value?'Только один ключ восстановления. Никакой почты, телефона или пароля.':'One Account Recovery Key. No email, phone or password.',
  noReset:ru.value?'Потеря ключа и всех доверенных устройств навсегда лишает доступа. Поддержка не сможет восстановить данные.':
    'Losing this key and every trusted device means permanent loss of access. Support cannot reset it.',
  generate:ru.value?'Создать ключ восстановления':'Generate Recovery Key',
  generated:ru.value?'Ваш секретный ключ (сохраните его вне приложения)':'Your secret key (save it outside the app)',
  saved:ru.value?'Я надёжно сохранил ключ и понимаю, что восстановить его невозможно':
    'I saved the key securely and understand there is no recovery without it',
  continue:ru.value?'Подтвердить и создать аккаунт':'Confirm and create account',
  restoreKey:ru.value?'Вставьте сохранённый Recovery Key':'Enter your saved Recovery Key',
  restoreButton:ru.value?'Восстановить аккаунт':'Restore account',
  resume:ru.value?'Обнаружено незавершённое создание аккаунта. Для продолжения введите ранее сохранённый ключ; новый аккаунт не создаётся.':
    'An unfinished registration was found. Enter the previously saved key to resume; no new account is generated.',
  pair:ru.value?'Подключиться через доверенное устройство':'Pair with an existing trusted device',
  accountId:ru.value?'ID аккаунта с другого устройства':'Account ID from the other device',
  pairStart:ru.value?'Начать подключение':'Start pairing',
  pairCode:ru.value?'Сравните отпечаток на обоих устройствах:':'Compare the fingerprint on both devices:',
  pairFinish:ru.value?'Проверить подтверждение и завершить':'Check approval and finish',
  working:ru.value?'Выполняется…':'Working…',
  error:ru.value?'Операция не завершена. Проверьте соединение, ключ и состояние устройства. Код:':
    'Operation not completed. Check connection, key and device state. Code:',
  preview:ru.value?'Остальные экраны пока содержат демонстрационные данные.':'Other screens still contain preview fixtures.',
  back:ru.value?'Назад':'Back',
}))
onMounted(async()=>{
  if(creating.value)try{pending.value=await pendingCreate()}catch{pending.value=false}
})
function message(e:unknown){error.value=txt.value.error+' '+(e instanceof Error?e.message:'identity.error')}
async function generate(){
  busy.value=true;error.value=''
  try {key.value=await prepareCreate();generated.value=true}
  catch(e){message(e)}
  finally{busy.value=false}
}
async function submit(){
  busy.value=true;error.value=''
  try{
    if(creating.value)await finishCreate(key.value.trim())
    else await restore(key.value.trim())
    key.value='';confirmed.value=false
    await router.replace('/profile')
  }catch(e){message(e)}finally{busy.value=false}
}
async function pairStart(){
  busy.value=true;error.value=''
  try{
    const result=await beginPairing(pairAccount.value.trim())
    pairId.value=result.id;fingerprint.value=result.fingerprint
  }catch(e){message(e)}finally{busy.value=false}
}
async function pairFinish(){
  busy.value=true;error.value=''
  try{await finishPairing();await router.replace('/profile')}
  catch(e){message(e)}finally{busy.value=false}
}
</script>
<template>
  <section
    class="account-preview"
    data-testid="identity-v2"
  >
    <div class="account-card">
      <header class="account-header">
        <RouterLink
          to="/welcome"
          class="icon-button"
          :aria-label="txt.back"
        ><AppIcon name="back" /></RouterLink>
        <button
          class="language-button"
          type="button"
          @click="setLanguage(language==='ru'?'en':'ru')"
        >
          <AppIcon name="globe" />{{ language.toUpperCase() }}
        </button>
      </header>
      <img
        src="/icons/brand-logo.png"
        alt=""
        class="account-logo"
        width="80"
        height="80"
      >
      <span class="eyebrow">PhotoBunker · Identity PB2</span>
      <h1>{{ creating?txt.create:txt.restore }}</h1>
      <p class="account-lead">
        {{ txt.intro }}
      </p>
      <p class="account-warning">
        <AppIcon name="shield" />{{ txt.noReset }}
      </p>
      <p
        v-if="creating && pending"
        class="account-explanation"
        role="status"
      >
        {{ txt.resume }}
      </p>
      <template v-if="!creating || generated || pending">
        <div
          v-if="!creating"
          class="pill-group identity-mode"
          :aria-label="txt.restore"
        >
          <button
            type="button"
            :class="{selected:mode==='key'}"
            :aria-pressed="mode==='key'"
            @click="mode='key'"
          >
            Recovery Key
          </button>
          <button
            type="button"
            :class="{selected:mode==='pair'}"
            :aria-pressed="mode==='pair'"
            @click="mode='pair'"
          >
            {{ txt.pair }}
          </button>
        </div>
        <form
          v-if="creating || mode==='key'"
          class="identity-form"
          autocomplete="off"
          @submit.prevent="submit"
        >
          <label for="identity-key">{{ creating && !pending?txt.generated:txt.restoreKey }}</label>
          <textarea
            id="identity-key"
            v-model="key"
            rows="4"
            spellcheck="false"
            autocapitalize="none"
            autocomplete="off"
            :readonly="creating && !pending"
            :placeholder="creating && !pending?'PB2.…':'PB2.…'"
          />
          <label
            v-if="creating"
            class="identity-confirm"
          >
            <input
              v-model="confirmed"
              type="checkbox"
            >{{ txt.saved }}
          </label>
          <button
            class="primary-button account-browse"
            type="submit"
            :disabled="busy || !key || (creating&&!confirmed)"
          >
            {{ busy?txt.working:creating?txt.continue:txt.restoreButton }} <AppIcon name="arrow" />
          </button>
        </form>
        <form
          v-else
          class="identity-form"
          @submit.prevent="pairId?pairFinish():pairStart()"
        >
          <label for="pair-account">{{ txt.accountId }}</label>
          <input
            id="pair-account"
            v-model="pairAccount"
            :readonly="!!pairId"
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
          >
          <p
            v-if="pairId"
            class="identity-fingerprint"
            role="status"
          >
            {{ txt.pairCode }} <strong>{{ fingerprint.slice(0,12) }}</strong><small>{{ pairId }}</small>
          </p>
          <button
            class="primary-button account-browse"
            type="submit"
            :disabled="busy || !pairAccount"
          >
            {{ busy?txt.working:pairId?txt.pairFinish:txt.pairStart }}
          </button>
        </form>
      </template>
      <button
        v-else
        class="primary-button account-browse"
        type="button"
        :disabled="busy"
        @click="generate"
      >
        {{ busy?txt.working:txt.generate }} <AppIcon name="key" />
      </button>
      <p
        v-if="error"
        role="alert"
        class="identity-error"
      >
        {{ error }}
      </p>
      <p class="hint">
        {{ txt.preview }}
      </p>
      <RouterLink
        class="account-alternative"
        :to="creating?'/account/restore':'/account/create'"
      >
        {{ creating?txt.restore:txt.create }}
      </RouterLink>
    </div>
  </section>
</template>
