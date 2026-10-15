import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createBrowserRouter, type DataRouter, RouterProvider } from "react-router";
import { ApiError } from "./api";
import { queryKeys } from "./hooks";
import { routes } from "./routes";

/** A query client that treats any 401 as "signed out", so the app goes to Sign in. */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: (count, error) => !(error instanceof ApiError) && count < 2 },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) {
          client.setQueryData(queryKeys.session, null);
        }
      },
    }),
  });
  return client;
}

export function App({ router, queryClient }: { router?: DataRouter; queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  const [appRouter] = useState(() => router ?? createBrowserRouter(routes));
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={appRouter} />
    </QueryClientProvider>
  );
}
