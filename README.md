# SF19 Coach — Stockfish 19 chess trainer

Παίξε με το Stockfish 19, πάρε σχόλια σε κάθε κίνηση, ανάλυσε τις παρτίδες σου και εξασκήσου στα λάθη σου.
Όλα τρέχουν μέσα στον browser (WebAssembly).

## Ανέβασμα στο Render

Αυτά τα 18 αρχεία είναι **όλη** η ιστοσελίδα, έτοιμη (χωρίς υποφακέλους).
Κατά το build, το Render απλώς κατεβάζει το Stockfish 19 (WASM, με έλεγχο checksum) και φτιάχνει τον φάκελο `dist/`.

1. GitHub → το repository → **Add file → Upload files**.
2. Επίλεξε **τα αρχεία** (Ctrl+A / Cmd+A) — όχι τον φάκελο — και σύρε τα στη σελίδα, ώστε να μπουν
   στη **ρίζα** του repository (δίπλα στο `README.md`, όχι μέσα σε φάκελο) → **Commit changes**.
3. Στο Render: **New → Blueprint** → διάλεξε το repository → **Apply**
   (ή **New → Static Site** με Build Command `npm ci && npm run build` και Publish Directory `dist`).
   Αν η υπηρεσία υπάρχει ήδη, το Render κάνει μόνο του νέο deploy με κάθε commit.

## Αρχεία

| Αρχείο | Τι είναι |
|---|---|
| `index.html`, `app.js`, `app.css` | η εφαρμογή |
| `sw.js`, `manifest.webmanifest` | offline λειτουργία / εγκατάσταση ως εφαρμογή |
| `openings.json` | ονόματα ανοιγμάτων (lichess, CC0) |
| `favicon.svg`, `icon-*.png` | εικονίδια |
| `render.yaml` | ρυθμίσεις του Render |
| `package.json`, `package-lock.json`, `build-site.mjs` | το build: κατεβάζει το Stockfish 19 και φτιάχνει το `dist/` |
| `source.zip` | ο πλήρης πηγαίος κώδικας (build, tests) |
| `LICENSE`, `LICENSE-lucide.txt` | άδειες |

## Άδειες

GPL-3.0-or-later. Stockfish 19 (GPLv3) μέσω stockfish.js (GPLv3), chessground & chessops (lichess, GPLv3),
lichess chess-openings (CC0), Preact (MIT), Lucide icons (ISC). Ο πηγαίος κώδικας βρίσκεται στο `source.zip`.
