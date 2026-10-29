import { ref } from 'vue'
export const protectionEnabled = ref(false),
  protectionReady = ref(false),
  strongUnlocked = ref(false),
  warmLocked = ref(false),
  lockGeneration = ref(0),
  cryptoError = ref('')
export const photoReadAllowed = () => strongUnlocked.value && !warmLocked.value
