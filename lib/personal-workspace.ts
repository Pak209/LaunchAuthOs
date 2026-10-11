import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { isSafeUid } from "./identity";

export class WorkspaceAccessError extends Error {
  constructor() { super("Workspace access denied."); }
}

/** Server-only, verified UID. Query in the transaction fences concurrent bootstrap. */
export async function inspectPersonalWorkspace(db: Firestore, tx: Transaction, uid: string, allowCreate = false) {
  if (!isSafeUid(uid)) throw new WorkspaceAccessError();
  const workspace = db.doc(`workspaces/personal_${uid}`);
  const [parent, members] = await Promise.all([tx.get(workspace), tx.get(workspace.collection("members").limit(2))]);
  if (!parent.exists) {
    if (!allowCreate || members.size !== 0) throw new WorkspaceAccessError();
    return { workspace, missing: true };
  }
  if (parent.data()?.createdBy !== uid || members.size !== 1 || members.docs[0].id !== uid || members.docs[0].data().userId !== uid || members.docs[0].data().role !== "owner") throw new WorkspaceAccessError();
  return { workspace, missing: false };
}
export async function bootstrapPersonalWorkspace(db: Firestore, uid: string) {
  await db.runTransaction(async tx => {
    const state = await inspectPersonalWorkspace(db, tx, uid, true);
    if (!state.missing) return;
    tx.create(state.workspace, { name: "My Launch Workspace", createdBy: uid, billingStatus: "not_configured", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.create(state.workspace.collection("members").doc(uid), { userId: uid, role: "owner", createdAt: FieldValue.serverTimestamp() });
  });
  return `personal_${uid}`;
}
