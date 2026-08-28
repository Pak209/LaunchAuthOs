# Launch Auth

Launch Auth is the working codename for an AI Launch & Authority Engine.

This repository currently contains the product and research foundation. The project is intentionally evidence-first: verified, inferred, assumed, and unknown claims are kept distinct while supplier, directory, and unit-economic research is completed.

Start with:

- [VISION.md](VISION.md)
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md)
- [MVP.md](MVP.md)

## Production foundation setup

The app keeps working in explicit local mode when Supabase is not configured. To enable authenticated, persistent workspaces:

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and add the project URL and publishable key.
3. Apply `supabase/migrations/202608280001_initial_workspace_auth.sql` through the Supabase SQL editor or CLI.
4. Add `http://127.0.0.1:4173/auth/callback` as an allowed Auth redirect URL during local development.

Never add a service-role or secret key to browser-visible environment variables. All tenant data is protected with Postgres row-level security.
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [ROADMAP.md](ROADMAP.md)
- [research/SUPPLIER_MATRIX.md](research/SUPPLIER_MATRIX.md)
