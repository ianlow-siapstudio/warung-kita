// Creates the database, the `presenter` participant and the cached demo runs. Idempotent —
// the app also does this on boot, so this is only needed to prepare a DB file ahead of time.
import { db } from "../lib/db";

const d = db();
const cached = d.prepare("SELECT provider, label FROM cached_demo ORDER BY provider, id").all();
console.log(`Database ready at ${process.env.DATABASE_PATH || "./data/warung-kita.db"}`);
console.log("Cached demo runs:", cached);
