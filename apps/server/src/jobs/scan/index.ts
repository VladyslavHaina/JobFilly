import type { ScanRunPayload } from "@jobfilly/schema";
import type { JobHandler } from "../queue";

// The 'scan.run' job: the first scan and "Analyze them" runs, with a checkpoint after every batch
// so another replica can take over (F4). The scan slice implements it and keeps the name.
export const scanRunHandler: JobHandler<ScanRunPayload> = async () => {
  throw new Error("scan.run is not built yet (scan slice)");
};
