import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

describe("first-run workspace", () => {
  it("shows a setup guide instead of fabricated authority data", () => {
    expect(page).toContain("Build your first source-backed launch.");
    expect(page).toContain("Your workspace starts empty");
    expect(page).not.toContain("demoMetrics");
    expect(page).not.toContain("DEMO DATA");
    expect(page).not.toContain("DEMO-2048");
  });

  it("starts with an empty company URL", () => {
    expect(page).toContain('const [url, setUrl] = useState("")');
    expect(page).toContain('placeholder="https://yourcompany.com"');
  });

  it("does not globally hide resume and version-history buttons on mobile", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).not.toContain(".topbar p, .mode-button, .profile-avatar");
    expect(css).toContain(".topbar .mode-button.intelligence, .topbar .mode-button.authority");
    expect(css).toContain(".topbar-actions { flex-wrap: wrap; }");
  });
});
