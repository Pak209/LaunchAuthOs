import { FieldValue, type Firestore } from "firebase-admin/firestore";

// Storage-only test double: the tests execute the real fulfillment worker.
// Transactions serialize, stage writes atomically, and reject nested undefined,
// but this is not a substitute for Firestore emulator/deployment integration tests.
type Data = Record<string, any>;
type Write = { kind: "create" | "update" | "set"; ref: Ref; data: Data; merge?: boolean };

function normalize(value: any): any {
  if (value === undefined) throw new Error("Firestore does not accept undefined");
  if (value instanceof FieldValue) {
    if (value.isEqual(FieldValue.serverTimestamp())) return new Date().toISOString();
    throw new Error("Unsupported nested FieldValue");
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}

class Snapshot {
  readonly id: string;
  readonly exists: boolean;
  private readonly value: Data | undefined;
  constructor(readonly ref: Ref) {
    this.id = ref.id;
    this.value = ref.db.rows.get(ref.path);
    this.exists = this.value !== undefined;
  }
  data() { return this.value ? structuredClone(this.value) : undefined; }
}

class Ref {
  constructor(readonly db: MemoryFirestore, readonly path: string) {}
  get id() { return this.path.split("/").at(-1)!; }
  get parent(): Collection { return new Collection(this.db, this.path.split("/").slice(0, -1).join("/")); }
  collection(name: string) { return new Collection(this.db, `${this.path}/${name}`); }
  async get() { return new Snapshot(this); }
}

class Query {
  constructor(readonly db: MemoryFirestore, private readonly matches: (path: string, value: Data) => boolean, private readonly cap = Infinity) {}
  where(field: string, operator: string, value: unknown) {
    if (operator !== "==") throw new Error("Unsupported test query");
    return new Query(this.db, (path, data) => this.matches(path, data) && data[field] === value, this.cap);
  }
  limit(cap: number) { return new Query(this.db, this.matches, cap); }
  orderBy(_field: string, _order: string) { return this; }
  async get() {
    const docs = [...this.db.rows.entries()].filter(([path, value]) => this.matches(path, value)).slice(0, this.cap).map(([path]) => new Snapshot(this.db.doc(path)));
    return { docs, size: docs.length };
  }
}

class Collection extends Query {
  constructor(db: MemoryFirestore, readonly path: string) {
    super(db, (candidate) => candidate.split("/").slice(0, -1).join("/") === path);
  }
  get parent(): Ref | null {
    const path = this.path.split("/").slice(0, -1).join("/");
    return path ? new Ref(this.db, path) : null;
  }
  doc(id = `auto_${++this.db.sequence}`) { return new Ref(this.db, `${this.path}/${id}`); }
}

export class MemoryFirestore {
  rows = new Map<string, Data>();
  sequence = 0;
  beforeCommit?: (writes: Write[]) => void;
  afterCommit?: (writes: Write[]) => void;
  private tail: Promise<void> = Promise.resolve();
  asFirestore() { return this as unknown as Firestore; }
  doc(path: string) { return new Ref(this, path); }
  seed(path: string, data: Data) { this.rows.set(path, normalize(data)); }
  read(path: string): Data { return structuredClone(this.rows.get(path)!); }
  collectionGroup(name: string) { return new Query(this, (path) => path.split("/").at(-2) === name); }
  async runTransaction<T>(fn: (tx: {
    get: (ref: Ref) => Promise<Snapshot>;
    create: (ref: Ref, data: Data) => void;
    update: (ref: Ref, data: Data) => void;
    set: (ref: Ref, data: Data, options?: { merge: boolean }) => void;
  }) => Promise<T>): Promise<T> {
    const prior = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => { unlock = resolve; });
    await prior;
    const writes: Write[] = [];
    try {
      const result = await fn({
        get: async (ref) => {
          if (writes.length) throw new Error("Firestore transactions must read before writing");
          return new Snapshot(ref);
        },
        create: (ref, data) => { writes.push({ kind: "create", ref, data }); },
        update: (ref, data) => { writes.push({ kind: "update", ref, data }); },
        set: (ref, data, options) => { writes.push({ kind: "set", ref, data, merge: options?.merge }); },
      });
      this.beforeCommit?.(writes);
      const next = new Map(this.rows);
      for (const write of writes) {
        if (write.kind === "create" && next.has(write.ref.path)) throw new Error("Document already exists");
        if (write.kind === "update" && !next.has(write.ref.path)) throw new Error("Document does not exist");
        const data = write.kind === "update" || write.merge ? { ...next.get(write.ref.path) } : {};
        for (const [key, value] of Object.entries(write.data)) {
          if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete data[key];
          else data[key] = normalize(value);
        }
        next.set(write.ref.path, data);
      }
      this.rows = next;
      this.afterCommit?.(writes);
      return result;
    } finally { unlock(); }
  }
}
