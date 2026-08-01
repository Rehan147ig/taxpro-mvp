import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/runs/$runId/export')({
  component: lazyRouteComponent(() => import('../pages/ExportPackagePage')),
});
