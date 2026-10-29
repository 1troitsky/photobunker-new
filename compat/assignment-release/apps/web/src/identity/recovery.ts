export function parseRecoveryBackup(value: string): { accountKey: string; photoKey?: string } {
  const lines = value.trim().split(/\s+/)
  if (value.length > 8192 || lines.length < 1 || lines.length > 2)
    throw new Error('invalid_backup')
  const accounts = lines.filter((line) => /^PB1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(line))
  const photos = lines.filter((line) => /^PB4\.[A-Za-z0-9_.-]+$/.test(line))
  if (accounts.length !== 1 || accounts.length + photos.length !== lines.length)
    throw new Error('invalid_backup')
  return { accountKey: accounts[0]!, photoKey: photos[0] }
}
