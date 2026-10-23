// Builds the demo (made-up data, nothing real) and puts it on the AI for Companies site as a client demo at
// /projects/thinkgita/circles, the same way as the other demos there (a static folder in public/projects).
// Run from app/: npm run publish:showcase. Then commit and push in the aiforcompanies repo (git add -A).
// SHOWCASE_DIR overrides where the site repo is (default: ~/projects/aiforcompanies next to datapulse-org).
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(process.env.SHOWCASE_DIR ?? resolve(app, "../../../aiforcompanies"));
const SLUG = "thinkgita/circles";
const target = resolve(site, "public/projects", SLUG);
if (!existsSync(resolve(site, "public/projects"))) {
  console.error(`Can't find the site at ${site} (no public/projects). Set SHOWCASE_DIR to the aiforcompanies repo.`);
  process.exit(1);
}
execSync("npx vite build --mode demo --outDir dist-showcase --emptyOutDir", {
  cwd: app, stdio: "inherit", env: { ...process.env, DEMO_BASE: `/projects/${SLUG}/` },
});
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(resolve(app, "dist-showcase"), target, { recursive: true });
console.log(`\nPublished to ${target}\nNext: in ${site}, git add -A && git commit -m "ThinkGita Circles demo" && git push`);
