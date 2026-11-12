// src/pages/Contacts.tsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Ban, CircleStop, Ellipsis, Filter, Search, Send, Trash2, UserPlus, Users } from 'lucide-react'
import { Badge, Button, Card, Checkbox, EmptyState, PageHeader } from '../components/ui/primitives'
import { Dropdown, MenuItem } from '../components/layout/Dropdown'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { formatDate, timeAgo } from '../lib/utils'
import type { Contact, ContactStatus } from '../types'

const statusMeta: Record<ContactStatus, { label: string; tone: 'green' | 'gray' | 'amber' | 'red' | 'blue' }> = {
  pending: { label: 'Pending', tone: 'gray' },
  sent: { label: 'Request sent', tone: 'blue' },
  clicked: { label: 'Clicked', tone: 'amber' },
  reviewed: { label: 'Left review', tone: 'green' },
  stopped: { label: 'Stopped', tone: 'red' },
}

type StatusFilter = 'all' | ContactStatus

export default function Contacts() {
  const { state, mode, updateContact, deleteContact } = useStore()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [flags, setFlags] = useState({ clicked: false, stopped: false, dnc: false, reviewed: false })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.contacts.filter((c) => {
      if (q && ![`${c.firstName} ${c.lastName}`, c.email, c.phone].some((v) => v.toLowerCase().includes(q))) return false
      if (status !== 'all' && c.status !== status) return false
      if (flags.clicked && c.status !== 'clicked') return false
      if (flags.stopped && c.status !== 'stopped') return false
      if (flags.dnc && !c.doNotContact) return false
      if (flags.reviewed && c.status !== 'reviewed') return false
      return true
    })
  }, [state.contacts, query, status, flags])

  const act = (c: Contact, action: 'send' | 'stop' | 'dnc' | 'delete') => {
    const name = `${c.firstName} ${c.lastName}`.trim()
    if (action === 'send') {
      if (c.doNotContact) return toast(`${name} is on the Do Not Contact list`, 'error')
      if (mode === 'live') {
        if (c.status === 'clicked' || c.status === 'reviewed') return toast(`${name} already ${c.status === 'clicked' ? 'opened the link' : 'left a review'}`, 'error')
        // The cron dispatcher picks it up within a minute (inside the 9 AM–7 PM window)
        updateContact(c.id, { nextSendAt: new Date().toISOString(), status: c.status === 'stopped' ? 'pending' : c.status })
        toast(`Queued — ${name} gets the request within a minute (9 AM–7 PM)`)
      } else {
        updateContact(c.id, { status: 'sent', requestsSent: c.requestsSent + 1, lastSentAt: new Date().toISOString() })
        toast(`Review request queued for ${name}`)
      }
    } else if (action === 'stop') {
      updateContact(c.id, { status: 'stopped', nextSendAt: null })
      toast(`Follow-ups stopped for ${name}`)
    } else if (action === 'dnc') {
      updateContact(c.id, { doNotContact: !c.doNotContact, status: c.doNotContact ? c.status : 'stopped', nextSendAt: null })
      toast(c.doNotContact ? `${name} removed from Do Not Contact` : `${name} added to Do Not Contact`)
    } else {
      deleteContact(c.id)
      toast(`${name} deleted`)
    }
  }

  const RowMenu = ({ c }: { c: Contact }) => (
    <Dropdown
      align="right"
      className="w-9"
      trigger={() => (
        <button className="rounded-md p-2 text-muted hover:bg-canvas hover:text-ink" aria-label="Contact actions">
          <Ellipsis className="size-4" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem onClick={() => { close(); act(c, 'send') }}><Send className="size-4 text-muted" /> Send request now</MenuItem>
          <MenuItem onClick={() => { close(); act(c, 'stop') }}><CircleStop className="size-4 text-muted" /> Stop follow-ups</MenuItem>
          <MenuItem onClick={() => { close(); act(c, 'dnc') }}><Ban className="size-4 text-muted" /> {c.doNotContact ? 'Allow contact' : 'Do not contact'}</MenuItem>
          <div className="my-1 h-px bg-line" />
          <MenuItem danger onClick={() => { close(); act(c, 'delete') }}><Trash2 className="size-4" /> Delete</MenuItem>
        </>
      )}
    </Dropdown>
  )

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Manage your contacts and review requests"
        actions={
          <Link to="/add-contacts">
            <Button icon={UserPlus}>Add Contacts</Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative w-full xl:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or phone..."
            className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-[15px] outline-none focus:border-brand-500 focus:ring-3 focus:ring-brand-100"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="relative inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white pl-3 pr-2 text-[15px] font-medium">
            <Filter className="size-4" />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="cursor-pointer bg-transparent pr-1 outline-none"
              aria-label="Status"
            >
              <option value="all">Status</option>
              {(Object.keys(statusMeta) as ContactStatus[]).map((s) => (
                <option key={s} value={s}>{statusMeta[s].label}</option>
              ))}
            </select>
          </label>
          <Checkbox checked={flags.clicked} onChange={(v) => setFlags((f) => ({ ...f, clicked: v }))} label="Clicked" />
          <Checkbox checked={flags.stopped} onChange={(v) => setFlags((f) => ({ ...f, stopped: v }))} label="Stopped" />
          <Checkbox checked={flags.dnc} onChange={(v) => setFlags((f) => ({ ...f, dnc: v }))} label="Do Not Contact" />
          <Checkbox checked={flags.reviewed} onChange={(v) => setFlags((f) => ({ ...f, reviewed: v }))} label="Left Review" />
        </div>
        <span className="text-sm text-muted xl:ml-auto">{filtered.length} contacts</span>
      </div>

      <Card className="overflow-visible">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No contacts found"
            body={state.contacts.length ? 'No contacts match your current filters. Try adjusting your search or filter criteria.' : 'Add your first customer to start sending review requests.'}
          />
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full text-left text-[15px] md:table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Contact</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Requests</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Last sent</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Added</th>
                  <th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                    <td className="px-5 py-3.5 font-medium">{c.firstName} {c.lastName}</td>
                    <td className="px-5 py-3.5 text-sm text-muted">
                      <div>{c.email || '—'}</div>
                      <div>{c.phone || '—'}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={statusMeta[c.status].tone}>{statusMeta[c.status].label}</Badge>
                        {c.doNotContact && <Badge tone="red">Do not contact</Badge>}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">{c.requestsSent}</td>
                    <td className="hidden px-5 py-3.5 text-sm text-muted lg:table-cell">{c.lastSentAt ? timeAgo(c.lastSentAt) : '—'}</td>
                    <td className="hidden px-5 py-3.5 text-sm text-muted lg:table-cell">{formatDate(c.addedAt)}</td>
                    <td className="px-3 py-3.5"><RowMenu c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <ul className="divide-y divide-line md:hidden">
              {filtered.map((c) => (
                <li key={c.id} className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.firstName} {c.lastName}</p>
                    <p className="truncate text-sm text-muted">{c.email || c.phone}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone={statusMeta[c.status].tone}>{statusMeta[c.status].label}</Badge>
                      {c.doNotContact && <Badge tone="red">Do not contact</Badge>}
                      <span className="text-xs text-muted">{c.requestsSent} sent</span>
                    </div>
                  </div>
                  <RowMenu c={c} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
