AI Prediction Market v2 — secure local-event prototype

1. Copy .env.example to .env and set ADMIN_PASSWORD to a strong private password.
2. npm install
3. npm --prefix client install
4. npm run dev
5. Open http://localhost:5173

Admin creates teams in the data/teams.json file for this prototype. Team PINs are stored as salted scrypt hashes; the server never sends PINs to clients. Sessions use random server-side tokens. Students never receive answer choices; they only see the challenge and AI prediction. The actual answer remains server-side until reveal.

This is designed for a controlled college LAN/local event. For public internet deployment, add HTTPS, a reverse proxy, persistent session storage, CSRF/origin controls, and a production database.
