// src/components/ReviewQr.tsx
// QR code for the business's review link: view, share, and download as a PDF.
// Client logins can download the PDF once; agency logins any number of times (checked in the database).
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, QrCode, Share2 } from 'lucide-react'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { useToast } from './ui/Toast'
import { Modal } from './ui/Modal'
import { Button } from './ui/primitives'
import { brand } from '../config/brand'

export function ReviewQrButton({ link }: { link: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" icon={QrCode} className="w-full" disabled={!link} onClick={() => setOpen(true)}>
        Review QR Code
      </Button>
      {open && <ReviewQrModal link={link} onClose={() => setOpen(false)} />}
    </>
  )
}

function ReviewQrModal({ link, onClose }: { link: string; onClose: () => void }) {
  const { state, markQrDownload } = useStore()
  const { isAgency } = useAuth()
  const toast = useToast()
  const name = state.settings.business.name
  const downloaded = !!state.settings.business.qrDownloadedAt
  const canDownload = isAgency || !downloaded
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    QRCode.toDataURL(link, { width: 1024, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1f1b2e', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [link])

  const downloadPdf = async () => {
    if (!qr) return
    setBusy(true)
    const err = await markQrDownload()
    setBusy(false)
    if (err) return toast(err, 'error')
    // A4 portrait poster: business name, call to action, big QR, link (PDF library loaded only when needed)
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const w = pdf.internal.pageSize.getWidth()
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(26)
    pdf.text(pdf.splitTextToSize(name, w - 30), w / 2, 35, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(16)
    pdf.text('Loved your visit? Scan to leave us a review', w / 2, 55, { align: 'center' })
    const size = 130
    // Smaller, compressed copy for the PDF (sharp at print size, small file)
    const pdfQr = await QRCode.toDataURL(link, { width: 600, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1f1b2e', light: '#ffffff' } })
    pdf.addImage(pdfQr, 'PNG', (w - size) / 2, 70, size, size, undefined, 'FAST')
    pdf.setFontSize(10)
    pdf.setTextColor(110)
    pdf.text(link, w / 2, 215, { align: 'center' })
    pdf.text(`Powered by ${brand.appName}`, w / 2, 280, { align: 'center' })
    pdf.save(`${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'review'}-qr.pdf`)
    toast('QR code PDF downloaded')
  }

  const share = async () => {
    try {
      if (navigator.share) {
        const files = qr ? [new File([await (await fetch(qr)).blob()], 'review-qr.png', { type: 'image/png' })] : []
        const data: ShareData = { title: `Review ${name}`, text: `Leave ${name} a review`, url: link }
        if (files.length && navigator.canShare?.({ files })) data.files = files
        await navigator.share(data)
        return
      }
    } catch {
      return // share sheet closed
    }
    await navigator.clipboard?.writeText(link).catch(() => {})
    toast('Review link copied')
  }

  return (
    <Modal open onClose={onClose} title="Review QR code">
      <div className="flex flex-col items-center text-center">
        {qr ? (
          <img src={qr} alt={`QR code for ${name}'s review link`} className="size-56 rounded-xl ring-1 ring-line" />
        ) : (
          <div className="size-56 animate-pulse rounded-xl bg-canvas" />
        )}
        <p className="mt-3 font-semibold">{name}</p>
        <p className="mt-0.5 break-all text-xs text-muted">{link}</p>
        <p className="mt-3 text-sm text-muted">Customers scan it with their phone camera to open your review page.</p>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <Button icon={Download} disabled={!qr || !canDownload || busy} onClick={downloadPdf}>
          {busy ? 'Preparing…' : 'Download PDF'}
        </Button>
        <Button variant="outline" icon={Share2} disabled={!qr} onClick={share}>Share</Button>
        <Button
          variant="outline"
          icon={Copy}
          onClick={async () => {
            await navigator.clipboard?.writeText(link).catch(() => {})
            toast('Review link copied')
          }}
        >
          Copy link
        </Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        {isAgency
          ? 'Agency logins can download the PDF any number of times.'
          : downloaded
            ? 'The PDF was already downloaded. Ask your agency for another copy. You can still share the link.'
            : 'You can download the PDF once. Keep the file safe.'}
      </p>
    </Modal>
  )
}
