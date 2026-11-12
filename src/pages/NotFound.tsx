// src/pages/NotFound.tsx
import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { Button, Card, EmptyState } from '../components/ui/primitives'

export default function NotFound() {
  return (
    <Card className="mx-auto max-w-lg">
      <EmptyState
        icon={Compass}
        title="Page not found"
        body="This page doesn't exist or has moved."
        action={
          <Link to="/dashboard">
            <Button>Back to Dashboard</Button>
          </Link>
        }
      />
    </Card>
  )
}
