// src/lib/utils.ts

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`
}

export function daysAgo(days: number, hours = 0): string {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString()
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const units: Array<[number, string]> = [
    [31_536_000, 'year'],
    [2_592_000, 'month'],
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
  ]
  for (const [size, label] of units) {
    const n = Math.floor(seconds / size)
    if (n >= 1) return `${n} ${label}${n > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
}

export function isPhone(v: string): boolean {
  return v.replace(/[^\d]/g, '').length >= 10
}

/** Minimal CSV parser: handles quoted fields, escaped quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable — ignore */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}

/** WhatsApp template names: lowercase letters, numbers and underscores only. */
export function toTemplateName(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').slice(0, 60)
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => vars[key] ?? m)
}
