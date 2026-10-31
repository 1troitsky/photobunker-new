/** Read-only aggregate counts. No remote authorization or destructive capability. */
export type StoreRisk=Readonly<{
  photoJournals:number;photoCipherAssets:number;photoOutbox:number;
  assignmentPending:number;collaborationPending:number;grantPending:number;
  encryptedGrants:number;unconfirmedTotal:number
}>
