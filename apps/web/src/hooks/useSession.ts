import {
  type RegisterInput,
  SessionInfoSchema,
  SessionStateSchema,
  type SignInInput,
  type User,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiVoid } from "../api";
import { queryKeys } from "./queryKeys";

/** The signed-in user, null when signed out, undefined while loading. */
export function useSession(): { user: User | null | undefined; isLoading: boolean } {
  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: async () => (await api("/api/auth/session", SessionStateSchema)).user,
    staleTime: 60_000,
    retry: false,
  });
  return { user: query.data, isLoading: query.isLoading };
}

export function useRegister() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      api("/api/auth/register", SessionInfoSchema, { method: "POST", body: input }),
    onSuccess: ({ user }) => {
      client.clear();
      client.setQueryData(queryKeys.session, user);
    },
  });
}

export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SignInInput) =>
      api("/api/auth/sign-in", SessionInfoSchema, { method: "POST", body: input }),
    onSuccess: ({ user }) => {
      client.clear();
      client.setQueryData(queryKeys.session, user);
    },
  });
}

/** Signs out and forgets every cached answer, so nothing of the workspace stays on screen. */
export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiVoid("/api/auth/sign-out", { method: "POST" }),
    onSettled: () => {
      client.clear();
      client.setQueryData(queryKeys.session, null);
    },
  });
}
