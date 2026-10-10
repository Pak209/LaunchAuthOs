import { vi } from "vitest";
/** Synthetic contract for mocked supplier tests. Never used in application configuration. */
export function configureSyntheticLiveContract() {
  vi.stubEnv("PACKAGE_CONTRACTS_APPROVED", "true");
  vi.stubEnv("PACKAGE_CONTRACTS_JSON", JSON.stringify([{
    schemaVersion: 1, revision: "synthetic-test-v1", packageId: "launch", environment: "live",
    providerSubmission: true, directoryIds: ["betalist", "uneed", "sourceforge"], priceId: "price_test_launch",
  }]));
}
