import { afterEach, describe, expect, it, vi } from "vitest";
import { assertCurrentPackageContract, assertFrozenPackageContract, resolvePackageContract } from "../lib/package-contract";
const live = { sandbox: false, nonBillable: false };
const sandbox = { sandbox: true, nonBillable: true };
const input = { schemaVersion: 1, revision: "review-1", packageId: "launch", environment: "live", providerSubmission: true, directoryIds: ["uneed"], priceId: "price_test" };
afterEach(() => vi.unstubAllEnvs());
function configure(value: unknown = [input]) { vi.stubEnv("PACKAGE_CONTRACTS_APPROVED", "true"); vi.stubEnv("PACKAGE_CONTRACTS_JSON", JSON.stringify(value)); }
describe("versioned package contract", () => {
  it("allows only explicit non-billable sandbox demonstration defaults", () => {
    const value = resolvePackageContract("launch", sandbox);
    expect(value.environment).toBe("sandbox");
    expect(value.directoryIds).toHaveLength(3);
    expect(() => resolvePackageContract("launch", { ...sandbox, nonBillable: false })).toThrow();
  });
  it("fails closed without approved live entitlements", () => {
    vi.stubEnv("PACKAGE_CONTRACTS_JSON", "[]");
    expect(() => resolvePackageContract("launch", live)).toThrow(/not configured/);
    configure(); vi.stubEnv("PACKAGE_CONTRACTS_APPROVED", "false");
    expect(() => resolvePackageContract("launch", live)).toThrow(/not configured/);
  });
  it("resolves only defined package distinctions", () => {
    configure(); expect(resolvePackageContract("launch", live).directoryIds).toEqual(["uneed"]);
    expect(() => resolvePackageContract("authority", live)).toThrow();
  });
  it.each([
    [{ ...input, directoryIds: ["unknown"] }], [{ ...input, directoryIds: ["uneed", "uneed"] }],
    [input, input], [{ ...input, priceId: undefined }], [{ ...input, guaranteedPlacements: 100 }],
  ])("rejects ambiguous or unsupported entitlement config %j", (...entries) => {
    configure(entries); expect(() => resolvePackageContract("launch", live)).toThrow();
  });
  it("freezes canonically and detects tampering and legacy orders", () => {
    configure(); const value = resolvePackageContract("launch", live);
    expect(() => assertFrozenPackageContract(value, "launch")).not.toThrow();
    expect(() => assertFrozenPackageContract(value, "authority")).toThrow();
    expect(() => assertFrozenPackageContract({ ...value, directoryIds: [] }, "launch")).toThrow();
    expect(() => assertFrozenPackageContract(undefined, "launch")).toThrow();
  });
  it("blocks new checkout on drift while preserving frozen paid entitlement meaning", () => {
    configure(); const value = resolvePackageContract("launch", live);
    configure([{ ...input, revision: "review-2", directoryIds: [] }]);
    expect(() => assertCurrentPackageContract(value, live)).toThrow(/changed/);
    expect(() => assertFrozenPackageContract(value, "launch")).not.toThrow();
  });
  it("cannot use sandbox contracts for live checkout", () => {
    configure(); expect(() => assertCurrentPackageContract(resolvePackageContract("launch", sandbox), live)).toThrow();
  });
});
