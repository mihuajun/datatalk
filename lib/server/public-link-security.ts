import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { ensureWorkspaceStorageLayout, PUBLIC_LINK_SECRET_ROOT } from "@/lib/server/workspace-storage";

export const PUBLIC_LINK_ACCESS_COOKIE_NAME = "chat_bi_public_link_access";
const SECRET_DIR = PUBLIC_LINK_SECRET_ROOT;
const SECRET_PATH = path.join(SECRET_DIR, "secret.key");
const PASSWORD_LENGTH = 4;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type PublicLinkAccessPayload = {
  version: 1;
  linkId: number;
  shortCode: string;
  passwordHash: string;
  expiresAt: number;
};

function ensureSecret() {
  const envSecret = process.env.PUBLIC_LINK_SECRET?.trim();
  if (envSecret) return envSecret;

  ensureWorkspaceStorageLayout();
  fs.mkdirSync(SECRET_DIR, { recursive: true });
  if (!fs.existsSync(SECRET_PATH)) {
    fs.writeFileSync(SECRET_PATH, randomBytes(32).toString("base64url"), { mode: 0o600 });
    fs.chmodSync(SECRET_PATH, 0o600);
  }
  return fs.readFileSync(SECRET_PATH, "utf8").trim();
}

function sign(value: string) {
  return createHmac("sha256", ensureSecret()).update(value).digest("base64url");
}

function encodePayload(payload: PublicLinkAccessPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as PublicLinkAccessPayload;
  } catch {
    return null;
  }
}

function verifySignature(value: string, signature: string) {
  const expected = Buffer.from(sign(value));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function generatePublicLinkPassword() {
  return String(randomInt(0, 10_000)).padStart(PASSWORD_LENGTH, "0");
}

export function hashPublicLinkPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

export function createPublicLinkAccessCookieValue(input: {
  linkId: number;
  shortCode: string;
  passwordHash: string;
  expiresAt?: Date | string | null;
}) {
  const expiresAt = input.expiresAt ? new Date(input.expiresAt).getTime() : Date.now() + COOKIE_MAX_AGE_SECONDS * 1000;
  const payload: PublicLinkAccessPayload = {
    version: 1,
    linkId: input.linkId,
    shortCode: input.shortCode,
    passwordHash: input.passwordHash,
    expiresAt,
  };
  const encoded = encodePayload(payload);
  return `${encoded}.${sign(encoded)}`;
}

export function setPublicLinkAccessCookie(response: NextResponse, input: {
  linkId: number;
  shortCode: string;
  passwordHash: string;
  expiresAt?: Date | string | null;
}) {
  const requestedMaxAge = input.expiresAt ? Math.floor((new Date(input.expiresAt).getTime() - Date.now()) / 1000) : COOKIE_MAX_AGE_SECONDS;
  const maxAge = Math.max(1, Math.min(COOKIE_MAX_AGE_SECONDS, requestedMaxAge));
  response.cookies.set(PUBLIC_LINK_ACCESS_COOKIE_NAME, createPublicLinkAccessCookieValue(input), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function hasPublicLinkAccess(shortCode: string, input: { linkId: number; passwordHash: string }) {
  const cookieStore = await cookies();
  const value = cookieStore.get(PUBLIC_LINK_ACCESS_COOKIE_NAME)?.value;
  if (!value) return false;

  const [encoded, signature] = value.split(".");
  if (!encoded || !signature || !verifySignature(encoded, signature)) return false;
  const payload = decodePayload(encoded);
  if (!payload || payload.version !== 1) return false;
  if (payload.expiresAt <= Date.now()) return false;
  return payload.linkId === input.linkId && payload.shortCode === shortCode && payload.passwordHash === input.passwordHash;
}

export function verifyPublicLinkPassword(password: string, expectedPassword: string) {
  const received = Buffer.from(hashPublicLinkPassword(password), "hex");
  const expected = Buffer.from(hashPublicLinkPassword(expectedPassword), "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
