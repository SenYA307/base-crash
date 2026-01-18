// Load environment variables in development
// Next.js should auto-load .env.local, but this ensures it works for API routes

import path from "path";
import fs from "fs";

if (process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require("dotenv");

  const cwd = process.cwd();
  const envLocalPath = path.resolve(cwd, ".env.local");
  const envPath = path.resolve(cwd, ".env");

  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  } else if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

export {};
