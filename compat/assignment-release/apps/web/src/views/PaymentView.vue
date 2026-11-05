<script setup lang="ts">
import { computed, ref } from 'vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import { locale, formatNumber } from '../i18n'
import { plans, type BillingPeriod, type Plan, type PlanId } from '../payments/catalog'
import { paymentProviders, type PaymentProviderId } from '../payments/providers'

const selected = ref<PlanId>('go'), period = ref<BillingPeriod>('year')
const providerId = ref<PaymentProviderId>('depay'), notice = ref('')
const ru = computed(() => locale.value === 'ru')
const plan = computed(() => plans.find(item => item.id === selected.value)!)
const provider = computed(() => paymentProviders.find(item => item.id === providerId.value)!)
const price = computed(() => plan.value.prices[period.value])
const words = computed(() => ru.value ? {
  title:'Тариф и оплата',subtitle:'Выберите подходящий тариф. Оплата проходит через выбранного Web3-провайдера.',
  compare:'Сравнение тарифов',assignments:'Задания в месяц',photos:'Фотографии',ttl:'Максимальное время хранения фотографий',days:'дней',
  backups:'Автоматические резервные копии',daily:'Ежедневно',weekly:'в неделю',none:'Нет',unlimited:'Без ограничений',
  encryption:'Шифрование всех данных, включая фотографии',emergency:'Экстренное удаление данных с телефона с помощью PIN-кода',
  messaging:'Собственный сервер Matrix/Signal',storage:'Собственный сервер S3/IPFS',priority:'Приоритетная поддержка',
  included:'Включено',notIncluded:'Не включено',month:'Ежемесячно',sixMonths:'За 6 месяцев',year:'За 1 год',
  perMonth:'в месяц',save:'скидка',choose:'Выбрать',current:'Выбран',provider:'Способ оплаты',continue:'Продолжить к оплате',free:'Бесплатно',
  notConfigured:'Checkout этого провайдера ещё не настроен. Добавьте merchant URL в окружение.',setup:'Требуется настройка',
  safe:'Ключ аккаунта, фотографии, контакты и профиль не передаются платёжному провайдеру.',
} : {
  title:'Plan & payment',subtitle:'Choose the plan that fits your work. Checkout uses the Web3 provider you select.',
  compare:'Compare plans',assignments:'Assignments per month',photos:'Photos',ttl:'Maximum photo retention',days:'days',
  backups:'Automatic backups',daily:'Daily',weekly:'per week',none:'None',unlimited:'Unlimited',
  encryption:'Encryption of all data, including photos',emergency:'Emergency deletion of phone data with a PIN',
  messaging:'Your own Matrix/Signal server',storage:'Your own S3/IPFS server',priority:'Priority support',
  included:'Included',notIncluded:'Not included',month:'Monthly',sixMonths:'6 months',year:'1 year',
  perMonth:'per month',save:'save',choose:'Choose',current:'Selected',provider:'Payment provider',continue:'Continue to checkout',free:'Free',
  notConfigured:'This provider checkout is not configured yet. Add its merchant URL to the environment.',setup:'Setup required',
  safe:'Your account key, photos, contacts and profile are never shared with the payment provider.',
})
const planName = (id: PlanId) => id === 'free' ? 'Free' : id === 'go' ? 'Go' : id === 'pro' ? 'Pro' : 'Unlimited'
const periodMonths: Record<BillingPeriod, number> = { month:1, sixMonths:6, year:12 }
function discount(item: Plan, value: BillingPeriod) {
  const total = item.prices[value], monthly = item.prices.month
  if (!total || !monthly || value === 'month') return 0
  return Math.round((1 - total / (monthly * periodMonths[value])) * 100)
}
function monthly(item: Plan, value: BillingPeriod) {
  const total = item.prices[value]
  return total ? total / periodMonths[value] : 0
}
function choose(id: PlanId) { selected.value = id; notice.value = '' }
function ttl(item: Plan) { return item.ttlDays === null ? words.value.unlimited : `${item.ttlDays} ${words.value.days}` }
function limit(value: number | null) { return value === null ? words.value.unlimited : formatNumber(value) }
function backups(item: Plan) {
  if (!item.backupsPerWeek) return words.value.none
  return item.backupsPerWeek >= 7 ? words.value.daily : `${item.backupsPerWeek} ${words.value.weekly}`
}
const featureRows = computed(() => [
  { label:words.value.assignments, value:(item:Plan) => limit(item.assignments) },
  { label:words.value.photos, value:(item:Plan) => limit(item.photos) },
  { label:words.value.ttl, value:ttl },
  { label:words.value.backups, value:backups },
  { label:words.value.encryption, value:() => words.value.included },
  { label:words.value.emergency, value:() => words.value.included },
  { label:words.value.messaging, value:(item:Plan) => item.ownMessagingServer ? words.value.included : words.value.notIncluded },
  { label:words.value.storage, value:(item:Plan) => item.ownStorageServer ? words.value.included : words.value.notIncluded },
  { label:words.value.priority, value:(item:Plan) => item.prioritySupport ? words.value.included : words.value.notIncluded },
])
function checkout() {
  notice.value = ''
  if (selected.value === 'free' || !price.value) return
  try { provider.value.start({ plan: selected.value, period: period.value, amountUsd: price.value }) }
  catch { notice.value = words.value.notConfigured }
}
</script>

