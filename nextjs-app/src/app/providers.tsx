'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardToastProvider } from '@/components/dashboard/dashboard-toast';

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser session; created in state so it survives re-renders
  // but is never shared between users on the server.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardToastProvider>{children}</DashboardToastProvider>
    </QueryClientProvider>
  );
}
