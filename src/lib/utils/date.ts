const TIMEZONE = 'America/New_York'

/**
 * Format a date string for display in Eastern time.
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: TIMEZONE,
  })
}

/**
 * Format a time string (HH:MM:SS) for display.
 */
export function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`
}

/**
 * Format date and time range for event display.
 */
export function formatEventDateTime(date: string, startTime: string, endTime?: string | null): string {
  const dateFormatted = formatDate(date)
  const start = formatTime(startTime)
  if (endTime) {
    return `${dateFormatted} at ${start} - ${formatTime(endTime)}`
  }
  return `${dateFormatted} at ${start}`
}

/**
 * Check if an event date is in the future.
 */
export function isUpcoming(dateStr: string): boolean {
  const eventDate = new Date(dateStr + 'T23:59:59')
  return eventDate >= new Date()
}
