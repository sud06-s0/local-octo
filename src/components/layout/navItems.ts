// src/components/layout/navItems.ts
import {
  CalendarClock,
  Globe,
  LayoutDashboard,
  LayoutGrid,
  MessageSquare,
  Plug,
  Share2,
  Star,
  UserPlus,
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
  { to: '/add-contacts', label: 'Add Contacts', icon: UserPlus },
  { to: '/messaging', label: 'Messaging', icon: MessageSquare },
  { to: '/request-scheduling', label: 'Request Scheduling', icon: CalendarClock },
  { to: '/reviews', label: 'Reviews', icon: Star },
  { to: '/widgets', label: 'Widgets', icon: LayoutGrid },
  { to: '/social-posting', label: 'Social Posting', icon: Share2 },
  { to: '/websites', label: 'Websites', icon: Globe, badge: 'New' },
  { to: '/integrations', label: 'Integrations', icon: Plug },
]
