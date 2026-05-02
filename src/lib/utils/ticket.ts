export function ticketUrl(token: string, base?: string): string {
  const origin = (base || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')
  return `${origin}/ticket/${token}`
}
