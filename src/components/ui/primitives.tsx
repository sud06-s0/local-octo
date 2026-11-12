// src/components/ui/primitives.tsx
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Star, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

/* ---------- Card ---------- */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-line bg-white', className)}>{children}</div>
}

/* ---------- Button ---------- */
type Variant = 'primary' | 'outline' | 'ghost' | 'soft' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variantClass: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-600/50 disabled:text-white/90',
  outline: 'border border-line bg-white text-ink hover:bg-canvas disabled:text-muted/60',
  ghost: 'text-muted hover:bg-canvas hover:text-ink',
  soft: 'bg-brand-50 text-brand-800 hover:bg-brand-100 disabled:text-brand-800/50',
  danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
}
const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: LucideIcon
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {children}
    </button>
  )
})

/* ---------- Form fields ---------- */
export function Label({ children, htmlFor, required }: { children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-[15px] font-medium text-ink">
      {children}
      {required && <span className="ml-1 text-red-500">*</span>}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-line bg-white px-3 text-[15px] text-ink placeholder:text-muted/70 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-100',
        className,
      )}
      {...rest}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-muted/70 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-100',
        className,
      )}
      {...rest}
    />
  )
})

export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  className?: string
}) {
  return (
    <label className={cn('inline-flex cursor-pointer select-none items-center gap-2 text-[15px] text-ink', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 shrink-0 cursor-pointer rounded border-line accent-brand-700"
      />
      {label}
    </label>
  )
}

/* ---------- Toggle ---------- */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-[38px] shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-50',
        checked ? 'border-brand-700 bg-brand-700' : 'border-gray-300 bg-gray-200',
      )}
    >
      <span
        className={cn(
          'inline-block size-[18px] rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[15px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

/* ---------- Badge ---------- */
type Tone = 'green' | 'gray' | 'amber' | 'red' | 'blue'
const toneClass: Record<Tone, string> = {
  green: 'bg-brand-50 text-brand-700 ring-brand-200',
  gray: 'bg-gray-50 text-muted ring-gray-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
}
export function Badge({ tone = 'green', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', toneClass[tone], className)}>
      {children}
    </span>
  )
}

/* ---------- Stars ---------- */
export function Stars({ rating, size = 16, color = 'var(--color-star)', className }: { rating: number; size?: number; color?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size, color: i <= Math.round(rating) ? color : '#d9dddb' }}
          fill="currentColor"
          strokeWidth={0}
        />
      ))}
    </span>
  )
}

/* ---------- Headings ---------- */
/** Heading with the green hand-drawn underline used across the dashboard. */
export function UnderlineHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('relative inline-block pb-1.5', className)}>
      {children}
      <svg
        aria-hidden
        className="absolute -bottom-0.5 left-0 h-[7px] w-full text-brand-600"
        viewBox="0 0 200 8"
        preserveAspectRatio="none"
      >
        <path d="M1 5.5C40 2.5 120 1.8 199 3.6" stroke="currentColor" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[16px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* ---------- Empty state ---------- */
export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-canvas">
        <Icon className="size-6 text-muted" />
      </div>
      <p className="text-[16px] font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ---------- Segmented tabs ---------- */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; icon?: LucideIcon; count?: number }>
  className?: string
}) {
  return (
    <div className={cn('inline-flex w-full rounded-lg bg-[#eef0ef] p-1 sm:w-auto', className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-1.5 text-[15px] font-medium transition sm:flex-none sm:px-10',
              active ? 'bg-white text-ink shadow-sm' : 'text-ink/80 hover:text-ink',
            )}
          >
            {Icon && <Icon className="size-4" />}
            {o.label}
            {o.count !== undefined && <span className="rounded bg-black/5 px-1.5 text-xs">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Range slider ---------- */
export function RangeSlider({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  label: string
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="lo-range"
      style={{ ['--fill' as string]: `${fill}%` }}
    />
  )
}

/* ---------- Divider with label ---------- */
export function LabeledDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="h-px flex-1 bg-line" />
      <span className="text-sm text-muted">{label}</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  )
}

/* ---------- Avatar ---------- */
export function Avatar({ name, color, size = 40 }: { name: string; color?: string; size?: number }) {
  const letters = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color ?? 'var(--color-brand-600)', fontSize: size * 0.38 }}
    >
      {letters}
    </span>
  )
}
