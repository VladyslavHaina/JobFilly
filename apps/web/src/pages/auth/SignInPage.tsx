import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api";
import { Alert, Button, TextField } from "../../components";
import { useSession, useSignIn } from "../../hooks";
import { paths } from "../../paths";
import { AuthLayout } from "./AuthLayout";
import { nextPath } from "./next";

export function SignInPage() {
  const { user } = useSession();
  const signIn = useSignIn();
  const navigate = useNavigate();
  const location = useLocation();
  const next = nextPath(location.search);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (user) return <Navigate to={next ?? paths.home()} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate(
      { email, password },
      { onSuccess: () => navigate(next ?? paths.home(), { replace: true }) },
    );
  };

  const error =
    signIn.error instanceof ApiError
      ? signIn.error.message
      : signIn.error
        ? "Couldn't sign in. Try again."
        : null;

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Alert>{error}</Alert>}
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" busy={signIn.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-5 text-sm text-stone-600">
        New here?{" "}
        <Link
          className="font-medium text-indigo-700 hover:underline"
          to={paths.register(next ?? undefined)}
        >
          Create account
        </Link>
      </p>
    </AuthLayout>
  );
}
