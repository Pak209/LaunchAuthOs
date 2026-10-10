import { createHash } from "node:crypto";
import { z } from "zod";

export const packageIds = ["launch", "authority", "authority_plus"] as const;
const contractSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  packageId: z.enum(packageIds),
  environment: z.enum(["sandbox", "live"]),
  providerSubmission: z.literal(true),
  directoryIds: z.array(z.enum(["betalist", "uneed", "sourceforge"])).max(3)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate directory entitlement"),
  priceId: z.string().regex(/^price_[a-zA-Z0-9_]+$/).optional(),
}).strict();
export type PackageContract = z.infer<typeof contractSchema> & { digest: string };
function canonical(value: z.infer<typeof contractSchema>) {
  return JSON.stringify({ schemaVersion: value.schemaVersion, revision: value.revision, packageId: value.packageId,
    environment: value.environment, providerSubmission: value.providerSubmission,
    directoryIds: [...value.directoryIds].sort(), ...(value.priceId ? { priceId: value.priceId } : {}) });
}
function freeze(value: z.infer<typeof contractSchema>): PackageContract {
  return { ...value, directoryIds: [...value.directoryIds].sort(), digest: createHash("sha256").update(canonical(value)).digest("hex") };
}
export function resolvePackageContract(packageId: typeof packageIds[number], mode: { sandbox: boolean; nonBillable: boolean }): PackageContract {
  if (mode.sandbox && mode.nonBillable) {
    // Test workflow only: these are the existing demonstration tasks, not commercial entitlements.
    return freeze({ schemaVersion: 1, revision: "sandbox-demo-v1", packageId, environment: "sandbox", providerSubmission: true, directoryIds: ["betalist", "uneed", "sourceforge"] });
  }
  if (mode.sandbox || mode.nonBillable) throw new Error("Package contract environment is inconsistent.");
  try {
    const contracts = z.array(contractSchema).max(3).parse(JSON.parse(process.env.PACKAGE_CONTRACTS_JSON || "[]"));
    if (new Set(contracts.map((item) => item.packageId)).size !== contracts.length) throw new Error("duplicate");
    const contract = contracts.find((item) => item.packageId === packageId);
    if (!contract || contract.environment !== "live" || !contract.priceId || process.env.PACKAGE_CONTRACTS_APPROVED !== "true") throw new Error("unapproved");
    return freeze(contract);
  } catch {
    throw new Error("Approved package entitlements are not configured. Checkout is disabled until the package contract is reviewed.");
  }
}
export function assertFrozenPackageContract(value: unknown, packageId: unknown): asserts value is PackageContract {
  try {
    const parsed = contractSchema.extend({ digest: z.string().regex(/^[a-f0-9]{64}$/) }).parse(value);
    const { digest, ...contract } = parsed;
    if (contract.packageId !== packageId || freeze(contract).digest !== digest || (contract.environment === "live" && !contract.priceId)) throw new Error("mismatch");
  } catch { throw new Error("Frozen package contract is missing or invalid. Reconcile this order before fulfillment."); }
}
export function assertCurrentPackageContract(value: unknown, mode: { sandbox: boolean; nonBillable: boolean }): asserts value is PackageContract {
  const packageId = (value as PackageContract | undefined)?.packageId;
  assertFrozenPackageContract(value, packageId);
  if (resolvePackageContract(value.packageId, mode).digest !== value.digest) throw new Error("Package contract changed after preparation. Checkout is disabled pending order reconciliation.");
}
