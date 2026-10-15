import { type JobPlatformsFile, JobPlatformsFileSchema } from "@jobfilly/schema";
import data from "../../data/job-platforms.json";

type Platform = JobPlatformsFile["entries"][number];

let cached: JobPlatformsFile | null = null;

/**
 * The job boards and applicant-tracking senders of packages/core/data/job-platforms.json,
 * checked against JobPlatformsFileSchema the first time they are read.
 */
export function loadJobPlatforms(): JobPlatformsFile {
  cached ??= JobPlatformsFileSchema.parse(data);
  return cached;
}

/** The lowercase domain of an address ("" when it has none). */
function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 0
    ? ""
    : address
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

function localPartOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 0 ? "" : address.slice(0, at).trim().toLowerCase();
}

/** The platform whose domain is the sender's domain or a parent of it, if any. */
export function platformOf(address: string, platforms: JobPlatformsFile): Platform | null {
  const domain = domainOf(address);
  if (!domain) return null;
  return (
    platforms.entries.find((p) => domain === p.domain || domain.endsWith(`.${p.domain}`)) ?? null
  );
}

/** True when the address is one a platform sends its job alerts from. */
export function isAlertSender(address: string, platforms: JobPlatformsFile): boolean {
  const platform = platformOf(address, platforms);
  return platform?.alertSenders.includes(localPartOf(address)) ?? false;
}
