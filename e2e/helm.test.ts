import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";

// The Helm chart (MVP 3, H1–H4), rendered with `helm template` and checked as data. Rendering
// is local: the chart has no dependencies, so it needs no network and no cluster. CI without
// helm on PATH skips these tests; they run wherever helm is installed.

const CHART = join(import.meta.dirname, "..", "deploy", "helm", "jobfilly");

const hasHelm = (() => {
  try {
    execFileSync("helm", ["version", "--short"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

interface Manifest {
  kind: string;
  metadata: { name: string };
  // biome-ignore lint/suspicious/noExplicitAny: rendered manifests are checked field by field
  spec?: any;
  stringData?: Record<string, string>;
  data?: Record<string, string>;
}

function render(...set: string[]): Manifest[] {
  const args = ["template", "jf", CHART, ...set.flatMap((s) => ["--set", s])];
  const out = execFileSync("helm", args, { encoding: "utf8" });
  return parseAllDocuments(out)
    .map((d) => d.toJSON() as Manifest | null)
    .filter((m): m is Manifest => m !== null);
}

const kinds = (ms: Manifest[]) => ms.map((m) => m.kind);
const one = (ms: Manifest[], kind: string) => {
  const found = ms.filter((m) => m.kind === kind);
  expect(found).toHaveLength(1);
  return found[0] as Manifest;
};

describe.skipIf(!hasHelm)("the Helm chart", () => {
  it("passes helm lint", () => {
    expect(() =>
      execFileSync("helm", ["lint", "--strict", CHART], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("renders the defaults: 2 replicas, probes, non-root, read-only with /tmp, a PDB", () => {
    const ms = render();
    expect(kinds(ms).sort()).toEqual(
      ["ConfigMap", "Deployment", "PodDisruptionBudget", "Secret", "Service"].sort(),
    );
    const deployment = one(ms, "Deployment");
    expect(deployment.spec.replicas).toBe(2);
    const pod = deployment.spec.template.spec;
    expect(pod.terminationGracePeriodSeconds).toBeGreaterThanOrEqual(30);
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 1000 });
    const [container] = pod.containers;
    expect(container.securityContext).toMatchObject({
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
    });
    expect(container.livenessProbe.httpGet).toEqual({ path: "/api/health/live", port: "http" });
    expect(container.readinessProbe.httpGet).toEqual({ path: "/api/health/ready", port: "http" });
    expect(container.ports).toEqual([{ name: "http", containerPort: 8787, protocol: "TCP" }]);
    expect(container.image).toMatch(/^jobfilly:\S+$/);
    expect(container.volumeMounts).toContainEqual({ name: "tmp", mountPath: "/tmp" });
    expect(pod.volumes).toContainEqual({ name: "tmp", emptyDir: {} });
    expect(container.resources.requests).toEqual({ cpu: "50m", memory: "192Mi" });

    expect(one(ms, "PodDisruptionBudget").spec.minAvailable).toBe(1);
    expect(one(ms, "ConfigMap").data).toMatchObject({
      PORT: "8787",
      PUBLIC_URL: "http://127.0.0.1:8787",
      LOG_LEVEL: "info",
      JOBFILLY_SYNC_INTERVAL_SECONDS: "120",
    });
  });

  it("leaves the PDB out with a single replica, so it never blocks a node drain", () => {
    const ms = render("replicaCount=1");
    expect(one(ms, "Deployment").spec.replicas).toBe(1);
    expect(kinds(ms)).not.toContain("PodDisruptionBudget");
  });

  it("renders the Ingress when enabled, and PUBLIC_URL follows its host", () => {
    const ms = render(
      "ingress.enabled=true",
      "ingress.className=nginx",
      "ingress.host=jobs.home.lan",
      "ingress.tls.secretName=jobs-tls",
    );
    const ingress = one(ms, "Ingress");
    expect(ingress.spec.ingressClassName).toBe("nginx");
    expect(ingress.spec.rules[0].host).toBe("jobs.home.lan");
    expect(ingress.spec.tls).toEqual([{ hosts: ["jobs.home.lan"], secretName: "jobs-tls" }]);
    expect(one(ms, "ConfigMap").data?.PUBLIC_URL).toBe("https://jobs.home.lan");
    expect(kinds(render())).not.toContain("Ingress");
  });

  it("renders the Istio DestinationRule only when enabled, hashing on the session cookie", () => {
    expect(kinds(render())).not.toContain("DestinationRule");
    const rule = one(render("istio.destinationRule.enabled=true"), "DestinationRule");
    expect(rule.spec.host).toBe("jf-jobfilly.default.svc.cluster.local");
    expect(rule.spec.trafficPolicy.loadBalancer.consistentHash.httpCookie).toEqual({
      name: "jf_session",
      path: "/",
    });
  });

  it("uses an existing Secret instead of its own", () => {
    const ms = render("existingSecret=jobfilly-secrets");
    expect(kinds(ms)).not.toContain("Secret");
    const [container] = one(ms, "Deployment").spec.template.spec.containers;
    expect(container.envFrom).toContainEqual({ secretRef: { name: "jobfilly-secrets" } });
  });

  it("puts the secret settings in its Secret", () => {
    const secret = one(
      render("secret.databaseUrl=postgres://u:p@db:5432/jf", "secret.secretKey=a2V5"),
      "Secret",
    );
    expect(secret.stringData).toEqual({
      DATABASE_URL: "postgres://u:p@db:5432/jf",
      JOBFILLY_SECRET_KEY: "a2V5",
    });
  });

  it("bundles PostgreSQL when enabled and points DATABASE_URL at it", () => {
    const ms = render("postgresql.enabled=true", "postgresql.auth.password=0a1b2c");
    const db = one(ms, "StatefulSet");
    expect(db.spec.template.spec.containers[0].image).toBe("postgres:17");
    expect(db.spec.volumeClaimTemplates[0].spec.resources.requests.storage).toBe("8Gi");
    const app = ms.find((m) => m.kind === "Secret" && m.metadata.name === "jf-jobfilly");
    expect(app?.stringData?.DATABASE_URL).toBe(
      "postgres://jobfilly:0a1b2c@jf-jobfilly-postgresql:5432/jobfilly",
    );
    expect(kinds(render())).not.toContain("StatefulSet");
  });

  it("refuses a bundled PostgreSQL without a password", () => {
    expect(() =>
      execFileSync("helm", ["template", "jf", CHART, "--set", "postgresql.enabled=true"], {
        stdio: "pipe",
      }),
    ).toThrow(/postgresql\.auth\.password is required/);
  });
});
