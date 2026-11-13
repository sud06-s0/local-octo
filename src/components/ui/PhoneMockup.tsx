// src/components/ui/PhoneMockup.tsx
import type { ReactNode } from 'react'

export function PhoneMockup({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto h-fit w-[280px] self-start rounded-[44px] bg-[#111] p-3 shadow-xl">
      <div className="relative h-[540px] overflow-hidden rounded-[34px] bg-[#f4f5f5]">
        <div className="absolute left-1/2 top-0 h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-[#111]" />
        <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-semibold text-ink">
          <span>9:41</span>
          <span className="inline-block h-2.5 w-5 rounded-[3px] border border-ink p-[1px]">
            <span className="block h-full w-4/5 rounded-[1px] bg-ink" />
          </span>
        </div>
        <div className="flex h-[calc(100%-32px)] flex-col gap-2 overflow-y-auto px-3 pb-4 pt-5 scrollbar-none">{children}</div>
      </div>
    </div>
  )
}

export function OutgoingBubble({ children, time }: { children: ReactNode; time: string }) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[86%] rounded-2xl rounded-br-md bg-[#3478f6] px-3 py-2.5 text-[13.5px] leading-[1.55] text-white">{children}</div>
      <span className="mt-1 text-[10px] text-muted/70">{time}</span>
    </div>
  )
}

export function IncomingBubble({ children, time }: { children: ReactNode; time: string }) {
  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-[#e6e8e8] px-3 py-2.5 text-[13.5px] leading-[1.55] text-ink">{children}</div>
      <span className="mt-1 text-[10px] text-muted/70">{time}</span>
    </div>
  )
}
