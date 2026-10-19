# Ahaji

Ahaji is an Arabic-first escape-room operations app with an Admin workspace, a Game Master console, and a paired Cast display. The frontend is static HTML/CSS/JavaScript; Supabase is the protected data and session backend. The three original rooms and 129 hints are held in the database.

## Local review

From this directory, run `python -m http.server 8765 --bind 127.0.0.1 --protocol HTTP/1.1`, then open [Admin login](http://127.0.0.1:8765/login.html). Rooms are the default Admin page. A Game Master can select an authorized room at [room selection](http://127.0.0.1:8765/index.html). Cast opens from its GM session and requires the generated session link; it does not require a staff account. The Cast screen needs one click to enable audio.

For separate devices, serve on `0.0.0.0` and open the GM page through the computer's LAN address so the generated Cast link uses that address. See [operations and recovery](docs/AHAJI_OPERATIONS.md) for the exact procedure and security limits.

## Architecture

- `js/app.js`: normalized database room configuration and shared display utilities.
- `js/data/`: Supabase room and Admin data boundaries.
- `js/session-adapter.js`: server-backed session commands, GM Realtime subscription, and token-checked Cast synchronization. The local adapter exists only for the legacy browser fixture.
- `js/gm.js` and `js/cast.js`: timer, controls, media presentation, and display behavior.
- `js/loader.mjs`, `css/loader.css`, `images/loader/`: the approved branded loader and image skeletons. See [loader notes](docs/AHAJI_LOADER.md).
- `supabase/migrations/`: versioned schema, RLS, grants, audit, and trusted session functions.
- `supabase/functions/staff-invite/`: JWT-verified Admin invitation endpoint. Privileged keys remain in Supabase's function environment.

Do not put service-role credentials, Auth sessions, or backup files in Git. The publishable key in the browser is constrained by Supabase Auth, RLS, and server functions.

## Checks

Run `npm ci`, `npm test`, and `python -m unittest discover -s tests -v`. Browser tests use Playwright. Versioned SQL regression tests are in `supabase/tests/`; apply them inside a rolled-back transaction on the named project or a disposable PostgreSQL 17 restore. The [delivery tracker](docs/AHAJI_DELIVERY_STATUS.md) records actual validation and outstanding acceptance gaps.

## Staff email limit

Supabase's built-in sender can restrict recipients and is unsuitable for guaranteed production invitations. The invitation endpoint rejects delivery failures; reliable onboarding of arbitrary staff needs a configured SMTP service. Ahaji does not bypass email ownership verification. See [Supabase's SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp) and the delivery tracker before treating staff onboarding as accepted.
