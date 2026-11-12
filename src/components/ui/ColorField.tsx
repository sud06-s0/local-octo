// src/components/ui/ColorField.tsx
import { useId } from 'react'

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  const valid = /^#[0-9a-fA-F]{6}$/.test(value)
  return (
    <div className="rounded-xl bg-canvas p-4">
      <label htmlFor={id} className="mb-3 block text-[15px] text-ink">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <span className="relative size-8 shrink-0 overflow-hidden rounded-md border border-line" style={{ background: valid ? value : '#fff' }}>
          <input
            type="color"
            aria-label={`${label} picker`}
            value={valid ? value : '#ffffff'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </span>
        <input
          id={id}
          value={value}
          maxLength={7}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-24 rounded-md bg-white/70 px-2 py-1 font-mono text-sm text-ink outline-none ring-1 ring-transparent focus:ring-brand-300"
        />
      </div>
    </div>
  )
}
