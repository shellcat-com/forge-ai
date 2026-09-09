# Local setup

Use Node 24.21.0 LTS and npm. Run `npm ci`, `npm run verify`, then `npm start`. Forge listens on 127.0.0.1:3000. The foundation does not require a database or provider key.

`docker compose up --build` is the intended standalone Next.js packaging path, published only to loopback. It has not yet been container-tested. The local engine recovered after a Docker Desktop restart. This is not a generated-application sandbox.

PostgreSQL, worker execution, and sandbox network controls are subsequent milestones. Do not expose this single-user development server publicly. No hosted account provisioning, cloud services, AWS, or Supabase are required.
