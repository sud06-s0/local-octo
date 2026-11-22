// src/store/AppStore.tsx
// App state for the active business. Live mode reads/writes Supabase (RLS keeps each business
// isolated); demo mode (no env vars) uses sample data saved in localStorage.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppNotification, AppState, Contact, CustomerFeedback, GbpLocation, GoogleConnection, NewContact, Review, ReviewReply, Settings, WaStandardTemplate, WaTemplate, WaTemplateKind } from '../types'
import { demoFeedback, initialState } from '../data/mockData'
import { storage, uid } from '../lib/utils'
import { toJpegBlob } from '../lib/image'
import { db, invokeFn, isLive } from '../lib/supabase'
import { draftReply as templateDraft } from '../lib/aiDraft'
import { useAuth } from './AuthProvider'
import { useToast } from '../components/ui/Toast'

const STORAGE_KEY = 'lo-app-state-v1'
const ACTIVE_KEY = 'lo-active-business'
const BUSINESS_COLS =
  'id, name, address, place_id, phone, website, google_rating, google_review_count, google_synced_at, review_link, maps_url, timezone, country_code, public_key, api_key_prefix, messaging, scheduling, ai, notification_prefs'

export interface BusinessSummary {
  id: string
  name: string
}
export interface AddResult {
  added: number
  updated: number
  cooldown: number
  invalid: number
}

interface AppStore {
  mode: 'live' | 'demo'
  loading: boolean
  state: AppState
  businesses: BusinessSummary[]
  activeBusinessId: string | null
  publicKey: string
  /** Answers from the review page, newest first (Bad / Worse carry what to improve) */
  feedback: CustomerFeedback[]
  /** WhatsApp custom templates of the active business (agency submits; clients see approved ones) */
  waTemplates: WaTemplate[]
  submitWhatsAppTemplates: (kinds: Array<'initial' | 'followup'>) => Promise<string[]>
  refreshWhatsAppTemplates: () => Promise<string[]>
  checkStandardTemplates: () => Promise<WaStandardTemplate[]>
  submitStandardTemplates: (kinds?: WaTemplateKind[]) => Promise<WaStandardTemplate[]>
  /** Delete standard templates from WhatsApp (agency), e.g. the optional marketing follow-up */
  deleteStandardTemplates: (kinds: WaTemplateKind[]) => Promise<WaStandardTemplate[]>
  /** Make a follow-up the default for all businesses (again on the default = turn off) */
  setDefaultTemplate: (templateId: string) => Promise<void>
  switchBusiness: (id: string) => void
  createBusiness: (input: { name: string; address?: string; reviewLink?: string; mapsUrl?: string }) => Promise<void>
  importFromGoogle: (placeId: string) => Promise<{ added: number; imported: number }>
  /** Google Business Profile (OAuth): null until checked */
  google: GoogleConnection | null
  refreshGoogle: () => Promise<GoogleConnection | null>
  connectGoogle: () => Promise<void>
  googleLocations: () => Promise<GbpLocation[]>
  selectGoogleLocation: (location: GbpLocation) => Promise<void>
  syncGoogleReviews: () => Promise<{ synced: number; added: number }>
  disconnectGoogle: () => Promise<void>
  /** Posts on Google when connected; otherwise saves the reply here. Returns where it went. */
  postReviewReply: (review: Review, text: string) => Promise<'google' | 'saved'>
  deleteReviewReply: (review: Review) => Promise<void>
  addContacts: (items: NewContact[], source?: 'manual' | 'csv') => Promise<AddResult>
  updateContact: (id: string, patch: Partial<Contact>) => void
  requestsThisMonth: number
  deleteWhatsAppTemplate: (templateId: string) => Promise<void>
  deleteContacts: (ids: string[]) => void
  /** Reload contacts from the database (used for auto-refresh on the Contacts page) */
  refreshContacts: () => Promise<void>
  /** Reload the list of businesses this login can open (e.g. after creating one for a client) */
  refreshBusinesses: () => Promise<BusinessSummary[]>
  deleteContact: (id: string) => void
  updateSettings: <K extends keyof Settings>(key: K, patch: Partial<Settings[K]>) => Promise<void>
  setReviewReply: (id: string, reply: ReviewReply | undefined) => void
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void
  sendTest: (to: string, channel?: 'whatsapp' | 'sms' | 'email') => Promise<string>
  draftReply: (review: Review) => Promise<string>
  uploadMessageImage: (file: File) => Promise<void>
  uploadBusinessAsset: (file: File, prefix: string) => Promise<string>
  refresh: () => Promise<void>
  resetDemo: () => void
}