<template>
  <section class="native-screen payment-screen">
    <ScreenHeader :title="words.title" back="/profile" />
    <div class="screen-body payment-body">
      <section class="payment-intro">
        <span class="payment-emblem"><AppIcon name="star" /></span>
        <h2>{{ words.title }}</h2><p>{{ words.subtitle }}</p>
      </section>

      <div class="plan-selector" role="radiogroup" :aria-label="words.title">
        <button v-for="item in plans" :key="item.id" type="button" role="radio"
          :aria-checked="selected === item.id" :class="{ selected: selected === item.id }" @click="choose(item.id)">
          <span class="plan-radio"><AppIcon v-if="selected === item.id" name="check" /></span>
          <span><strong>{{ planName(item.id) }}</strong><small>{{ item.id === 'free' ? words.free : `$${item.prices.month} / ${words.perMonth}` }}</small></span>
        </button>
      </div>

      <section v-if="selected !== 'free'" class="billing-card">
        <button v-for="value in (['year','sixMonths','month'] as BillingPeriod[])" :key="value" type="button"
          :aria-pressed="period === value" @click="period = value">
          <span class="plan-radio"><AppIcon v-if="period === value" name="check" /></span>
          <span class="billing-copy"><strong>{{ words[value] }} <em v-if="discount(plan,value)">−{{ discount(plan,value) }}%</em></strong>
            <small>${{ formatNumber(monthly(plan,value)) }} / {{ words.perMonth }}</small></span>
          <strong>${{ formatNumber(plan.prices[value] || 0) }}</strong>
        </button>
      </section>

      <section class="plan-benefits">
        <h2>{{ planName(selected) }}</h2>
        <div v-for="row in featureRows" :key="row.label" class="plan-benefit-row">
          <span class="benefit-icon"><AppIcon name="check" /></span>
          <span><strong>{{ row.label }}</strong><small>{{ row.value(plan) }}</small></span>
        </div>
      </section>

      <section class="plan-matrix-section">
        <h2>{{ words.compare }}</h2>
        <div class="plan-matrix-scroll">
          <table class="plan-matrix"><thead><tr><th></th><th v-for="item in plans" :key="item.id">{{ planName(item.id) }}</th></tr></thead>
            <tbody><tr v-for="row in featureRows" :key="row.label"><th>{{ row.label }}</th>
              <td v-for="item in plans" :key="item.id">{{ row.value(item) }}</td></tr></tbody>
          </table>
        </div>
      </section>

      <section v-if="selected !== 'free'" class="provider-card">
        <h2>{{ words.provider }}</h2>
        <label v-for="item in paymentProviders" :key="item.id" :class="{ selected: providerId === item.id }">
          <input v-model="providerId" type="radio" :value="item.id" />
          <span class="plan-radio"><AppIcon v-if="providerId === item.id" name="check" /></span>
          <span><strong>{{ item.label }}</strong><small v-if="!item.configured">{{ words.setup }}</small></span>
        </label>
        <p class="field-hint">{{ words.safe }}</p>
      </section>

      <div class="payment-checkout-dock">
        <span><strong>{{ planName(selected) }}</strong><small v-if="selected !== 'free'">${{ formatNumber(price || 0) }}</small></span>
        <button class="primary-button" type="button" :disabled="selected === 'free'" @click="checkout">
          {{ selected === 'free' ? words.current : words.continue }}
        </button>
      </div>
      <p v-if="notice" class="form-error" role="alert">{{ notice }}</p>
    </div>
  </section>
</template>
