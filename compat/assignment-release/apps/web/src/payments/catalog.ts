export type PlanId = 'free' | 'go' | 'pro' | 'unlimited'
export type BillingPeriod = 'month' | 'sixMonths' | 'year'

export type Plan = {
  id: PlanId
  assignments: number | null
  photos: number | null
  ttlDays: number | null
  backupsPerWeek: number
  emergencyCloud: boolean
  ownMessagingServer: boolean
  ownStorageServer: boolean
  prioritySupport: boolean
  prices: Partial<Record<BillingPeriod, number>>
}

export const plans: Plan[] = [
  { id: 'free', assignments: 3, photos: 50, ttlDays: 14, backupsPerWeek: 0,
    emergencyCloud: false, ownMessagingServer: false, ownStorageServer: false,
    prioritySupport: false, prices: {} },
  { id: 'go', assignments: 10, photos: 200, ttlDays: 30, backupsPerWeek: 1,
    emergencyCloud: true, ownMessagingServer: false, ownStorageServer: false,
    prioritySupport: false, prices: { month: 15, sixMonths: 80, year: 140 } },
  { id: 'pro', assignments: 50, photos: 1000, ttlDays: 60, backupsPerWeek: 5,
    emergencyCloud: true, ownMessagingServer: true, ownStorageServer: true,
    prioritySupport: false, prices: { month: 25, sixMonths: 140, year: 240 } },
  { id: 'unlimited', assignments: null, photos: null, ttlDays: null, backupsPerWeek: 7,
    emergencyCloud: true, ownMessagingServer: true, ownStorageServer: true,
    prioritySupport: true, prices: { month: 40, sixMonths: 220, year: 370 } },
]
