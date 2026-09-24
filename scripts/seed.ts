// Creates the database file and the reserved `presenter` account. Idempotent — the app does this on
// boot too, so this is only needed to prepare a database ahead of time.
import { db } from "../lib/db";

db();
console.log(`Database ready at ${process.env.DATABASE_PATH || "./data/warung-kita.db"}`);
