import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

// A separate config/cwd and an allowlisted child environment prevent .firebaserc,
// .env files, cached logins and application credentials from selecting live data.
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = process.env.ORDER_LOCK_FIREBASE_CLI ?? join(root, "node_modules/firebase-tools/lib/bin/firebase.js");
if (!isAbsolute(cli) || !existsSync(cli)) {
  throw new Error("Set ORDER_LOCK_FIREBASE_CLI to an absolute firebase-tools/lib/bin/firebase.js path. A temporary npm --prefix installation is sufficient; no global install or Firebase login is needed.");
}
const javaBin = process.env.ORDER_LOCK_JAVA_BIN;
if (javaBin && (!isAbsolute(javaBin) || !existsSync(join(javaBin, "java")))) {
  throw new Error("ORDER_LOCK_JAVA_BIN must be an absolute directory containing a Java 21+ executable.");
}
for (const port of [18891, 18892, 18893, 18894]) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Local rules-test port ${port} is occupied. No existing service was changed.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}
const runDir = await mkdtemp(join(tmpdir(), "launch-order-lock-emulator-"));
const configPath = join(runDir, "firebase.json");
await writeFile(configPath, JSON.stringify({
  firestore: { rules: join(root, "firestore.rules") },
  emulators: {
    firestore: { host: "127.0.0.1", port: 18891, websocketPort: 18892 },
    hub: { host: "127.0.0.1", port: 18893 },
    logging: { host: "127.0.0.1", port: 18894 },
    ui: { enabled: false },
    singleProjectMode: true,
  },
}, null, 2));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const command = [process.execPath, join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", join(root, "scripts/vitest.firestore-order-lock.config.ts")].map(quote).join(" ");
const env = {
  PATH: javaBin ? `${javaBin}${delimiter}${process.env.PATH ?? ""}` : process.env.PATH ?? "",
  TMPDIR: runDir,
  XDG_CONFIG_HOME: join(runDir, "config"),
  XDG_CACHE_HOME: join(runDir, "cache"),
  CLOUDSDK_CONFIG: join(runDir, "gcloud-config"),
  METADATA_SERVER_DETECTION: "none",
  FIREBASE_EMULATORS_PATH: process.env.ORDER_LOCK_EMULATOR_CACHE ?? join(runDir, "emulator-cache"),
  FIREBASE_CLI_DISABLE_USAGE_REPORTING: "true",
  FIREBASE_SKIP_UPDATE_CHECK: "true",
  CI: "true",
  GCLOUD_PROJECT: "demo-launch-order-lock",
  RUN_FIRESTORE_ORDER_LOCK: "1",
};
console.log(`Isolated Firestore rules test: demo-launch-order-lock at 127.0.0.1:18891. Logs: ${runDir}`);
const child = spawn(process.execPath, [cli, "emulators:exec", "--only", "firestore", "--project", "demo-launch-order-lock", "--config", configPath, "--non-interactive", command], { cwd: runDir, env, stdio: "inherit" });
// Only forward termination to the emulator process started by this script.
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
