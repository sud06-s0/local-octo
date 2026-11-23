// src/pages/Contacts.tsx
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Ban, CalendarClock, CircleStop, Ellipsis, Filter, Reply, Search, Send, Trash2, UserPlus, Users } from 'lucide-react'
import { Badge, Button, Card, Checkbox, EmptyState, PageHeader, Segmented } from '../components/ui/primitives'
import { AddContactsPanel } from './AddContacts'
import { RequestSchedulingPanel } from './RequestScheduling'
import { Dropdown, MenuItem } from '../components/layout/Dropdown'
import { useStore } from '../store/AppStore'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { cn, formatDate, timeAgo } from '../lib/utils'
import { brand } from '../config/brand'
import type { Contact, ContactStatus, Gender } from '../types'

const statusMeta: Record<ContactStatus, { label: string; tone: 'green' | 'gray' | 'amber' | 'red' | 'blue' }> = {
  pending: { label: 'Pending', tone: 'gray' },
  sent: { label: 'Request sent', tone: 'blue' },
  clicked: { label: 'Clicked', tone: 'amber' },
  reviewed: { label: 'Left review', tone: 'green' },
  stopped: { label: 'Stopped', tone: 'red' },
}

type StatusFilter = 'all' | ContactStatus

export default function Contacts() {
  const [params, setParams] = useSearchParams()
  type Tab = 'list' | 'add' | 'schedule'
  const tabParam = params.get('tab')
  const tab: Tab = tabParam === 'add' || tabParam === 'schedule' ? tabParam : 'list'
  const setTab = (t: Tab) => setParams(t === 'list' ? {} : { tab: t }, { replace: true })
  const { state, mode, updateContact, deleteContacts, requestsThisMonth, refreshContacts } = useStore()
  /** Contacts waiting for the delete confirmation dialog (one from the ⋯ menu, or the selected ones) */
  const [toDelete, setToDelete] = useState<Contact[] | null>(null)

  // Messages go out in the background, so keep the list fresh: every 20 s while open, and when you come back to the tab
  useEffect(() => {
    if (mode !== 'live') return
    const tick = () => { if (document.visibilityState === 'visible') void refreshContacts() }
    const timer = window.setInterval(tick, 20_000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [mode, refreshContacts])
  const anytime = !!state.settings.scheduling.sendAnytime
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

  // Multi-select (only contacts visible with the current filters count)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const picked = filtered.filter((c) => selected.has(c.id))
  const allPicked = filtered.length > 0 && picked.length === filtered.length
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const toggleAll = () => setSelected(allPicked ? new Set() : new Set(filtered.map((c) => c.id)))

  const confirmDelete = () => {
    if (!toDelete?.length) return
    const ids = toDelete.map((c) => c.id)
    deleteContacts(ids)
    setSelected((s) => {
      const n = new Set(s)
      ids.forEach((id) => n.delete(id))
      return n
    })
    toast(toDelete.length === 1 ? `${`${toDelete[0].firstName} ${toDelete[0].lastName}`.trim()} deleted` : `${toDelete.length} contacts deleted`)
    setToDelete(null)
  }

  // Monthly allowance: 100 per channel. Room left = the most open channel that's turned on (WhatsApp only until saved).
  const onChannels = state.settings.messaging.channels ?? { whatsapp: true, sms: false, email: false }
  const monthLeft = Math.max(
    0,
    ...(['whatsapp', 'sms', 'email'] as const).filter((ch) => onChannels[ch]).map((ch) => brand.monthlyRequestLimit - requestsThisMonth[ch]),
  )
  const limitMsg = `This month's ${brand.monthlyRequestLimit} review requests are used on every channel that's on. More can go out from the 1st.`

  /** Queue the chosen message for several contacts (skips Do Not Contact, stays within the monthly limit). */
  const sendMany = (list: Contact[], kind: 'initial' | 'follow_up') => {
    const what = kind === 'initial' ? 'first message' : 'follow-up'
    const ok = list.filter((c) => !c.doNotContact)
    const skippedDnc = list.length - ok.length
    const left = monthLeft
    if (!left) return toast(limitMsg, 'error')
    const go = ok.slice(0, left)
    if (!go.length) return toast('All selected contacts are on the Do Not Contact list', 'error')
    const now = new Date().toISOString()
    for (const c of go) {
      if (mode === 'live') updateContact(c.id, { sendKind: kind, nextSendAt: now, status: c.status === 'stopped' ? 'pending' : c.status })
      else updateContact(c.id, { status: 'sent', requestsSent: c.requestsSent + 1, lastSentAt: now })
    }
    const notes = [
      skippedDnc ? `${skippedDnc} on Do Not Contact skipped` : '',
      ok.length > go.length ? `${ok.length - go.length} not sent (only ${left} left this month)` : '',
    ].filter(Boolean)
    toast(`Queued — ${what} for ${go.length} contact${go.length > 1 ? 's' : ''}${mode === 'live' && !anytime ? ' (9 AM–7 PM)' : ''}${notes.length ? ` · ${notes.join(' · ')}` : ''}`)
    setSelected(new Set())
  }

  const act = (c: Contact, action: 'send_initial' | 'send_follow_up' | 'stop' | 'dnc' | 'delete') => {
    const name = `${c.firstName} ${c.lastName}`.trim()
    if (action === 'send_initial' || action === 'send_follow_up') {
      const what = action === 'send_initial' ? 'first message' : 'follow-up'
      if (c.doNotContact) return toast(`${name} is on the Do Not Contact list`, 'error')
      if (!monthLeft) return toast(limitMsg, 'error')
      if (mode === 'live') {
        // The cron dispatcher sends exactly this message within a minute (inside 9 AM–7 PM unless Sending hours = Anytime),
        // even past the follow-up limit; automatic scheduling keeps its own rules
        updateContact(c.id, {
          sendKind: action === 'send_initial' ? 'initial' : 'follow_up',
          nextSendAt: new Date().toISOString(),
          status: c.status === 'stopped' ? 'pending' : c.status,
        })
        toast(anytime ? `Queued — ${name} gets the ${what} within a minute` : `Queued — ${name} gets the ${what} within a minute (9 AM–7 PM)`)
      } else {
        updateContact(c.id, { status: 'sent', requestsSent: c.requestsSent + 1, lastSentAt: new Date().toISOString() })
        toast(`${what === 'first message' ? 'First message' : 'Follow-up'} queued for ${name}`)
      }
    } else if (action === 'stop') {
      updateContact(c.id, { status: 'stopped', nextSendAt: null })
      toast(`Follow-ups stopped for ${name}`)
    } else if (action === 'dnc') {
      updateContact(c.id, { doNotContact: !c.doNotContact, status: c.doNotContact ? c.status : 'stopped', nextSendAt: null })
      toast(c.doNotContact ? `${name} removed from Do Not Contact` : `${name} added to Do Not Contact`)
    } else {
      setToDelete([c]) // asks first; deleted in confirmDelete()
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
          <MenuItem onClick={() => { close(); act(c, 'send_initial') }}><Send className="size-4 text-muted" /> Send first message</MenuItem>
          <MenuItem onClick={() => { close(); act(c, 'send_follow_up') }}><Reply className="size-4 text-muted" /> Send follow-up</MenuItem>
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
        actions={tab === 'list' ? <Button icon={UserPlus} onClick={() => setTab('add')}>Add Contacts</Button> : undefined}
      />

      <Segmented
        className="mb-6"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'list', label: 'All Contacts', icon: Users },
          { value: 'add', label: 'Add Contacts', icon: UserPlus },
          { value: 'schedule', label: 'Schedule Requests', icon: CalendarClock },
        ]}
      />

      {tab === 'add' ? <AddContactsPanel /> : tab === 'schedule' ? <RequestSchedulingPanel /> : renderList()}
    </div>
  )

  function renderList() {
    return (
      <>

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

      {picked.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5">
          <span className="text-[15px] font-medium">{picked.length} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" icon={Send} onClick={() => sendMany(picked, 'initial')}>Send first message</Button>
            <Button size="sm" variant="outline" icon={Reply} onClick={() => sendMany(picked, 'follow_up')}>Send follow-up</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => setToDelete(picked)}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

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
                  <th className="w-10 py-3 pl-5 pr-1">
                    <input type="checkbox" className="size-4 cursor-pointer accent-brand-700 align-middle" checked={allPicked} ref={(el) => { if (el) el.indeterminate = picked.length > 0 && !allPicked }} onChange={toggleAll} aria-label="Select all contacts" />
                  </th>
                  <th className="w-14 px-2 py-3 font-medium">S.No.</th>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Contact</th>
                  <th className="px-5 py-3 font-medium">Gender</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Requests</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Last sent</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Added</th>
                  <th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={c.id} className={cn('border-b border-line last:border-0 hover:bg-canvas/60', selected.has(c.id) && 'bg-brand-50/60')}>
                    <td className="py-3.5 pl-5 pr-1">
                      <input type="checkbox" className="size-4 cursor-pointer accent-brand-700 align-middle" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.firstName}`} />
                    </td>
                    <td className="px-2 py-3.5 text-sm text-muted">{i + 1}</td>
                    <td className="px-5 py-3.5 font-medium">{c.firstName} {c.lastName}</td>
                    <td className="px-5 py-3.5 text-sm text-muted">
                      <div>{c.email || '—'}</div>
                      <div>{c.phone || '—'}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <select
                        aria-label={`Gender of ${c.firstName}`}
                        value={c.gender ?? ''}
                        onChange={(e) => updateContact(c.id, { gender: e.target.value as Gender })}
                        className={cn('cursor-pointer rounded-md border border-line bg-white px-2 py-1 text-sm outline-none focus:border-brand-500', !c.gender && 'text-muted')}
                      >
                        <option value="">Not set</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
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
              {filtered.map((c, i) => (
                <li key={c.id} className={cn('flex items-start gap-3 p-4', selected.has(c.id) && 'bg-brand-50/60')}>
                  <input type="checkbox" className="mt-1 size-4 cursor-pointer accent-brand-700" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.firstName}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium"><span className="mr-1.5 text-sm text-muted">{i + 1}.</span>{c.firstName} {c.lastName}</p>
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

      {/* Delete confirmation */}
      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={toDelete && toDelete.length > 1 ? `Delete ${toDelete.length} contacts?` : 'Delete contact?'}
      >
        {toDelete && (
          <>
            <p className="text-[15px]">
              {toDelete.length === 1 ? (
                <>
                  <b>{`${toDelete[0].firstName} ${toDelete[0].lastName}`.trim()}</b> will be removed from your contacts.
                </>
              ) : (
                <>These {toDelete.length} contacts will be removed:</>
              )}
            </p>
            {toDelete.length > 1 && (
              <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-sm text-muted">
                {toDelete.slice(0, 50).map((c) => (
                  <li key={c.id}>{`${c.firstName} ${c.lastName}`.trim()}{c.phone ? ` · ${c.phone}` : c.email ? ` · ${c.email}` : ''}</li>
                ))}
                {toDelete.length > 50 && <li>…and {toDelete.length - 50} more</li>}
              </ul>
            )}
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              This can't be undone. No more review requests or follow-ups will go to {toDelete.length === 1 ? 'them' : 'these contacts'}.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setToDelete(null)}>Cancel</Button>
              <Button className="bg-red-600 text-white hover:bg-red-700" icon={Trash2} onClick={confirmDelete}>
                Delete{toDelete.length > 1 ? ` ${toDelete.length} contacts` : ''}
              </Button>
            </div>
          </>
        )}
      </Modal>
      </>
    )
  }
}
