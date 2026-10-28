/* R2-02: inert presentation fixtures. NEVER treated as saved photos or account data. */
export type Localized = Readonly<{ en: string; ru: string }>
export type PhotoFixture = Readonly<{
  id: string; title: Localized; date: string; assignment: string; art: string; tag: string
}>
export type AssignmentFixture = Readonly<{
  id: string; title: Localized; description: Localized; status: 'active'|'new'; count: number
}>
export const photoFixtures: readonly PhotoFixture[] = [
  { id:'ABCD0001', title:{en:'Mountain light',ru:'Горный свет'}, date:'28.10', assignment:'ALFA', art:'art-one', tag:'45d' },
  { id:'ABCD0002', title:{en:'Quiet morning',ru:'Тихое утро'}, date:'28.10', assignment:'ALFA', art:'art-two', tag:'30d' },
  { id:'CRST0004', title:{en:'The coastline',ru:'Береговая линия'}, date:'27.10', assignment:'COAST', art:'art-three', tag:'7d' },
  { id:'CRST0005', title:{en:'After the rain',ru:'После дождя'}, date:'27.10', assignment:'COAST', art:'art-four', tag:'7d' },
  { id:'STDO0001', title:{en:'Still life',ru:'Натюрморт'}, date:'25.10', assignment:'PERSONAL', art:'art-five', tag:'24h' },
  { id:'STDO0002', title:{en:'Evening windows',ru:'Вечерние окна'}, date:'24.10', assignment:'PERSONAL', art:'art-six', tag:'45d' },
] as const
export const assignmentFixtures: readonly AssignmentFixture[] = [
  { id:'ALFA', title:{en:'Morning field notes',ru:'Утренние наблюдения'}, description:{en:'Landscape and ambient detail — sample assignment',ru:'Пейзажи и детали окружения — пример задания'}, status:'active', count:12 },
  { id:'COAST', title:{en:'Coastline study',ru:'Исследование побережья'}, description:{en:'Documenting the shoreline — sample assignment',ru:'Документирование береговой линии — пример задания'}, status:'active', count:8 },
  { id:'ARCH', title:{en:'Architecture journal',ru:'Архитектурный журнал'}, description:{en:'Forms, materials and geometry — sample assignment',ru:'Формы, материалы и геометрия — пример задания'}, status:'new', count:0 },
] as const
