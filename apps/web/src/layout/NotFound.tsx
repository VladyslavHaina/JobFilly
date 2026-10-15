import { Link } from "react-router";
import { paths } from "../paths";

export function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-lg font-semibold text-stone-900">Page not found</h1>
      <p className="mt-2 text-sm text-stone-600">
        <Link className="text-indigo-700 hover:underline" to={paths.home()}>
          Go to JobFilly
        </Link>
      </p>
    </main>
  );
}
