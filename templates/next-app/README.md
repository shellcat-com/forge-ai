# Generated Next.js application

Use Node.js 24 and PostgreSQL. Set `APP_DATABASE_URL` privately to this application's PostgreSQL database, then run `npm ci`, `npm run build` and `npm start`. Use a restricted database role and separate database for each application. `lib/db.ts` supplies a `pg.Pool`; use parameterized SQL. `initialize()` creates the example items table. Run application tests with `node --experimental-strip-types --test lib/generated/tests/*.ts`; Forge runs them inside the sandbox after the build. Tests must preserve application data.

Forge's local sandbox injects only this application's database URL. Exported source never includes Forge's API keys, model connections or control database credentials. Authentication, payment processing and public deployment must be implemented and verified for the application's requirements.
