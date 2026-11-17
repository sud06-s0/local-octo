// src/components/layout/navItems.ts
import {
  CalendarClock,
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
}

export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/messaging', label: 'Messaging', icon: MessageSquare },
  { to: '/request-scheduling', label: 'Request Scheduling', icon: CalendarClock },
  { to: '/reviews', label: 'Reviews', icon: Star },
  { to: '/integrations', label: 'Integrations', icon: Plug },
]
