import { ref } from 'vue'
import type { Invitation } from './api'
export const invitations = ref<Invitation[]>([]),
  pendingCount = ref(0),
  queueBusy = ref(false),
  queueError = ref('')

export const receipts = ref<
  {
    id: string
    assignmentId: string
    expiresAt: number
    state: string
    reviewState?: string
    reviewRevision?: number
    reviewComment?: string
    responseComment?: string
  }[]
>([])
