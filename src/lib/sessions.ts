const sessions = new Map()
export function addSession(token: string): void {
  sessions.set(token, Date.now() + 30 * 24 * 60 * 60 * 1000)
}
export function isValidSession(token: string): boolean {
  const exp = sessions.get(token)
  if (!exp) return false
  if (Date.now() > exp) { sessions.delete(token); return false }
  return true
}
