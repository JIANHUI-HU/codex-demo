"use strict";

const connectionString = process.env.DATABASE_URL;
const persistent = Boolean(connectionString);
let pool = null;
let nextMemoryUserId = 1;
const memoryUsersByEmail = new Map();
const memoryUsersById = new Map();
const memorySessions = new Map();

async function initializeDatabase() {
  if (!persistent) return;
  const { Pool } = require("pg");
  pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname VARCHAR(10) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions(expires_at);
  `);
  await pool.query("DELETE FROM user_sessions WHERE expires_at <= NOW()");
}

const ready = initializeDatabase();
ready.catch((error) => console.error("账号数据库初始化失败：", error.message));

function publicRow(row) {
  if (!row) return null;
  return { id: String(row.id), email: row.email, nickname: row.nickname, passwordHash: row.password_hash };
}

async function createUser({ email, passwordHash, nickname }) {
  await ready;
  if (!persistent) {
    if (memoryUsersByEmail.has(email)) return null;
    const user = { id: String(nextMemoryUserId++), email, nickname, passwordHash };
    memoryUsersByEmail.set(email, user);
    memoryUsersById.set(user.id, user);
    return { ...user };
  }
  try {
    const result = await pool.query(
      "INSERT INTO users (email, password_hash, nickname) VALUES ($1, $2, $3) RETURNING id, email, password_hash, nickname",
      [email, passwordHash, nickname],
    );
    return publicRow(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") return null;
    throw error;
  }
}

async function findUserByEmail(email) {
  await ready;
  if (!persistent) return memoryUsersByEmail.has(email) ? { ...memoryUsersByEmail.get(email) } : null;
  const result = await pool.query("SELECT id, email, password_hash, nickname FROM users WHERE email = $1", [email]);
  return publicRow(result.rows[0]);
}

async function createSession({ tokenHash, userId, expiresAt }) {
  await ready;
  if (!persistent) {
    memorySessions.set(tokenHash, { userId: String(userId), expiresAt: expiresAt.getTime() });
    return;
  }
  await pool.query(
    "INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [tokenHash, userId, expiresAt],
  );
}

async function findUserBySession(tokenHash) {
  await ready;
  if (!persistent) {
    const session = memorySessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) { memorySessions.delete(tokenHash); return null; }
    const user = memoryUsersById.get(session.userId);
    return user ? { ...user } : null;
  }
  const result = await pool.query(`
    SELECT users.id, users.email, users.password_hash, users.nickname
    FROM user_sessions
    JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token_hash = $1 AND user_sessions.expires_at > NOW()
  `, [tokenHash]);
  return publicRow(result.rows[0]);
}

async function deleteSession(tokenHash) {
  await ready;
  if (!persistent) { memorySessions.delete(tokenHash); return; }
  await pool.query("DELETE FROM user_sessions WHERE token_hash = $1", [tokenHash]);
}

module.exports = { persistent, ready, createUser, findUserByEmail, createSession, findUserBySession, deleteSession };
