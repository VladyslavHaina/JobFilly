import { LivenessSchema } from "@jobfilly/schema";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api("/api/health/live", LivenessSchema),
  });

  let status = "Connecting to the server…";
  if (health.isError) status = "Server unreachable";
  else if (health.data) status = "Server ok";

  return (
    <main className="mx-auto max-w-xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">JobFilly</h1>
      <p className="mt-2 text-sm text-neutral-600" role="status">
        {status}
      </p>
    </main>
  );
}
