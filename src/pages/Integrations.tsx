// src/pages/Integrations.tsx
// Only what each client must connect themselves: their Google Business Profile.
// WhatsApp, SMS and email go out through Local Octo's own accounts, so they need nothing here.

import { PageHeader } from '../components/ui/primitives'
import { GoogleConnectCard } from '../components/GoogleConnectCard'

export default function Integrations() {
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Integrations" subtitle="Connect your Google Business Profile to sync reviews and reply on Google" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <GoogleConnectCard />
      </div>
    </div>
  )
}
