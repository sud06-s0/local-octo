// src/pages/AuditPublic.tsx
// Public audit report: /audit-report/<share_token>. No login, no app shell.

import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { AuditReport, type Report } from '../components/audit/AuditReport'
import { brand } from '../config/brand'

const API = `${((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').trim()}/functions/v1/audit-public`
const KEY = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '').trim()

export default function AuditPublic({ token }: { token: string }) {
  const [data, setData] = useState<{ createdAt: string; report: Report } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}?t=${encodeURIComponent(token)}`, { headers: { apikey: KEY } })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error ?? 'Report not found')
        setData(body)
        document.title = `${body.report?.business?.name ?? 'Audit'} — ${brand.appName}`
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Report not found'))
  }, [token])

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <header className="border-b border-line bg-white print:border-0">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2">
            <img src={brand.logoUrl} alt="" className="size-8 object-contain" />
            <span className="font-semibold text-ink">{brand.appName}</span>
          </span>
          {data && (
            <button onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm hover:bg-canvas print:hidden">
              <Download className="size-4" /> Download PDF
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1000px] px-4 py-6">
        {error ? (
          <p className="py-20 text-center text-muted">{error}</p>
        ) : data ? (
          <AuditReport report={data.report} createdAt={data.createdAt} />
        ) : (
          <div className="flex h-64 items-center justify-center">
            <span className="size-8 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-700" />
          </div>
        )}
      </main>
    </div>
  )
}