const StoreContext = createContext<AppStore | null>(null)

/* ---------- row mappers (snake_case DB -> app types) ---------- */
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const toContact = (r: Row): Contact => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name ?? '',
  gender: r.gender ?? '',
  email: r.email ?? '',
  phone: r.phone ? `+${r.phone}` : '',
  status: r.status,
  doNotContact: r.do_not_contact,
  requestsSent: r.requests_sent,
  addedAt: r.created_at,
  lastSentAt: r.last_sent_at,
  nextSendAt: r.next_send_at,
})

const toReview = (r: Row): Review => ({
  id: r.id,
  author: r.author,
  avatarColor: r.avatar_color,
  rating: r.rating,
  text: r.text ?? '',
  createdAt: r.review_created_at,
  url: r.url || '#',
  reply: r.reply_text ? { text: r.reply_text, source: r.reply_source ?? 'app', at: r.reply_at ?? r.created_at } : undefined,
})

const toNotification = (r: Row): AppNotification => ({ id: r.id, type: r.type, title: r.title, body: r.body, at: r.created_at, read: r.read })

const toWaTemplate = (r: Row): WaTemplate => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  language: r.language ?? 'en',
  body: r.body,
  status: r.status,
  reason: r.reason ?? null,
  category: r.category ?? null,
  createdAt: r.created_at,
  businessId: r.business_id,
  businessName: (r.businesses as Row | null)?.name ?? undefined,
  isDefault: !!r.is_default,
})

const toFeedback = (r: Row): CustomerFeedback => {
  const c = r.contacts as Row | null
  return {
    id: r.id,
    rating: r.rating,
    text: r.text ?? '',
    photoUrl: r.photo_url ?? null,
    createdAt: r.created_at,
    name: c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() : r.customer_name ?? '',
    email: c?.email || r.customer_email || '',
    phone: c?.phone ? `+${c.phone}` : r.customer_phone || '',
    fromContact: !!c,
  }
}

function toSettings(b: Row): Settings {
  const d = initialState.settings
  return {
    business: {
      name: b.name,
      address: b.address ?? '',
      mapsUrl: b.maps_url ?? '',
      reviewLink: b.review_link ?? '',
      placeId: b.place_id ?? '',
      phone: b.phone ?? '',
      website: b.website ?? '',
      googleRating: b.google_rating != null ? Number(b.google_rating) : null,
      googleReviewCount: b.google_review_count ?? null,
      googleSyncedAt: b.google_synced_at ?? null,
    },
    messaging: { ...d.messaging, ...b.messaging },
    scheduling: { ...d.scheduling, ...b.scheduling },
    ai: { ...d.ai, ...b.ai },
    notifications: { ...d.notifications, ...b.notification_prefs },
  }
}

const SETTINGS_COLUMN: Record<Exclude<keyof Settings, 'business'>, string> = {
  messaging: 'messaging',
  scheduling: 'scheduling',
  ai: 'ai',
  notifications: 'notification_prefs',
}

const CONTACT_COLUMN: Partial<Record<keyof Contact, string>> = {
  firstName: 'first_name',
  lastName: 'last_name',
  gender: 'gender',
  email: 'email',
  status: 'status',
  doNotContact: 'do_not_contact',
  nextSendAt: 'next_send_at',
  sendKind: 'send_kind',
}

