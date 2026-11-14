// src/store/AppStore.tsx
// App state for the active business. Live mode reads/writes Supabase (RLS keeps each business
// isolated); demo mode (no env vars) uses sample data saved in localStorage.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppNotification, AppState, Contact, GooglePlaceResult, NewContact, Review, ReviewReply, Settings, SocialPost, WaStandardTemplate, WaTemplate, WaTemplateKind } from '../types'
import { initialState } from '../data/mockData'
import { storage, uid } from '../lib/utils'
import { db, invokeFn, isLive } from '../lib/supabase'
import { draftReply as templateDraft } from '../lib/aiDraft'
import { useAuth } from './AuthProvider'
import { useToast } from '../components/ui/Toast'

const STORAGE_KEY = 'lo-app-state-v1'
const ACTIVE_KEY = 'lo-active-business'
const BUSINESS_COLS =
  'id, name, address, place_id, phone, website, google_rating, google_review_count, google_synced_at, review_link, maps_url, timezone, country_code, public_key, api_key_prefix, messaging, scheduling, ai, widgets, social, notification_prefs, integrations'

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
  apiKeyPrefix: string
  waTemplates: WaTemplate[]
  submitWhatsAppTemplates: (kinds: Array<'initial' | 'followup'>) => Promise<string[]>
  refreshWhatsAppTemplates: () => Promise<string[]>
  checkStandardTemplates: () => Promise<WaStandardTemplate[]>
  submitStandardTemplates: () => Promise<WaStandardTemplate[]>
  switchBusiness: (id: string) => void
  createBusiness: (input: { name: string; address?: string; reviewLink?: string; mapsUrl?: string; placeId?: string }) => Promise<void>
  searchGoogle: (query: string) => Promise<GooglePlaceResult[]>
  importFromGoogle: (placeId: string) => Promise<{ added: number; imported: number }>
  addContacts: (items: NewContact[], source?: 'manual' | 'csv') => Promise<AddResult>
  updateContact: (id: string, patch: Partial<Contact>) => void
  deleteContact: (id: string) => void
  updateSettings: <K extends keyof Settings>(key: K, patch: Partial<Settings[K]>) => Promise<void>
  setReviewReply: (id: string, reply: ReviewReply | undefined) => void
  addSocialPost: (post: Omit<SocialPost, 'id'>) => void
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void
  sendTest: (to: string) => Promise<string>
  draftReply: (review: Review) => Promise<string>
  uploadMessageImage: (file: File) => Promise<void>
  uploadBusinessAsset: (file: File, prefix: string) => Promise<string>
  regenerateApiKey: () => Promise<string>
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
})

const toPost = (r: Row): SocialPost => ({ id: r.id, reviewId: r.review_id, network: r.network, format: r.format, status: r.status, at: r.scheduled_at })

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
    widgets: { ...d.widgets, ...b.widgets },
    social: { ...d.social, ...b.social },
    notifications: { ...d.notifications, ...b.notification_prefs },
    integrations: { ...d.integrations, ...b.integrations },
  }
}

const SETTINGS_COLUMN: Record<Exclude<keyof Settings, 'business'>, string> = {
  messaging: 'messaging',
  scheduling: 'scheduling',
  ai: 'ai',
  widgets: 'widgets',
  social: 'social',
  notifications: 'notification_prefs',
  integrations: 'integrations',
}

const CONTACT_COLUMN: Partial<Record<keyof Contact, string>> = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  status: 'status',
  doNotContact: 'do_not_contact',
  nextSendAt: 'next_send_at',
}

