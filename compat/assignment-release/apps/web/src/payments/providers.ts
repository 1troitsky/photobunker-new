import type { BillingPeriod, PlanId } from './catalog'

export type PaymentProviderId = 'depay' | 'nowpayments'
export type CheckoutRequest = { plan: Exclude<PlanId, 'free'>; period: BillingPeriod; amountUsd: number }
export interface PaymentProvider {
  id: PaymentProviderId
  label: string
  configured: boolean
  start(request: CheckoutRequest): void
}

function hosted(id: PaymentProviderId, label: string, endpoint?: string): PaymentProvider {
  return { id, label, configured: !!endpoint, start(request) {
    if (!endpoint) throw new Error('payment.not_configured')
    const url = new URL(endpoint)
    // Never put account, recovery, photo or profile identifiers in this URL.
    url.searchParams.set('plan', request.plan)
    url.searchParams.set('period', request.period)
    url.searchParams.set('amount', String(request.amountUsd))
    window.location.assign(url)
  } }
}

export const paymentProviders: PaymentProvider[] = [
  hosted('depay', 'DePay', import.meta.env.VITE_DEPAY_CHECKOUT_URL),
  hosted('nowpayments', 'NOWPayments', import.meta.env.VITE_NOWPAYMENTS_CHECKOUT_URL),
]
