import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/runs/$runId/audit')({
  component: lazyRouteComponent(() => import('../pages/AuditEventsPage')),
});
