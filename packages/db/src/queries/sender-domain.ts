import { sql } from "drizzle-orm";
import { messages } from "../tables";

/**
 * The lower-case domain of a message's From address, in SQL: the part after its last '@', the
 * same rule as packages/core's senderDomain, so a quoted local part holding an '@'
 * ("a@b"@company.example) names the company's domain. NULL for an address without an '@'.
 */
export const fromDomain = sql`lower(btrim(substring(${messages.fromAddress} from '@([^@]*)$')))`;
