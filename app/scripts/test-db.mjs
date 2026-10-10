#!/usr/bin/env node
// Database test runner for the ThinkGita Circles Supabase backend.
// Run it before and after every migration:
//
//   DATABASE_URL=postgres://... npm run test:db
//   TEST_DATABASE_URL=postgres://... node scripts/test-db.mjs --only capacity
//
// What it runs, in file name order:
//   1. supabase/tests/sql/*.sql     behaviour tests. Each file is one or more DO blocks that create their own test
//                                   data, assert, and finish with `raise exception 'TESTS PASSED: ...'`, so the
//                                   database always rolls everything back. A file passes when it raises exactly that
//                                   exception (or simply completes); any other error is a failure.
//   2. supabase/tests/checks/*.sql  read-only checks. Each is a single SELECT that must return zero rows. Files whose
//                                   first comment line says "(warning)" are data checks: offending rows are printed
//                                   as warnings and do not fail the run unless --strict is given.
//
// Every file runs inside its own BEGIN ... ROLLBACK as extra safety (checks run READ ONLY), with a statement and
// lock timeout so a test can never sit on a lock that the live app needs.
// Warnings raised by the SQL (for example "KNOWN BUG: ...") are printed under the file that raised them.
//
// Options:
//   --only <pattern>   run only files whose name contains <pattern> (case-insensitive; repeatable)
//   --sql              run only the behaviour tests
//   --checks           run only the read-only checks
//   --strict           treat warning checks as failures
//   --verbose          print notices as well as warnings
//
// Writing new test files: keep each DO block self-contained and end it with the TESTS PASSED exception. Avoid the
// literal keywords for removing rows or objects, emptying tables, and UPDATE statements without a WHERE clause:
// the Supabase MCP execute_sql tool (used to validate files by hand) stalls on them. Build such statements by
// concatenation inside `execute`, as the existing files do.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const SQL_DIR = path.join(repoRoot, "supabase", "tests", "sql");
const CHECKS_DIR = path.join(repoRoot, "supabase", "tests", "checks");

// Project refs of real deployments. Add new ones here.
const PRODUCTION_REFS = ["rxvehsmunykipwevtpmb"];

const color = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, yellow: (s) => s, dim: (s) => s, bold: (s) => s };

function parseArgs(argv) {
  const opts = { only: [], sql: true, checks: true, strict: false, verbose: false };
  let sqlOnly = false;
  let checksOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") {
      const v = argv[++i];
      if (!v) throw new Error("--only needs a pattern");
      opts.only.push(v.toLowerCase());
    } else if (a.startsWith("--only=")) opts.only.push(a.slice(7).toLowerCase());
    else if (a === "--sql") sqlOnly = true;
    else if (a === "--checks") checksOnly = true;
    else if (a === "--strict") opts.strict = true;
    else if (a === "--verbose" || a === "-v") opts.verbose = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if (sqlOnly && !checksOnly) opts.checks = false;
  if (checksOnly && !sqlOnly) opts.sql = false;
  return opts;
}

function isLocalHost(host) {
  return ["localhost", "127.0.0.1", "::1", "host.docker.internal", "db", "supabase_db"].includes(host) || host.endsWith(".local");
}

// Seatbelt only. The tests never commit anything: behaviour tests end in an exception inside BEGIN ... ROLLBACK and
// checks are read-only SELECTs in a READ ONLY transaction. Still, pointing a test run at production should be a
// deliberate choice, so hosted Supabase URLs and known production refs need ALLOW_PROD_TESTS=1.
function looksLikeProduction(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { prod: false, host: "?" };
  }
  const host = u.hostname;
  const user = decodeURIComponent(u.username || "");
  const knownRef = PRODUCTION_REFS.find((ref) => url.includes(ref));
  const hosted = /(^|\.)supabase\.(co|com|net)$/.test(host) || host.includes("pooler.supabase");
  return { prod: Boolean(knownRef) || (hosted && !isLocalHost(host)) || (!isLocalHost(host) && /^postgres\./.test(user)), host, knownRef };
}

