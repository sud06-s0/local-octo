// src/pages/AddContacts.tsx
import { useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router'
import { Download, FileText, Upload, UserPlus, X } from 'lucide-react'
import { Button, Card, Checkbox, Input, Label, Segmented, Toggle } from '../components/ui/primitives'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { cn, isEmail, isPhone, parseCsv } from '../lib/utils'
import type { NewContact } from '../types'

type Tab = 'single' | 'csv'

function SingleContactForm() {
  const { addContacts } = useStore()
  const toast = useToast()
  const empty = { firstName: '', lastName: '', email: '', phone: '', doNotContact: false }
  const [form, setForm] = useState<NewContact>(empty)
  const [consent, setConsent] = useState(false)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const emailOk = !form.email || isEmail(form.email)
  const phoneOk = !form.phone || isPhone(form.phone)
  const hasMethod = !!form.email.trim() || !!form.phone.trim()
  const valid = form.firstName.trim() && hasMethod && emailOk && phoneOk && (consent || form.doNotContact)

  const submit = async () => {
    setTouched(true)
    if (!valid || busy) return
    setBusy(true)
    try {
      const res = await addContacts([{ ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), phone: form.phone.trim() }])
      if (res.cooldown) toast(`${form.firstName} was asked in the last 30 days — not sending again yet`)
      else if (res.invalid) toast('Check the phone number or email', 'error')
      else toast(`${form.firstName} ${res.updated ? 'updated' : 'added'}${form.doNotContact ? ' to Do Not Contact list' : ' — review request scheduled'}`)
      setForm(empty)
      setConsent(false)
      setTouched(false)
    } catch {
      /* error toast shown by the store */
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof NewContact, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-semibold">Add Single Contact</h2>
      <p className="mt-0.5 text-[15px] text-muted">Manually enter contact details to add them to your list</p>

      <div className="mt-6 flex items-center justify-between gap-4 rounded-lg border border-line bg-canvas px-4 py-3">
        <div>
          <p className="text-[15px] font-medium">Add to Do Not Contact List</p>
          <p className="text-sm text-muted">Contact will not receive any messages</p>
        </div>
        <Toggle checked={form.doNotContact} onChange={(v) => set('doNotContact', v)} label="Add to Do Not Contact list" />
      </div>

      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="first" required>First Name</Label>
            <Input id="first" placeholder="Enter first name" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
            {touched && !form.firstName.trim() && <p className="mt-1 text-xs text-red-600">First name is required</p>}
          </div>
          <div>
            <Label htmlFor="last">Last Name</Label>
            <Input id="last" placeholder="Enter last name" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="Enter email address" value={form.email} onChange={(e) => set('email', e.target.value)} />
          {!emailOk && <p className="mt-1 text-xs text-red-600">Enter a valid email address</p>}
        </div>
        <div>
          <Label htmlFor="phone">Phone Number</Label>
          <Input id="phone" type="tel" placeholder="Enter phone number" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          {!phoneOk && <p className="mt-1 text-xs text-red-600">Enter a valid phone number with country code</p>}
          <p className={cn('mt-2 text-xs', touched && !hasMethod ? 'text-red-600' : 'text-muted')}>
            At least one contact method (email or phone) is required
          </p>
        </div>

        {!form.doNotContact && (
          <div className="rounded-lg border border-line px-4 py-4">
            <Checkbox checked={consent} onChange={setConsent} label="I have the required consent to message this customer by email, SMS or WhatsApp" />
          </div>
        )}

        <Button type="submit" size="lg" icon={UserPlus} className="w-full" disabled={!valid || busy}>
          {busy ? 'Adding…' : 'Add Contact'}
        </Button>
      </form>
    </Card>
  )
}

const HEADER_MAP: Record<string, keyof NewContact> = {
  first_name: 'firstName', firstname: 'firstName', first: 'firstName', name: 'firstName',
  last_name: 'lastName', lastname: 'lastName', last: 'lastName', surname: 'lastName',
  email: 'email', email_address: 'email', mail: 'email',
  phone: 'phone', phone_number: 'phone', mobile: 'phone', whatsapp: 'phone',
}

function CsvImport() {
  const { addContacts } = useStore()
  const toast = useToast()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<NewContact[]>([])
  const [invalid, setInvalid] = useState(0)
  const [consent, setConsent] = useState(false)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)

  const readFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) return toast('Please choose a .csv file', 'error')
    const reader = new FileReader()
    reader.onload = () => {
      const table = parseCsv(String(reader.result ?? ''))
      if (table.length < 2) return toast('The file has no data rows', 'error')
      const headers = table[0].map((h) => HEADER_MAP[h.trim().toLowerCase().replace(/\s+/g, '_')])
      if (!headers.includes('firstName')) return toast('Could not find a first_name column', 'error')
      const parsed: NewContact[] = []
      let bad = 0
      for (const r of table.slice(1)) {
        const c: NewContact = { firstName: '', lastName: '', email: '', phone: '', doNotContact: false }
        headers.forEach((key, i) => {
          if (key && key !== 'doNotContact') c[key] = (r[i] ?? '').trim()
        })
        // "name" column with full name -> split
        if (!c.lastName && c.firstName.includes(' ')) {
          const [f, ...rest] = c.firstName.split(' ')
          c.firstName = f
          c.lastName = rest.join(' ')
        }
        const ok = c.firstName && ((c.email && isEmail(c.email)) || (c.phone && isPhone(c.phone)))
        if (ok) parsed.push(c)
        else bad++
      }
      setFileName(file.name)
      setRows(parsed)
      setInvalid(bad)
    }
    reader.readAsText(file)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) readFile(f)
  }

  const downloadTemplate = () => {
    const blob = new Blob(['first_name,last_name,email,phone\nPriya,Raman,priya@example.com,+919845011223\n'], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'contacts-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const clear = () => {
    setRows([])
    setFileName('')
    setInvalid(0)
    setConsent(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Import CSV</h2>
          <p className="mt-0.5 text-[15px] text-muted">Upload past or new customers in bulk</p>
        </div>
        <Button variant="outline" size="sm" icon={Download} onClick={downloadTemplate}>
          Template
        </Button>
      </div>

      {!fileName ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'mt-6 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition',
            drag ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-brand-300 hover:bg-canvas',
          )}
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-brand-50">
            <Upload className="size-5 text-brand-700" />
          </span>
          <p className="mt-3 font-medium">Drop your CSV here or click to browse</p>
          <p className="mt-1 text-sm text-muted">Columns: first_name, last_name, email, phone</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-4 py-3">
            <FileText className="size-5 text-brand-700" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{fileName}</p>
              <p className="text-sm text-muted">
                {rows.length} ready to import{invalid > 0 && <span className="text-amber-700"> · {invalid} skipped (missing name or contact)</span>}
              </p>
            </div>
            <button onClick={clear} className="rounded-md p-1 text-muted hover:bg-white hover:text-ink" aria-label="Remove file">
              <X className="size-4" />
            </button>
          </div>

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-3 py-2">{r.firstName} {r.lastName}</td>
                      <td className="px-3 py-2 text-muted">{r.email || '—'}</td>
                      <td className="px-3 py-2 text-muted">{r.phone || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 5 && <p className="border-t border-line px-3 py-2 text-xs text-muted">+ {rows.length - 5} more</p>}
            </div>
          )}

          <div className="rounded-lg border border-line px-4 py-4">
            <Checkbox checked={consent} onChange={setConsent} label="I have the required consent to message these customers" />
          </div>
          <Button
            size="lg"
            className="w-full"
            icon={UserPlus}
            disabled={!consent || rows.length === 0 || busy}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await addContacts(rows, 'csv')
                const parts = [`${r.added} added`]
                if (r.updated) parts.push(`${r.updated} updated`)
                if (r.cooldown) parts.push(`${r.cooldown} skipped (asked in last 30 days)`)
                if (r.invalid) parts.push(`${r.invalid} invalid`)
                toast(parts.join(' · '))
                clear()
                navigate('/contacts')
              } catch {
                /* error toast shown by the store */
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Importing…' : `Import ${rows.length} Contacts`}
          </Button>
        </div>
      )}
      <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
    </Card>
  )
}

export default function AddContacts() {
  const [tab, setTab] = useState<Tab>('single')
  return (
    <div className="mx-auto max-w-[832px]">
      <h1 className="text-[26px] font-semibold tracking-tight">Add Contacts</h1>
      <p className="mt-1 text-[16px] text-muted">Add contacts individually or import from a CSV file</p>

      <Segmented
        className="mt-6"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'single', label: 'Single Contact', icon: UserPlus },
          { value: 'csv', label: 'Import CSV', icon: FileText },
        ]}
      />

      <div className="mt-8">{tab === 'single' ? <SingleContactForm /> : <CsvImport />}</div>
    </div>
  )
}