const emptyState: AppState = { contacts: [], reviews: [], notifications: [], settings: initialState.settings }

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const toast = useToast()
  const [state, setState] = useState<AppState>(() => {
    if (isLive) return emptyState
    // Demo data saved by an older version may miss newer settings: fill them from the defaults
    const saved = storage.get(STORAGE_KEY, initialState)
    const d = initialState.settings
    const s = saved.settings ?? d
    return {
      ...initialState,
      ...saved,
      settings: {
        business: { ...d.business, ...s.business },
        messaging: { ...d.messaging, ...s.messaging },
        scheduling: { ...d.scheduling, ...s.scheduling },
        ai: { ...d.ai, ...s.ai },
        notifications: { ...d.notifications, ...s.notifications },
      },
    }
  })
  const [businesses, setBusinesses] = useState<BusinessSummary[]>(isLive ? [] : [{ id: 'demo', name: initialState.settings.business.name }])
  const [activeId, setActiveId] = useState<string | null>(isLive ? storage.get<string | null>(ACTIVE_KEY, null) : 'demo')
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([])
  const [feedback, setFeedback] = useState<CustomerFeedback[]>(isLive ? [] : demoFeedback)
  /** Review requests sent this calendar month (first messages + follow-ups, not tests or failed) */
  const [requestsThisMonth, setRequestsThisMonth] = useState<number>(isLive ? 0 : 12)
  const [keys, setKeys] = useState({ publicKey: isLive ? '' : 'demo0public0key000000000' })
  const [loading, setLoading] = useState(isLive)
  const stateRef = useRef(state)
  stateRef.current = state
  const userId = session?.user.id

  /** Toasts Supabase errors so a failed write is never silent. */
  const check = useCallback(
    (error: { message: string } | null, what: string) => {
      if (error) toast(`${what}: ${error.message}`, 'error')
      return !error
    },
    [toast],
  )

  // Demo persistence
  useEffect(() => {
    if (!isLive) storage.set(STORAGE_KEY, state)
  }, [state])

  // Businesses the user can access
  const loadBusinesses = useCallback(async () => {
    const { data, error } = await db().from('businesses').select('id, name').order('name')
    if (!check(error, 'Could not load businesses')) return []
    const list = (data ?? []) as BusinessSummary[]
    setBusinesses(list)
    setActiveId((cur) => (cur && list.some((b) => b.id === cur) ? cur : (list[0]?.id ?? null)))
    if (!list.length) setLoading(false)
    return list
  }, [check])

  useEffect(() => {
    if (!isLive) return
    if (!userId) {
      setBusinesses([])
      setState(emptyState)
      setLoading(false)
      return
    }
    setLoading(true)
    loadBusinesses()
  }, [userId, loadBusinesses])

  // Everything for the active business
  const load = useCallback(
    async (bid: string) => {
      setLoading(true)
      const c = db()
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      const [b, contacts, reviews, notifications, templates, answers, monthSent] = await Promise.all([
        c.from('businesses').select(BUSINESS_COLS).eq('id', bid).single(),
        c.from('contacts').select('*').eq('business_id', bid).order('created_at', { ascending: false }).limit(2000),
        c.from('reviews').select('*').eq('business_id', bid).order('review_created_at', { ascending: false }).limit(500),
        c.from('notifications').select('*').eq('business_id', bid).order('created_at', { ascending: false }).limit(100),
        // agency: the whole shared library; client logins: their business only (database rule decides)
        c.from('whatsapp_templates').select('*, businesses(name)').order('created_at', { ascending: false }).limit(200),
        c.from('review_feedback').select('*, contacts(first_name, last_name, email, phone)').eq('business_id', bid).order('created_at', { ascending: false }).limit(300),
        c.from('messages').select('id', { count: 'exact', head: true }).eq('business_id', bid).in('kind', ['initial', 'follow_up']).neq('status', 'failed').gte('created_at', monthStart),
      ])
      setRequestsThisMonth(monthSent.error ? 0 : (monthSent.count ?? 0))
      setFeedback(answers.error ? [] : (answers.data ?? []).map(toFeedback))
      // Don't fail the whole load if the WhatsApp templates table isn't there yet
      setWaTemplates(templates.error ? [] : (templates.data ?? []).map(toWaTemplate))
      const err = b.error || contacts.error || reviews.error || notifications.error
      if (check(err, 'Could not load data') && b.data) {
        setState({
          contacts: (contacts.data ?? []).map(toContact),
          reviews: (reviews.data ?? []).map(toReview),
          notifications: (notifications.data ?? []).map(toNotification),
          settings: toSettings(b.data),
        })
        setKeys({ publicKey: b.data.public_key })
      }
      setLoading(false)
    },
    [check],
  )

  useEffect(() => {
    if (!isLive || !activeId || !userId) return
    storage.set(ACTIVE_KEY, activeId)
    load(activeId)
  }, [activeId, userId, load])

  /* ---------- actions ---------- */
  const switchBusiness = useCallback((id: string) => setActiveId(id), [])

  const createBusiness = useCallback(
    async ({ name, address = '', reviewLink = '', mapsUrl = '' }: { name: string; address?: string; reviewLink?: string; mapsUrl?: string }) => {
      if (!isLive) return toast('Locations are available once Supabase is connected')
      const { data: id, error } = await db().rpc('create_business', { p_name: name, p_address: address })
      if (!check(error, 'Could not create business')) throw new Error(error?.message)
      if (reviewLink || mapsUrl) await db().from('businesses').update({ review_link: reviewLink, maps_url: mapsUrl }).eq('id', id)
      await loadBusinesses()
      setActiveId(id as string)
    },
    [check, loadBusinesses, toast],
  )

  const importFromGoogle = useCallback(
    async (placeId: string) => {
      if (!isLive || !activeId) {
        toast('Google import works once Supabase and the Places API key are connected')
        return { added: 0, imported: 0 }
      }
      const res = await invokeFn<{ added: number; imported: number }>('google-places', { action: 'import', businessId: activeId, placeId })
      await load(activeId)
      return res
    },
    [activeId, load, toast],
  )

  const addContacts = useCallback(
    async (items: NewContact[], source: 'manual' | 'csv' = 'manual'): Promise<AddResult> => {
      if (!isLive) {
        const now = new Date().toISOString()
        const created: Contact[] = items.map((c) => ({
          ...c,
          id: uid('c'),
          status: c.doNotContact ? 'stopped' : 'pending',
          requestsSent: 0,
          addedAt: now,
          lastSentAt: null,
        }))
        setState((s) => ({ ...s, contacts: [...created, ...s.contacts] }))
        return { added: created.length, updated: 0, cooldown: 0, invalid: 0 }
      }
      const { data, error } = await db().rpc('add_contacts', { p_business: activeId, p_contacts: items, p_source: source, p_consent: true })
      if (!check(error, 'Could not add contacts')) throw new Error(error?.message)
      if (activeId) await load(activeId)
      return data as AddResult
    },
    [activeId, check, load],
  )

  const updateContact = useCallback(
    (id: string, patch: Partial<Contact>) => {
      setState((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
      if (!isLive) return
      const row: Row = {}
      for (const [k, v] of Object.entries(patch)) {
        const col = CONTACT_COLUMN[k as keyof Contact]
        if (col) row[col] = v
      }
      if (patch.status === 'stopped') row.stopped_at = new Date().toISOString()
      if (Object.keys(row).length) db().from('contacts').update(row).eq('id', id).then(({ error }) => check(error, 'Could not update contact'))
    },
    [check],
  )

  const deleteContact = useCallback(
    (id: string) => {
      setState((s) => ({ ...s, contacts: s.contacts.filter((c) => c.id !== id) }))
      if (isLive) db().from('contacts').delete().eq('id', id).then(({ error }) => check(error, 'Could not delete contact'))
    },
    [check],
  )

  /** Delete several contacts at once (message history and feedback stay, just no longer linked to a contact). */
  const deleteContacts = useCallback(
    (ids: string[]) => {
      if (!ids.length) return
      const drop = new Set(ids)
      setState((s) => ({ ...s, contacts: s.contacts.filter((c) => !drop.has(c.id)) }))
      if (isLive) db().from('contacts').delete().in('id', ids).then(({ error }) => check(error, 'Could not delete contacts'))
    },
    [check],
  )

  const updateSettings = useCallback(
    async <K extends keyof Settings>(key: K, patch: Partial<Settings[K]>) => {
      const prev = stateRef.current.settings[key]
      const next = { ...stateRef.current.settings[key], ...patch } as Settings[K]
      setState((s) => ({ ...s, settings: { ...s.settings, [key]: next } }))
      if (!isLive || !activeId) return
      let row: Row
      if (key === 'business') {
        const b = next as Settings['business']
        row = { name: b.name, address: b.address, maps_url: b.mapsUrl, review_link: b.reviewLink, phone: b.phone, website: b.website }
        setBusinesses((list) => list.map((x) => (x.id === activeId ? { ...x, name: b.name } : x)))
      } else {
        row = { [SETTINGS_COLUMN[key as Exclude<keyof Settings, 'business'>]]: next }
      }
      const { data, error } = await db().from('businesses').update(row).eq('id', activeId).select('id')
      if (!check(error, 'Could not save settings')) return
      // No row came back = the database refused the change (this login may not edit this business): undo it on screen
      if (!data?.length) {
        setState((st) => ({ ...st, settings: { ...st.settings, [key]: prev } }))
        toast("Not saved — this login can't change this business's settings. Ask the agency to change it.", 'error')
      }
    },
    [activeId, check, toast],
  )

  const setReviewReply = useCallback(
    (id: string, reply: ReviewReply | undefined) => {
      setState((s) => ({ ...s, reviews: s.reviews.map((r) => (r.id === id ? { ...r, reply } : r)) }))
      if (!isLive) return
      db()
        .from('reviews')
        .update({ reply_text: reply?.text ?? null, reply_source: reply?.source ?? null, reply_at: reply?.at ?? null })
        .eq('id', id)
        .then(({ error }) => check(error, 'Could not save reply'))
    },
    [check],
  )

  const markNotificationRead = useCallback(
    (id: string) => {
      setState((s) => ({ ...s, notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }))
      if (isLive) db().from('notifications').update({ read: true }).eq('id', id).then(({ error }) => check(error, 'Could not update'))
    },
    [check],
  )

  const markAllNotificationsRead = useCallback(() => {
    setState((s) => ({ ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) }))
    if (isLive && activeId)
      db().from('notifications').update({ read: true }).eq('business_id', activeId).eq('read', false).then(({ error }) => check(error, 'Could not update'))
  }, [activeId, check])

  const sendTest = useCallback(
    async (to: string, channel?: 'whatsapp' | 'sms' | 'email') => {
      if (!isLive) return 'demo'
      const res = await invokeFn<{ ok: boolean; channel?: string; warning?: string }>('send-test', { businessId: activeId, to, channel })
      // e.g. "whatsapp + email", plus why another channel didn't go (SMS outside 10 AM–9 PM…)
      return `${res.channel ?? 'sent'}${res.warning ? ` (${res.warning})` : ''}`
    },
    [activeId],
  )

  const draftReply = useCallback(async (review: Review) => {
    const s = stateRef.current.settings
    if (!isLive) return templateDraft(review, s.ai.nickname || s.business.name)
    const res = await invokeFn<{ text: string }>('ai-reply', { reviewId: review.id })
    return res.text
  }, [])

  const uploadMessageImage = useCallback(
    async (file: File) => {
      if (!isLive || !activeId) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        updateSettings('messaging', { imageDataUrl: dataUrl, personalizedImage: true })
        return
      }
      // Always a normal JPEG (max 1600 px): the review-image function only reads JPG/PNG and has a short time limit
      let jpeg: Blob
      try {
        jpeg = await toJpegBlob(file)
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Couldn't read this photo"
        toast(msg, 'error')
        throw e
      }
      const path = `${activeId}/message-${Date.now()}.jpg`
      const { error } = await db().storage.from('business-assets').upload(path, jpeg, { contentType: 'image/jpeg' })
      if (!check(error, 'Upload failed')) throw new Error(error?.message)
      const { data } = db().storage.from('business-assets').getPublicUrl(path)
      updateSettings('messaging', { imageDataUrl: data.publicUrl, personalizedImage: true })
    },
    [activeId, check, toast, updateSettings],
  )

  /** Re-reads contacts + this month's count (sending happens on the server, so the list would otherwise go stale). */
  const refreshContacts = useCallback(async () => {
    if (!isLive || !activeId) return
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    const [contacts, monthSent] = await Promise.all([
      db().from('contacts').select('*').eq('business_id', activeId).order('created_at', { ascending: false }).limit(2000),
      db().from('messages').select('id', { count: 'exact', head: true }).eq('business_id', activeId).in('kind', ['initial', 'follow_up']).neq('status', 'failed').gte('created_at', monthStart),
    ])
    if (!contacts.error) setState((st) => ({ ...st, contacts: (contacts.data ?? []).map(toContact) }))
    if (!monthSent.error) setRequestsThisMonth(monthSent.count ?? 0)
  }, [activeId])

  /** Uploads a file to the business's storage folder and returns its public URL (demo: data URL). */
  const uploadBusinessAsset = useCallback(
    async (file: File, prefix: string) => {
      if (!isLive || !activeId) {
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
      }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${activeId}/${prefix}-${Date.now()}.${ext}`
      const { error } = await db().storage.from('business-assets').upload(path, file, { contentType: file.type })
      if (!check(error, 'Upload failed')) throw new Error(error?.message)
      return db().storage.from('business-assets').getPublicUrl(path).data.publicUrl
    },
    [activeId, check],
  )

  const submitWhatsAppTemplates = useCallback(
    async (kinds: Array<'initial' | 'followup'>) => {
      if (!isLive) {
        // Demo: pretend they were submitted and are waiting for Meta
        const m = stateRef.current.settings.messaging
        const now = new Date().toISOString()
        const make = (kind: WaTemplateKind, body: string, status: WaTemplate['status'] = 'pending'): WaTemplate => {
          const base = (kind.startsWith('initial') ? m.waTemplateName : m.waFollowUpTemplateName)?.replace(/^_+|_+$/g, '')
          return {
          id: uid('t'),
          kind,
          name: base ? `${base}${kind.endsWith('_image') ? '_photo' : ''}` : `lo_demo_${kind}_${Date.now().toString(36)}`,
          language: 'en',
          body,
          status,
          reason: null,
          category: (kind.startsWith('initial') ? m.waCategory : m.waFollowUpCategory) ?? 'marketing',
          createdAt: now,
          businessId: activeId ?? undefined,
          }
        }
        const rows: WaTemplate[] = []
        if (kinds.includes('initial')) rows.push(make('initial', m.waMessage), make('initial_image', m.waMessage))
        if (kinds.includes('followup')) rows.push(make('followup', m.waFollowUp)) // follow-ups are text only
        setWaTemplates((t) => [...rows, ...t])
        return []
      }
      const res = await invokeFn<{ templates: Row[]; warnings: string[] }>('wa-template', { businessId: activeId, action: 'submit', kinds })
      setWaTemplates(res.templates.map(toWaTemplate))
      return res.warnings ?? []
    },
    [activeId],
  )

  const refreshWhatsAppTemplates = useCallback(async () => {
    if (!isLive) {
      setWaTemplates((t) => t.map((x) => (x.status === 'pending' ? { ...x, status: 'approved' } : x)))
      return []
    }
    const res = await invokeFn<{ templates: Row[]; warnings: string[] }>('wa-template', { businessId: activeId, action: 'refresh' })
    setWaTemplates(res.templates.map(toWaTemplate))
    return res.warnings ?? []
  }, [activeId])

  /** Delete one custom template: from WhatsApp, then from this business. */
  const deleteWhatsAppTemplate = useCallback(async (templateId: string) => {
    if (!isLive) {
      setWaTemplates((t) => t.filter((x) => x.id !== templateId))
      return
    }
    const res = await invokeFn<{ templates: Row[] }>('wa-template', { businessId: activeId, action: 'delete', templateId })
    setWaTemplates(res.templates.map(toWaTemplate))
  }, [activeId])

  const checkStandardTemplates = useCallback(async (): Promise<WaStandardTemplate[]> => {
    if (!isLive) {
      return [
        { kind: 'initial', name: 'review_request', status: 'approved', reason: null, category: 'marketing' },
        { kind: 'initial_image', name: 'review_request_image', status: 'approved', reason: null, category: 'marketing' },
        { kind: 'followup', name: 'review_followup', status: 'pending', reason: null, category: 'marketing' },
      ]
    }
    const res = await invokeFn<{ standard: WaStandardTemplate[] }>('wa-template', { businessId: activeId, action: 'standard' })
    return res.standard
  }, [activeId])

  const submitStandardTemplates = useCallback(async (kinds?: WaTemplateKind[]): Promise<WaStandardTemplate[]> => {
    if (!isLive) {
      const list = await checkStandardTemplates()
      const want = (k: WaTemplateKind) => (kinds?.length ? kinds.includes(k) : k !== 'followup')
      return list.map((t) => ((t.status === 'not_created' || t.status === 'failed') && want(t.kind) ? { ...t, status: 'pending', reason: null, category: 'marketing' } : t))
    }
    const res = await invokeFn<{ standard: WaStandardTemplate[] }>('wa-template', { businessId: activeId, action: 'submit_standard', standardKinds: kinds })
    return res.standard
  }, [activeId, checkStandardTemplates])

  const deleteStandardTemplates = useCallback(async (kinds: WaTemplateKind[]): Promise<WaStandardTemplate[]> => {
    if (!isLive) {
      const list = await checkStandardTemplates()
      return list.map((t) => (kinds.includes(t.kind) ? { ...t, status: 'not_created', reason: null, category: null } : t))
    }
    const res = await invokeFn<{ standard: WaStandardTemplate[] }>('wa-template', { businessId: activeId, action: 'delete_standard', standardKinds: kinds })
    return res.standard
  }, [activeId, checkStandardTemplates])

  const setDefaultTemplate = useCallback(async (templateId: string) => {
    if (!isLive) {
      setWaTemplates((list) => {
        const t = list.find((x) => x.id === templateId)
        return list.map((x) => (x.kind === t?.kind ? { ...x, isDefault: x.id === templateId ? !x.isDefault : false } : x))
      })
      return
    }
    const res = await invokeFn<{ templates: Row[] }>('wa-template', { businessId: activeId, action: 'set_default', templateId })
    setWaTemplates(res.templates.map(toWaTemplate))
  }, [activeId])

  /* ---------- Google Business Profile (OAuth) ---------- */
  const [google, setGoogle] = useState<GoogleConnection | null>(null)
  const demoGoogle = useRef<GoogleConnection>({ connected: false, email: '', locationTitle: '', needsLocation: false, lastSyncAt: null })

  const refreshGoogle = useCallback(async () => {
    if (!isLive) {
      setGoogle({ ...demoGoogle.current })
      return { ...demoGoogle.current }
    }
    if (!activeId) return null
    try {
      const res = await invokeFn<GoogleConnection>('google-business', { businessId: activeId, action: 'status' })
      setGoogle(res)
      return res
    } catch {
      setGoogle(null) // function not deployed yet: treat as not connected
      return null
    }
  }, [activeId])

  useEffect(() => {
    setGoogle(null)
    void refreshGoogle()
  }, [refreshGoogle])

  const connectGoogle = useCallback(async () => {
    if (!isLive) {
      demoGoogle.current = { connected: true, email: 'owner@gmail.com', locationTitle: state.settings.business.name, needsLocation: false, lastSyncAt: null }
      setGoogle({ ...demoGoogle.current })
      return
    }
    const returnUrl = window.location.href.split('?')[0].split('#')[0] + window.location.hash.split('?')[0]
    const { url } = await invokeFn<{ url: string }>('google-business', { businessId: activeId, action: 'auth_url', returnUrl })
    window.location.assign(url)
  }, [activeId, state.settings.business.name])

  const googleLocations = useCallback(async () => {
    if (!isLive) return []
    const res = await invokeFn<{ locations: GbpLocation[] }>('google-business', { businessId: activeId, action: 'locations' })
    return res.locations
  }, [activeId])

  const selectGoogleLocation = useCallback(
    async (location: GbpLocation) => {
      if (!isLive) return
      await invokeFn('google-business', { businessId: activeId, action: 'select_location', location })
      await refreshGoogle()
      if (activeId) await load(activeId)
    },
    [activeId, load, refreshGoogle],
  )

  const syncGoogleReviews = useCallback(async () => {
    if (!isLive) {
      demoGoogle.current = { ...demoGoogle.current, lastSyncAt: new Date().toISOString() }
      setGoogle({ ...demoGoogle.current })
      return { synced: state.reviews.length, added: 0 }
    }
    try {
      const res = await invokeFn<{ synced: number; added: number }>('google-business', { businessId: activeId, action: 'sync' })
      if (activeId) await load(activeId)
      return res
    } finally {
      await refreshGoogle()
    }
  }, [activeId, load, refreshGoogle, state.reviews.length])

  const disconnectGoogle = useCallback(async () => {
    if (!isLive) {
      demoGoogle.current = { connected: false, email: '', locationTitle: '', needsLocation: false, lastSyncAt: null }
      setGoogle({ ...demoGoogle.current })
      return
    }
    await invokeFn('google-business', { businessId: activeId, action: 'disconnect' })
    await refreshGoogle()
  }, [activeId, refreshGoogle])

  const postReviewReply = useCallback(
    async (review: Review, text: string): Promise<'google' | 'saved'> => {
      const at = new Date().toISOString()
      if (isLive && google?.connected && !google.needsLocation) {
        await invokeFn('google-business', { businessId: activeId, action: 'reply', reviewId: review.id, comment: text })
        setState((s) => ({ ...s, reviews: s.reviews.map((r) => (r.id === review.id ? { ...r, reply: { text, source: 'app', at } } : r)) }))
        return 'google'
      }
      setReviewReply(review.id, { text, source: 'app', at })
      return isLive ? 'saved' : 'google'
    },
    [activeId, google, setReviewReply],
  )

  const deleteReviewReply = useCallback(
    async (review: Review) => {
      if (isLive && google?.connected && !google.needsLocation && review.reply?.source !== 'draft') {
        await invokeFn('google-business', { businessId: activeId, action: 'delete_reply', reviewId: review.id })
        setState((s) => ({ ...s, reviews: s.reviews.map((r) => (r.id === review.id ? { ...r, reply: undefined } : r)) }))
        return
      }
      setReviewReply(review.id, undefined)
    },
    [activeId, google, setReviewReply],
  )

  const refresh = useCallback(async () => {
    if (isLive && activeId) await load(activeId)
  }, [activeId, load])

  const resetDemo = useCallback(() => {
    if (isLive) return
    storage.remove(STORAGE_KEY)
    setState(initialState)
  }, [])

  const value = useMemo<AppStore>(
    () => ({
      mode: isLive ? 'live' : 'demo',
      loading,
      state,
      businesses,
      activeBusinessId: activeId,
      publicKey: keys.publicKey,
      feedback,
      waTemplates,
      submitWhatsAppTemplates,
      refreshWhatsAppTemplates,
      checkStandardTemplates,
      submitStandardTemplates,
      deleteStandardTemplates,
      setDefaultTemplate,
      switchBusiness,
      createBusiness,
      importFromGoogle,
      google,
      refreshGoogle,
      connectGoogle,
      googleLocations,
      selectGoogleLocation,
      syncGoogleReviews,
      disconnectGoogle,
      postReviewReply,
      deleteReviewReply,
      addContacts,
      updateContact,
      requestsThisMonth,
      deleteWhatsAppTemplate,
      deleteContacts,
      refreshContacts,
      refreshBusinesses: loadBusinesses,
      deleteContact,
      updateSettings,
      setReviewReply,
      markNotificationRead,
      markAllNotificationsRead,
      sendTest,
      draftReply,
      uploadMessageImage,
      uploadBusinessAsset,
      refresh,
      resetDemo,
    }),
    [loading, state, businesses, activeId, keys, feedback, waTemplates, submitWhatsAppTemplates, refreshWhatsAppTemplates, checkStandardTemplates, submitStandardTemplates, deleteStandardTemplates, setDefaultTemplate, switchBusiness, createBusiness, importFromGoogle, google, refreshGoogle, connectGoogle, googleLocations, selectGoogleLocation, syncGoogleReviews, disconnectGoogle, postReviewReply, deleteReviewReply, addContacts, updateContact, requestsThisMonth, deleteWhatsAppTemplate, deleteContacts, refreshContacts, loadBusinesses, deleteContact, updateSettings, setReviewReply, markNotificationRead, markAllNotificationsRead, sendTest, draftReply, uploadMessageImage, uploadBusinessAsset, refresh, resetDemo],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): AppStore {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside AppStoreProvider')
  return ctx
}
