# Launch Auth

Launch Auth is the working codename for an AI Launch & Authority Engine.

This repository currently contains the product and research foundation. The project is intentionally evidence-first: verified, inferred, assumed, and unknown claims are kept distinct while supplier, directory, and unit-economic research is completed.

Start with:

- [VISION.md](VISION.md)
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md)
- [MVP.md](MVP.md)

## Production foundation setup

The app keeps working in explicit local mode when Firebase is not configured. To enable authenticated, persistent workspaces:

1. Create the Firebase project and register a Web app.
2. Copy `.env.example` to `.env.local` and add the public Firebase Web configuration.
3. Enable Email/Password in Firebase Authentication.
4. Create the default Cloud Firestore database in production mode.
5. Deploy `firestore.rules` and `firestore.indexes.json` with the Firebase CLI.

Firebase Web configuration is public application metadata, not an administrator credential. Never add service-account JSON or private keys to browser-visible environment variables. Workspace data is protected with Firestore Security Rules and authenticated user context.
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [ROADMAP.md](ROADMAP.md)
- [research/SUPPLIER_MATRIX.md](research/SUPPLIER_MATRIX.md)
