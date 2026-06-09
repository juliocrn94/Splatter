const attempts = new Map()
export function checkRateLimit(ip) {
  const now = Date.now()
  const window = 15 * 60 * 1000
  const key = ip || "unknown"
  const record = attempts.get(key) || { count: 0, reset: now + window }
  if (now > record.reset) { record.count = 0; record.reset = now + window }
  record.count++
  attempts.set(key, record)
  return { allowed: record.count <= 10, retryAfter: Math.ceil((record.reset - now) / 1000) }
}