const emptyState: AppState = { contacts: [], reviews: [], notifications: [], socialPosts: [], settings: initialState.settings }

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
        widgets: { ...d.widgets, ...s.widgets },
        social: { ...d.social, ...s.social },
        notifications: { ...d.notifications, ...s.notifications },
        integrations: { ...d.integrations, ...s.integrations },
      },
    }
  })
  const [businesses, setBusinesses] = useState<BusinessSummary[]>(isLive ? [] : [{ id: 'demo', name: initialState.settings.business.name }])
  const [activeId, setActiveId] = useState<string | null>(isLive ? storage.get<string | null>(ACTIVE_KEY, null) : 'demo')
  const [keys, setKeys] = useState({ publicKey: isLive ? '' : 'demo0public0key000000000', apiKeyPrefix: '' })
  const [loading, setLoading] = useState(isLive)
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([])
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
      const [b, contacts, reviews, notifications, posts, templates] = await Promise.all([
        c.from('businesses').select(BUSINESS_COLS).eq('id', bid).single(),
        c.from('contacts').select('*').eq('business_id', bid).order('created_at', { ascending: false }).limit(2000),
        c.from('reviews').select('*').eq('business_id', bid).order('review_created_at', { ascending: false }).limit(500),
        c.from('notifications').select('*').eq('business_id', bid).order('created_at', { ascending: false }).limit(100),
        c.from('social_posts').select('*').eq('business_id', bid).order('created_at', { ascending: false }).limit(50),
        c.from('whatsapp_templates').select('*').eq('business_id', bid).order('created_at', { ascending: false }).limit(30),
      ])
      // whatsapp_templates comes from the second migration; don't fail the whole load if it isn't run yet
      setWaTemplates(templates.error ? [] : (templates.data ?? []).map(toWaTemplate))
      const err = b.error || contacts.error || reviews.error || notifications.error || posts.error
      if (check(err, 'Could not load data') && b.data) {
        setState({
          contacts: (contacts.data ?? []).map(toContact),
          reviews: (reviews.data ?? []).map(toReview),
          notifications: (notifications.data ?? []).map(toNotification),
          socialPosts: (posts.data ?? []).map(toPost),
          settings: toSettings(b.data),
        })
        setKeys({ publicKey: b.data.public_key, apiKeyPrefix: b.data.api_key_prefix ?? '' })
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
    async ({ name, address = '', reviewLink = '', mapsUrl = '', placeId = '' }: { name: string; address?: string; reviewLink?: string; mapsUrl?: string; placeId?: string }) => {
      if (!isLive) return toast('Locations are available once Supabase is connected')
      const { data: id, error } = await db().rpc('create_business', { p_name: name, p_address: address })
      if (!check(error, 'Could not create business')) throw new Error(error?.message)
      if (reviewLink || mapsUrl) await db().from('businesses').update({ review_link: reviewLink, maps_url: mapsUrl }).eq('id', id)
      // Picked from Google: pull rating, phone, website and latest reviews too
      if (placeId) {
        try {
          await invokeFn('google-places', { action: 'import', businessId: id, placeId })
        } catch (e) {
          toast(`Business created, but Google import failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'error')
        }
      }
      await loadBusinesses()
      setActiveId(id as string)
    },
    [check, loadBusinesses, toast],
  )

  const searchGoogle = useCallback(async (query: string): Promise<GooglePlaceResult[]> => {
    if (!isLive) {
      // Demo results so the search can be tried without a Google key
      const q = query.trim()
      return [
        { placeId: 'demo_place_1', name: q || 'Local Octo', address: '2nd Floor, 25th Main Road, J. P. Nagar, Bengaluru', rating: 5, reviewCount: 4 },
        { placeId: 'demo_place_2', name: `${q || 'Local Octo'} Studio`, address: 'Indiranagar, Bengaluru', rating: 4.7, reviewCount: 38 },
      ]
    }
    const res = await invokeFn<{ results: GooglePlaceResult[] }>('google-places', { action: 'search', query })
    return res.results
  }, [])

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

  const updateSettings = useCallback(
    async <K extends keyof Settings>(key: K, patch: Partial<Settings[K]>) => {
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
      const { error } = await db().from('businesses').update(row).eq('id', activeId)
      check(error, 'Could not save settings')
    },
    [activeId, check],
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

  const addSocialPost = useCallback(
    (post: Omit<SocialPost, 'id'>) => {
      const local = { ...post, id: uid('s') }
      setState((s) => ({ ...s, socialPosts: [local, ...s.socialPosts] }))
      if (!isLive || !activeId) return
      db()
        .from('social_posts')
        .insert({ business_id: activeId, review_id: post.reviewId, network: post.network, format: post.format, status: post.status, scheduled_at: post.at })
        .select('id')
        .single()
        .then(({ data, error }) => {
          if (check(error, 'Could not schedule post') && data)
            setState((s) => ({ ...s, socialPosts: s.socialPosts.map((p) => (p.id === local.id ? { ...p, id: data.id } : p)) }))
        })
    },
    [activeId, check],
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
    async (to: string) => {
      if (!isLive) return 'demo'
      const res = await invokeFn<{ ok: boolean; channel?: string }>('send-test', { businessId: activeId, to })
      return res.channel ?? 'sent'
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
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${activeId}/message-${Date.now()}.${ext}`
      const { error } = await db().storage.from('business-assets').upload(path, file, { upsert: true, contentType: file.type })
      if (!check(error, 'Upload failed')) throw new Error(error?.message)
      const { data } = db().storage.from('business-assets').getPublicUrl(path)
      updateSettings('messaging', { imageDataUrl: data.publicUrl, personalizedImage: true })
    },
    [activeId, check, updateSettings],
  )

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
      const { error } = await db().storage.from('business-assets').upload(path, file, { upsert: true, contentType: file.type })
      if (!check(error, 'Upload failed')) throw new Error(error?.message)
      return db().storage.from('business-assets').getPublicUrl(path).data.publicUrl
    },
    [activeId, check],
  )

  const regenerateApiKey = useCallback(async () => {
    if (!isLive) return 'lo_live_demo_key_only_works_when_connected'
    const { data, error } = await db().rpc('regenerate_api_key', { p_business: activeId })
    if (!check(error, 'Could not create key')) throw new Error(error?.message)
    const k = data as string
    setKeys((x) => ({ ...x, apiKeyPrefix: k.slice(0, 14) }))
    return k
  }, [activeId, check])

  const submitWhatsAppTemplates = useCallback(
    async (kinds: Array<'initial' | 'followup'>) => {
      if (!isLive) {
        // Demo: pretend they were submitted and are waiting for Meta
        const m = stateRef.current.settings.messaging
        const now = new Date().toISOString()
        const make = (kind: WaTemplateKind, body: string, status: WaTemplate['status'] = 'pending'): WaTemplate => ({
          id: uid('t'),
          kind,
          name: `lo_demo_${kind}_${Date.now().toString(36)}`,
          language: 'en',
          body,
          status,
          reason: null,
          category: 'marketing',
          createdAt: now,
        })
        const rows: WaTemplate[] = []
        if (kinds.includes('initial')) rows.push(make('initial', m.customMessage), make('initial_image', m.customMessage))
        if (kinds.includes('followup')) rows.push(make('followup', m.customFollowUp), make('followup_image', m.customFollowUp))
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

  const checkStandardTemplates = useCallback(async (): Promise<WaStandardTemplate[]> => {
    if (!isLive) {
      return [
        { kind: 'initial', name: 'review_request', status: 'approved', reason: null, category: 'marketing' },
        { kind: 'initial_image', name: 'review_request_image', status: 'approved', reason: null, category: 'marketing' },
        { kind: 'followup', name: 'review_followup', status: 'pending', reason: null, category: 'marketing' },
        { kind: 'followup_image', name: 'review_followup_image', status: 'not_created', reason: null, category: null },
      ]
    }
    const res = await invokeFn<{ standard: WaStandardTemplate[] }>('wa-template', { businessId: activeId, action: 'standard' })
    return res.standard
  }, [activeId])

  const submitStandardTemplates = useCallback(async (): Promise<WaStandardTemplate[]> => {
    if (!isLive) {
      const list = await checkStandardTemplates()
      return list.map((t) => (t.status === 'not_created' || t.status === 'failed' ? { ...t, status: 'pending', reason: null, category: 'marketing' } : t))
    }
    const res = await invokeFn<{ standard: WaStandardTemplate[] }>('wa-template', { businessId: activeId, action: 'submit_standard' })
    return res.standard
  }, [activeId, checkStandardTemplates])

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
      apiKeyPrefix: keys.apiKeyPrefix,
      waTemplates,
      submitWhatsAppTemplates,
      refreshWhatsAppTemplates,
      checkStandardTemplates,
      submitStandardTemplates,
      switchBusiness,
      createBusiness,
      searchGoogle,
      importFromGoogle,
      addContacts,
      updateContact,
      deleteContact,
      updateSettings,
      setReviewReply,
      addSocialPost,
      markNotificationRead,
      markAllNotificationsRead,
      sendTest,
      draftReply,
      uploadMessageImage,
      uploadBusinessAsset,
      regenerateApiKey,
      refresh,
      resetDemo,
    }),
    [loading, state, businesses, activeId, keys, waTemplates, submitWhatsAppTemplates, refreshWhatsAppTemplates, checkStandardTemplates, submitStandardTemplates, switchBusiness, createBusiness, searchGoogle, importFromGoogle, addContacts, updateContact, deleteContact, updateSettings, setReviewReply, addSocialPost, markNotificationRead, markAllNotificationsRead, sendTest, draftReply, uploadMessageImage, uploadBusinessAsset, regenerateApiKey, refresh, resetDemo],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): AppStore {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside AppStoreProvider')
  return ctx
}
