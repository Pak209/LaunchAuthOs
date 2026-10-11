/** Firebase UID subset safe as an unencoded Firestore document segment.
 * Keep the verified identity verbatim: never trim, normalize, or derive it from email.
 */
export function isSafeUid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && !/[/\p{Cc}]/u.test(value) && value !== "." && value !== ".." && !/^__.*__$/.test(value);
}
export function isSafeWorkspaceId(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("personal_")
    ? isSafeUid(value.slice("personal_".length)) : /^[A-Za-z0-9_-]{1,160}$/.test(value));
}
