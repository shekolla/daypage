// User-management CLI. Run inside the container:
//   docker compose exec -it tracker node scripts/users.js create alice
//   docker compose exec    tracker node scripts/users.js list
//   docker compose exec    tracker node scripts/users.js delete alice
//   docker compose exec -it tracker node scripts/users.js passwd  alice
//
// Passwords are read from stdin (TTY: hidden) or the PASSWORD env var.
// Never type passwords as positional argv — they show up in shell history.

import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import readline from "node:readline";
import process from "node:process";

const DB_PATH = process.env.DB_PATH || "/data/tracker.db";
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

function usage() {
  console.log(
    `Usage:
  users.js create <username>   create a new user
  users.js list                list all users
  users.js delete <username>   delete a user (and their state)
  users.js passwd <username>   change a user's password

Password input: PASSWORD env var, or piped on stdin, or interactive prompt (hidden).`
  );
  process.exit(1);
}

async function readPasswordFromStdin(prompt) {
  if (process.env.PASSWORD) return process.env.PASSWORD;
  if (!process.stdin.isTTY) {
    return await new Promise((resolve) => {
      let data = "";
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", () => resolve(data.trim()));
    });
  }
  // interactive — hide echo
  process.stdout.write(prompt);
  return await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    /** @type {any} */
    const stdinAny = process.stdin;
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (str, ...rest) => {
      if (typeof str === "string" && str.length > 0 && stdinAny._readlineActive) return true;
      return origWrite(str, ...rest);
    };
    stdinAny._readlineActive = true;
    rl.question("", (answer) => {
      stdinAny._readlineActive = false;
      process.stdout.write = origWrite;
      process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

const cmd = process.argv[2];
const arg = process.argv[3];

async function main() {
  switch (cmd) {
    case "list": {
      const rows = db
        .prepare("SELECT id, username, created_at FROM users ORDER BY id")
        .all();
      if (rows.length === 0) {
        console.log("(no users)");
      } else {
        console.log("id\tcreated_at\t\t\tusername");
        for (const r of rows) {
          console.log(`${r.id}\t${new Date(r.created_at).toISOString()}\t${r.username}`);
        }
      }
      break;
    }
    case "create": {
      if (!arg) usage();
      const exists = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(arg);
      if (exists) {
        console.error(`user "${arg}" already exists`);
        process.exit(2);
      }
      const password = await readPasswordFromStdin(`Password for ${arg}: `);
      if (!password || password.length < 8) {
        console.error("password must be at least 8 characters");
        process.exit(2);
      }
      const hash = bcrypt.hashSync(password, 12);
      db.prepare(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
      ).run(arg, hash, Date.now());
      console.log(`created user: ${arg}`);
      break;
    }
    case "delete": {
      if (!arg) usage();
      const user = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(arg);
      if (!user) {
        console.error(`user "${arg}" not found`);
        process.exit(2);
      }
      db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
      console.log(`deleted user: ${arg} (and their state)`);
      break;
    }
    case "passwd": {
      if (!arg) usage();
      const user = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(arg);
      if (!user) {
        console.error(`user "${arg}" not found`);
        process.exit(2);
      }
      const password = await readPasswordFromStdin(`New password for ${arg}: `);
      if (!password || password.length < 8) {
        console.error("password must be at least 8 characters");
        process.exit(2);
      }
      const hash = bcrypt.hashSync(password, 12);
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
      console.log(`password updated for: ${arg}`);
      break;
    }
    default:
      usage();
  }
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
