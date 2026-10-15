import { Navigate, Outlet, useLocation } from "react-router";
import { Loading } from "../components";
import { useSession } from "../hooks";
import { paths } from "../paths";

/** Signed-in pages: anyone else goes to Sign in, and comes back here afterwards. */
export function RequireSession() {
  const { user, isLoading } = useSession();
  const location = useLocation();
  if (isLoading || user === undefined) {
    return (
      <main className="p-8">
        <Loading />
      </main>
    );
  }
  if (!user) {
    const here = `${location.pathname}${location.search}`;
    return <Navigate to={paths.signIn(here === "/" ? undefined : here)} replace />;
  }
  return <Outlet />;
}
