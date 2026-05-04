/**
 * Generate a CSV string from an array of objects and trigger download.
 */
export function downloadCSV(data: Record<string, unknown>[], filename: string): void {
  if (data.length === 0) return

  const headers = Object.keys(data[0])
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h]
      let str = val == null ? '' : String(val)
      // CSV injection guard: cells starting with =, +, -, @, tab, or CR
      // are interpreted as formulas by Excel/Sheets. Prefix with a single
      // quote so they render as literal text.
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`
      }
      // Escape quotes and wrap in quotes if contains comma/newline/quote
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }).join(',')
  )

  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()

  URL.revokeObjectURL(url)
}