async function listSql(dir, only) {
  let names;
  try {
    names = await readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return names
    .filter((n) => n.endsWith(".sql"))
    .filter((n) => only.length === 0 || only.some((p) => n.toLowerCase().includes(p)))
    .sort()
    .map((n) => path.join(dir, n));
}

function formatPgError(e) {
  const parts = [e.message];
  if (e.code) parts.push(`(sqlstate ${e.code})`);
  if (e.where) parts.push(`\n      at ${e.where.split("\n")[0]}`);
  if (e.detail) parts.push(`\n      detail: ${e.detail}`);
  if (e.hint) parts.push(`\n      hint: ${e.hint}`);
  return parts.join(" ");
}

function printRows(rows, limit = 20) {
  const shown = rows.slice(0, limit).map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[k] = v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
    return o;
  });
  console.table(shown);
  if (rows.length > limit) console.log(color.dim(`      ... and ${rows.length - limit} more row(s)`));
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log("Usage: node scripts/test-db.mjs [--only <pattern>] [--sql | --checks] [--strict] [--verbose]");
    console.log("Needs TEST_DATABASE_URL or DATABASE_URL. Hosted or production URLs also need ALLOW_PROD_TESTS=1.");
    process.exit(0);
  }

  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set TEST_DATABASE_URL or DATABASE_URL to a Postgres connection string.");
    process.exit(2);
  }
  const prod = looksLikeProduction(url);
  if (prod.prod && process.env.ALLOW_PROD_TESTS !== "1") {
    console.error(
      `Refusing to run: ${prod.host} looks like a hosted or production database${prod.knownRef ? ` (project ${prod.knownRef})` : ""}.\n` +
        "The tests always roll back, so this is only a seatbelt. Set ALLOW_PROD_TESTS=1 to run anyway.",
    );
    process.exit(2);
  }

  const sqlFiles = opts.sql ? await listSql(SQL_DIR, opts.only) : [];
  const checkFiles = opts.checks ? await listSql(CHECKS_DIR, opts.only) : [];
  if (sqlFiles.length + checkFiles.length === 0) {
    console.error("No test files matched.");
    process.exit(2);
  }

  const host = prod.host;
  const ssl = isLocalHost(host) || /sslmode=disable/.test(url) ? false : /sslmode=/.test(url) ? undefined : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl, application_name: "thinkgita-test-db" });
  let notices = [];
  client.on("notice", (m) => notices.push(m));
  await client.connect();

  const results = [];
  const t0 = Date.now();
  console.log(color.bold(`ThinkGita DB tests against ${host}`) + color.dim(` (${sqlFiles.length} test file(s), ${checkFiles.length} check(s))`));

  const flushNotices = () => {
    for (const m of notices) {
      const sev = m.severity || "NOTICE";
      if (sev === "WARNING") console.log(color.yellow(`      ${sev}: ${m.message}`));
      else if (opts.verbose) console.log(color.dim(`      ${sev}: ${m.message}`));
    }
    const warnings = notices.filter((m) => m.severity === "WARNING").length;
    notices = [];
    return warnings;
  };

  if (sqlFiles.length) console.log(color.bold("\nBehaviour tests (supabase/tests/sql)"));
  for (const file of sqlFiles) {
    const name = path.basename(file);
    const text = await readFile(file, "utf8");
    const started = Date.now();
    let status = "pass";
    let detail = "completed";
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '120s'; SET LOCAL lock_timeout = '10s'");
      await client.query(text);
    } catch (e) {
      if (typeof e.message === "string" && e.message.startsWith("TESTS PASSED")) {
        detail = e.message;
      } else {
        status = "fail";
        detail = formatPgError(e);
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }
    const ms = Date.now() - started;
    const mark = status === "pass" ? color.green("PASS") : color.red("FAIL");
    console.log(`  ${mark} ${name} ${color.dim(`${ms} ms`)}  ${status === "pass" ? color.dim(detail) : detail}`);
    const warnings = flushNotices();
    results.push({ kind: "sql", name, status, warnings });
  }

  if (checkFiles.length) console.log(color.bold("\nRead-only checks (supabase/tests/checks)"));
  for (const file of checkFiles) {
    const name = path.basename(file);
    const text = await readFile(file, "utf8");
    const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "";
    const isWarning = /\(warning\)/i.test(firstLine) && !opts.strict;
    const started = Date.now();
    let status = "pass";
    let rows = [];
    let error = null;
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '60s'; SET LOCAL lock_timeout = '10s'");
      const res = await client.query(text);
      const last = Array.isArray(res) ? res[res.length - 1] : res;
      rows = last?.rows ?? [];
      if (rows.length > 0) status = isWarning ? "warn" : "fail";
    } catch (e) {
      status = "fail";
      error = formatPgError(e);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }
    const ms = Date.now() - started;
    const mark = status === "pass" ? color.green("PASS") : status === "warn" ? color.yellow("WARN") : color.red("FAIL");
    const what = error ?? (rows.length ? `${rows.length} offending row(s)` : "0 rows");
    console.log(`  ${mark} ${name} ${color.dim(`${ms} ms`)}  ${status === "pass" ? color.dim(what) : what}`);
    if (rows.length) printRows(rows);
    const warnings = flushNotices();
    results.push({ kind: "check", name, status, warnings });
  }

  await client.end();

  const count = (s) => results.filter((r) => r.status === s).length;
  const sqlWarnings = results.reduce((a, r) => a + r.warnings, 0);
  const failed = results.filter((r) => r.status === "fail");
  console.log(
    color.bold("\nSummary: ") +
      `${count("pass")} passed, ${failed.length} failed, ${count("warn")} warning check(s)` +
      (sqlWarnings ? `, ${sqlWarnings} SQL warning(s)` : "") +
      color.dim(` in ${((Date.now() - t0) / 1000).toFixed(1)} s`),
  );
  if (failed.length) {
    console.log(color.red(`Failed: ${failed.map((r) => r.name).join(", ")}`));
    process.exit(1);
  }
  console.log(color.green("All database tests passed. Nothing was committed."));
}

main().catch((e) => {
  console.error(color.red(`Runner error: ${e.stack || e.message}`));
  process.exit(1);
});
