import {
  type ExportTablePart,
  exportCvFile,
  exportPage,
  listActivity,
  listCvFiles,
} from "@jobfilly/db";
import {
  EXPORT_PARTS,
  EXPORT_SCHEMA_VERSION,
  type ExportManifest,
  type ExportPart,
} from "@jobfilly/schema";
import { Zip, ZipDeflate } from "fflate";
import { loadPipeline } from "../applications/load";
import type { AppDeps } from "../deps";
import { activityEntry } from "../routes/activity";

// The workspace as one ZIP (MVP 3, F7.1): manifest.json, one JSON file per part (EXPORT_PARTS),
// each an array written a page at a time, and the CV files under cvs/. The ZIP is produced as the
// response is read: each page is read from Postgres, compressed and handed on before the next is
// read, so memory stays flat whatever the workspace's size. pipeline.json is the pipeline's items
// as GET /pipeline builds them (loadPipeline). Nothing secret is in any part (mailbox credentials
// and the AI key aren't exported).

/** Rows read from Postgres per page. */
const PAGE = 500;

const encoder = new TextEncoder();

/** A CV file's path in the ZIP: its id keeps names unique; nothing in the name can leave cvs/. */
function cvPath(cv: { id: string; fileName: string }): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
  const safe = cv.fileName.replace(/[\u0000-\u001f/\\]/g, "_").replace(/^\.+/, "_");
  return `cvs/${cv.id}-${safe}`;
}

/** The rows of one part, page by page. */
async function* partRows(
  deps: AppDeps,
  workspaceId: string,
  part: ExportPart,
): AsyncGenerator<unknown[]> {
  if (part === "activity") {
    let before: string | undefined;
    do {
      const page = await listActivity(deps.db, workspaceId, { before, limit: PAGE });
      yield page.items.map(activityEntry);
      before = page.nextBefore ?? undefined;
    } while (before);
    return;
  }
  if (part === "pipeline") {
    // The whole pipeline as GET /pipeline answers it: every item with its stage, derived from the
    // mail or set by hand (F5.1). It is built whole, as it is for GET /pipeline.
    yield (await loadPipeline(deps, workspaceId)).stages.flatMap((s) => s.items);
    return;
  }
  let after: string | null = null;
  do {
    const page = await exportPage(deps.db, workspaceId, part as ExportTablePart, after, PAGE);
    yield page.rows;
    after = page.after;
  } while (after);
}

/**
 * The export of the workspace as a stream of ZIP bytes. `onDone` runs once the last byte has been
 * produced (to record and log the export); an error ends the stream with it.
 */
export function exportZip(
  deps: AppDeps,
  workspace: { id: string; name: string },
  onDone: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const out: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else out.push(chunk);
  });
  function* drain(): Generator<Uint8Array> {
    if (failure) throw failure;
    while (out.length > 0) {
      const chunk = out.shift();
      if (chunk && chunk.length > 0) yield chunk;
    }
  }
  function file(name: string): ZipDeflate {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    return entry;
  }

  async function* produce(): AsyncGenerator<Uint8Array> {
    const cvFiles = await listCvFiles(deps.db, workspace.id);
    const manifest: ExportManifest = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      exportedAt: deps.clock.now().toISOString(),
      parts: [...EXPORT_PARTS],
      cvFiles: cvFiles.map(cvPath),
    };
    file("manifest.json").push(encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`), true);
    yield* drain();

    for (const part of EXPORT_PARTS) {
      const entry = file(`${part}.json`);
      let first = true;
      entry.push(encoder.encode("["));
      for await (const rows of partRows(deps, workspace.id, part)) {
        if (rows.length === 0) continue;
        const text = rows.map((row) => JSON.stringify(row)).join(",\n");
        entry.push(encoder.encode(`${first ? "\n" : ",\n"}${text}`));
        first = false;
        yield* drain();
      }
      entry.push(encoder.encode(first ? "]\n" : "\n]\n"), true);
      yield* drain();
    }

    for (const cv of cvFiles) {
      const bytes = await exportCvFile(deps.db, workspace.id, cv.id);
      file(cvPath(cv)).push(bytes ?? new Uint8Array(), true);
      yield* drain();
    }
    zip.end();
    yield* drain();
    await onDone();
  }

  const chunks = produce();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        deps.log.error("http.error", { error, workspaceId: workspace.id });
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}
