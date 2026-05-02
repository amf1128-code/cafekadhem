export function ticketUrl(token: string): string {
  const base =
    import.meta.env.VITE_SITE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base.replace(/\/$/, '')}/ticket/${token}`
}
