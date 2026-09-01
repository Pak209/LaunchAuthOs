import { getAuthenticatedFirebaseContext } from "./firebase/server";

export async function requireInternalAdmin() {
  const context = await getAuthenticatedFirebaseContext();
  const allowed = new Set((process.env.ADMIN_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.size || !allowed.has(context.user.uid)) throw new Error("Not found.");
  return context;
}
