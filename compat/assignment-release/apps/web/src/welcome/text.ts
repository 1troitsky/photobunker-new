import { locale } from '../i18n'

type Benefit = { title: string; description: string }

const copy = {
  en: {
    brand: 'PhotoBunker',
    lead: 'Capture. Protect. Share. On your terms.',
    create: 'Create New Account',
    createHint: 'No email or phone number required',
    recover: 'Recover Account',
    recoverHint: 'Use your saved account key',
    why: 'Why PhotoBunker?',
    features: [
      { title: 'Shoot privately.', description: "Photos captured in PhotoBunker stay out of your phone's gallery." },
      { title: 'Share on your terms.', description: 'Choose who can view or download a shared photo — and for how long.' },
      { title: 'Keep assignments together.', description: 'Organize photos and work with people in shared assignments.' },
      { title: 'Every shot has context.', description: 'Keep capture time and optional location information with your photos.' },
      { title: 'Private conversations.', description: 'Exchange end-to-end encrypted text messages with your contacts.' },
      { title: 'No email. No phone number.', description: 'Create an account with a recovery key. Keep that key somewhere safe.' },
    ] satisfies Benefit[],
    previous: 'Previous advantage',
    next: 'Next advantage',
    goTo: 'Show advantage',
    position: 'of',
    changeLanguage: 'Switch to Russian',
    restoring: 'Checking your existing session…',
    carouselHelp: 'Swipe left or right, or use the arrow keys to browse the advantages.',
  },
  ru: {
    brand: 'PhotoBunker',
    lead: 'Снимайте. Защищайте. Делитесь. На своих условиях.',
    create: 'Создать новый аккаунт',
    createHint: 'Без электронной почты и телефона',
    recover: 'Восстановить аккаунт',
    recoverHint: 'С помощью сохранённого ключа',
    why: 'Зачем PhotoBunker?',
    features: [
      { title: 'Снимайте приватно.', description: 'Снимки из PhotoBunker не попадают в обычную галерею телефона.' },
      { title: 'Делитесь на своих условиях.', description: 'Выбирайте, кому доступен снимок, можно ли его скачать и на какой срок.' },
      { title: 'Задания в одном месте.', description: 'Организуйте снимки и совместную работу участников внутри заданий.' },
      { title: 'У каждого кадра есть контекст.', description: 'Сохраняйте время съёмки и, по желанию, данные о местоположении.' },
      { title: 'Приватная переписка.', description: 'Обменивайтесь текстовыми сообщениями со сквозным шифрованием.' },
      { title: 'Без почты и телефона.', description: 'Создайте аккаунт с ключом восстановления и сохраните его в надёжном месте.' },
    ] satisfies Benefit[],
    previous: 'Предыдущее преимущество',
    next: 'Следующее преимущество',
    goTo: 'Показать преимущество',
    position: 'из',
    changeLanguage: 'Switch to English',
    restoring: 'Проверяем существующую сессию…',
    carouselHelp: 'Листайте преимущества влево или вправо либо используйте клавиши со стрелками.',
  },
} as const

export function welcomeText() { return copy[locale.value] }
