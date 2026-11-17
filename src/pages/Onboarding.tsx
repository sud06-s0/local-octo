// src/pages/Onboarding.tsx
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button, Card } from '../components/ui/primitives'
import { BusinessDetailsForm, businessDetailsValid, type BusinessDetails } from '../components/BusinessDetailsForm'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { brand } from '../config/brand'

export default function Onboarding() {
  const { createBusiness } = useStore()
  const { user, signOut, isAgency } = useAuth()
  const [details, setDetails] = useState<BusinessDetails>({ name: '', address: '', reviewLink: '', mapsUrl: '' })
  const [busy, setBusy] = useState(false)

  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={brand.logoUrl} alt="" className="size-10 object-contain" />
            <span className="text-lg font-semibold">{brand.appName}</span>
          </div>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={signOut}>Sign out</Button>
        </div>
        {isAgency ? (
          <>
        <h1 className="text-[26px] font-semibold tracking-tight">Set up your business</h1>
        <p className="mt-1 text-muted">Hi {user.name.split(' ')[0]}, add the business you want to collect reviews for. You can change this later.</p>
        <Card className="mt-6 p-5 sm:p-6">
          <BusinessDetailsForm value={details} onChange={setDetails} />
          <Button
            size="lg"
            className="mt-6 w-full"
            disabled={!businessDetailsValid(details) || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await createBusiness({ name: details.name.trim(), address: details.address.trim(), reviewLink: details.reviewLink.trim(), mapsUrl: details.mapsUrl.trim() })
              } catch {
                /* toast already shown */
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Creating…' : 'Continue'}
          </Button>
        </Card>
          </>
        ) : (
          // Client logins can't add businesses: their agency gives them access
          <Card className="p-6 text-center">
            <h1 className="text-[22px] font-semibold tracking-tight">No business yet</h1>
            <p className="mt-2 text-muted">
              Hi {user.name.split(' ')[0]}, your agency hasn't given this login access to a business yet. Ask them to add {user.email}, then refresh this page.
            </p>
            <Button className="mt-5" variant="outline" onClick={() => window.location.reload()}>Refresh</Button>
          </Card>
        )}
      </div>
    </div>
  )
}
