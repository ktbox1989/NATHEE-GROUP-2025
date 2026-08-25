import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "../db/schema.ts";

/**
 * The database handle, named as a type so the modules that read CMS content can
 * be given one rather than reaching for a global.
 *
 * `getDb()` resolves the Cloudflare D1 binding, which means importing it makes
 * a module unloadable outside the worker runtime — including in a test. Taking
 * the handle as an argument instead means the real query-building code can be
 * run against a real SQLite database in a test, so what is proven is the query
 * itself and not a second copy of it written by hand in the assertion.
 */
export type CmsDatabase = DrizzleD1Database<typeof schema>;
