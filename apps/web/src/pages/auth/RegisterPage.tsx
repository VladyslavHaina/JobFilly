import { PASSWORD_MIN_LENGTH, WorkspaceListSchema } from "@jobfilly/schema";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { ApiError, api } from "../../api";
import { Alert, Button, TextField } from "../../components";
import { queryKeys, useRegister, useSession } from "../../hooks";
import { paths } from "../../paths";
import { AuthLayout } from "./AuthLayout";
import { nextPath } from "./next";

export function RegisterPage() {
  const { user } = useSession();
  const register = useRegister();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const next = nextPath(location.search);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tooShort, setTooShort] = useState(false);

  if (user && !register.isPending && !register.isSuccess) {
    return <Navigate to={next ?? paths.home()} replace />;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    register.mutate(
      { name, email, password },
      {
        onSuccess: async () => {
          if (next) return navigate(next, { replace: true });
          // A new account starts by connecting its mailbox in its personal workspace.
          try {
            const items = await client.fetchQuery({
              queryKey: queryKeys.workspaces,
              queryFn: async () => (await api("/api/workspaces", WorkspaceListSchema)).items,
            });
            const own = items.find((w) => w.isOwner) ?? items[0];
            navigate(own ? paths.onboarding(own.id, "mailbox") : paths.home(), { replace: true });
          } catch {
            navigate(paths.home(), { replace: true });
          }
        },
      },
    );
  };

  const error =
    register.error instanceof ApiError
      ? register.error.message
      : register.error
        ? "Couldn't create the account. Try again."
        : null;

  return (
    <AuthLayout title="Create account">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
          error={tooShort ? `Use at least ${PASSWORD_MIN_LENGTH} characters` : null}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" busy={register.isPending}>
          Create account
        </Button>
      </form>
      <p className="mt-5 text-sm text-stone-600">
        Already have an account?{" "}
        <Link
          className="font-medium text-indigo-700 hover:underline"
          to={paths.signIn(next ?? undefined)}
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
