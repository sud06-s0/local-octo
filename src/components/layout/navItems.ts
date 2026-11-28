// src/components/layout/navItems.ts
import {
  ClipboardCheck,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Star,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  badge?: string
  agencyOnly?: boolean
}

export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/messaging', label: 'Messaging', icon: MessageSquare },
  { to: '/reviews', label: 'Reviews', icon: Star },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/audit', label: 'Audit', icon: ClipboardCheck },
]
