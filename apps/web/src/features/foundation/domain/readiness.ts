export type FoundationReadiness = Readonly<{
  productionBuild: true
  legacyRuntimeIncluded: false
  messengerIncluded: false
}>

export const foundationReadiness: FoundationReadiness = Object.freeze({
  productionBuild: true,
  legacyRuntimeIncluded: false,
  messengerIncluded: false,
})
