import { randomInt, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";

import { readAppConfig, readBooleanConfigValue, readOptionalStringConfigValue } from "@/lib/server/app-config";

const CODE_TTL_MS = 5 * 60 * 1000;
const SEND_INTERVAL_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

type PendingCode = {
  digest: Buffer;
  expiresAt: number;
  nextSendAt: number;
  attempts: number;
};

export type EmailCodePurpose = "register" | "reset-password";

declare global {
  var __datatalkEmailCodes: Map<string, PendingCode> | undefined;
  var __datatalkEmailTransporter: nodemailer.Transporter | undefined;
}

function getStore() {
  if (!globalThis.__datatalkEmailCodes) globalThis.__datatalkEmailCodes = new Map();
  return globalThis.__datatalkEmailCodes;
}

function getConfig() {
  const smtp = readAppConfig()?.email?.smtp;
  const host = readOptionalStringConfigValue(smtp?.host) || process.env.SMTP_HOST?.trim() || "";
  const port = Number(readOptionalStringConfigValue(smtp?.port) || process.env.SMTP_PORT?.trim() || "465");
  const user = readOptionalStringConfigValue(smtp?.user) || process.env.SMTP_USER?.trim() || "";
  const password = readOptionalStringConfigValue(smtp?.password) || process.env.SMTP_PASSWORD?.trim() || "";
  const from = readOptionalStringConfigValue(smtp?.from) || process.env.SMTP_FROM?.trim() || "";
  const secure = smtp?.secure !== undefined ? readBooleanConfigValue(smtp.secure, port === 465, "email.smtp.secure") : (process.env.SMTP_SECURE?.trim().toLowerCase() || (port === 465 ? "true" : "false")) === "true";
  if (!host || !Number.isFinite(port) || !user || !password || !from) return null;
  return { host, port, user, password, from, secure };
}

function getTransporter(config: NonNullable<ReturnType<typeof getConfig>>) {
  if (!globalThis.__datatalkEmailTransporter) {
    globalThis.__datatalkEmailTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
    });
  }
  return globalThis.__datatalkEmailTransporter;
}

function storeKey(email: string, purpose: EmailCodePurpose) {
  return `${purpose}:${email}`;
}

function digest(email: string, code: string, purpose: EmailCodePurpose) {
  return Buffer.from(`${purpose}:${email}:${code}`);
}

function createCode() {
  return String(randomInt(100000, 1000000));
}

export function isEmailConfigured() {
  return Boolean(getConfig());
}

export function getEmailCodeRetryAfter(email: string, purpose: EmailCodePurpose = "register") {
  const pending = getStore().get(storeKey(email, purpose));
  return pending ? Math.max(0, Math.ceil((pending.nextSendAt - Date.now()) / 1000)) : 0;
}

export async function sendEmailCode(email: string, purpose: EmailCodePurpose = "register") {
  const retryAfter = getEmailCodeRetryAfter(email, purpose);
  if (retryAfter > 0) {
    const error = new Error("EMAIL_RATE_LIMITED");
    Object.assign(error, { retryAfter });
    throw error;
  }

  const config = getConfig();
  if (!config) throw new Error("EMAIL_NOT_CONFIGURED");

  const code = createCode();
  const subject = purpose === "reset-password" ? "DataTalk 重置密码验证码" : "DataTalk 注册验证码";
  const purposeText = purpose === "reset-password" ? "重置 DataTalk 登录密码" : "注册 DataTalk 账号";
  await getTransporter(config).sendMail({
    from: config.from,
    to: email,
    subject,
    text: `你的 DataTalk ${purposeText}验证码是 ${code}，5 分钟内有效。如非本人操作，请忽略此邮件。`,
    html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#17243a"><h2>${purposeText}</h2><p>你的验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#2167e8">${code}</p><p>验证码 5 分钟内有效。如非本人操作，请忽略此邮件。</p></div>`,
  });

  getStore().set(storeKey(email, purpose), {
    digest: digest(email, code, purpose),
    expiresAt: Date.now() + CODE_TTL_MS,
    nextSendAt: Date.now() + SEND_INTERVAL_MS,
    attempts: 0,
  });
  return { expiresIn: CODE_TTL_MS / 1000, retryAfter: SEND_INTERVAL_MS / 1000 };
}

export function consumeEmailCode(email: string, code: string, purpose: EmailCodePurpose = "register") {
  const store = getStore();
  const key = storeKey(email, purpose);
  const pending = store.get(key);
  if (!pending || pending.expiresAt <= Date.now()) {
    store.delete(key);
    return false;
  }
  pending.attempts += 1;
  const received = digest(email, code, purpose);
  const valid = received.length === pending.digest.length && timingSafeEqual(received, pending.digest);
  if (valid || pending.attempts >= MAX_ATTEMPTS) store.delete(key);
  return valid;
}
