import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/runs/$runId/findings')({
  component: lazyRouteComponent(() => import('../pages/AiFindingsPage')),
});
