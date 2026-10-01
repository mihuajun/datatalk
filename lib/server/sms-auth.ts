import { randomInt, timingSafeEqual } from "node:crypto";

import DysmsapiClient, { SendSmsRequest } from "@alicloud/dysmsapi20170525";
import * as OpenApi from "@alicloud/openapi-client";
import { readAppConfig, readOptionalStringConfigValue } from "@/lib/server/app-config";

const CODE_TTL_MS = 5 * 60 * 1000;
const SEND_INTERVAL_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

type PendingCode = {
  digest: Buffer;
  expiresAt: number;
  nextSendAt: number;
  attempts: number;
};

export type PhoneCodePurpose = "register" | "reset-password";

declare global {
  var __datatalkPhoneCodes: Map<string, PendingCode> | undefined;
  var __datatalkSmsClient: DysmsapiClient | undefined;
}

function getCodeStore() {
  if (!globalThis.__datatalkPhoneCodes) globalThis.__datatalkPhoneCodes = new Map();
  return globalThis.__datatalkPhoneCodes;
}

function getSmsConfig() {
  const sms = readAppConfig()?.sms;
  const accessKeyId = readOptionalStringConfigValue(sms?.accessKeyId) || process.env.ALIYUN_SMS_ACCESS_KEY_ID?.trim() || "";
  const accessKeySecret = readOptionalStringConfigValue(sms?.accessKeySecret) || process.env.ALIYUN_SMS_ACCESS_KEY_SECRET?.trim() || "";
  const signName = readOptionalStringConfigValue(sms?.signName) || process.env.ALIYUN_SMS_SIGN_NAME?.trim() || "";
  const templateCode = readOptionalStringConfigValue(sms?.templateCode) || process.env.ALIYUN_SMS_TEMPLATE_CODE?.trim() || "";
  const endpoint = readOptionalStringConfigValue(sms?.endpoint) || process.env.ALIYUN_SMS_ENDPOINT?.trim() || "dysmsapi.aliyuncs.com";

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) return null;
  return { accessKeyId, accessKeySecret, signName, templateCode, endpoint };
}

function getSmsClient(config: NonNullable<ReturnType<typeof getSmsConfig>>) {
  if (!globalThis.__datatalkSmsClient) {
    globalThis.__datatalkSmsClient = new DysmsapiClient(new OpenApi.Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      endpoint: config.endpoint,
    }));
  }
  return globalThis.__datatalkSmsClient;
}

function createCode() {
  return String(randomInt(100000, 1000000));
}

function storeKey(phone: string, purpose: PhoneCodePurpose) {
  return `${purpose}:${phone}`;
}

function digestCode(phone: string, code: string, purpose: PhoneCodePurpose) {
  return Buffer.from(`${purpose}:${phone}:${code}`);
}

export function isSmsConfigured() {
  return Boolean(getSmsConfig());
}

export function getCodeRetryAfter(phone: string, purpose: PhoneCodePurpose = "register") {
  const pending = getCodeStore().get(storeKey(phone, purpose));
  if (!pending) return 0;
  return Math.max(0, Math.ceil((pending.nextSendAt - Date.now()) / 1000));
}

export async function sendPhoneCode(phone: string, purpose: PhoneCodePurpose = "register") {
  const store = getCodeStore();
  const retryAfter = getCodeRetryAfter(phone, purpose);
  if (retryAfter > 0) {
    const error = new Error("SMS_RATE_LIMITED");
    Object.assign(error, { retryAfter });
    throw error;
  }

  const code = createCode();
  const config = getSmsConfig();
  if (!config) {
    if (process.env.NODE_ENV === "production") throw new Error("SMS_NOT_CONFIGURED");
  } else {
    const response = await getSmsClient(config).sendSms(new SendSmsRequest({
      phoneNumbers: phone,
      signName: config.signName,
      templateCode: config.templateCode,
      templateParam: JSON.stringify({ code }),
    }));
    if (response.body?.code !== "OK") {
      console.error("Aliyun SMS request failed", { code: response.body?.code, message: response.body?.message });
      throw new Error("SMS_PROVIDER_FAILED");
    }
  }

  store.set(storeKey(phone, purpose), {
    digest: digestCode(phone, code, purpose),
    expiresAt: Date.now() + CODE_TTL_MS,
    nextSendAt: Date.now() + SEND_INTERVAL_MS,
    attempts: 0,
  });
  return { expiresIn: CODE_TTL_MS / 1000, retryAfter: SEND_INTERVAL_MS / 1000 };
}

export function consumePhoneCode(phone: string, code: string, purpose: PhoneCodePurpose = "register") {
  const store = getCodeStore();
  const key = storeKey(phone, purpose);
  const pending = store.get(key);
  if (!pending || pending.expiresAt <= Date.now()) {
    store.delete(key);
    return false;
  }
  pending.attempts += 1;
  const received = digestCode(phone, code, purpose);
  const valid = received.length === pending.digest.length && timingSafeEqual(received, pending.digest);
  if (valid || pending.attempts >= MAX_ATTEMPTS) store.delete(key);
  return valid;
}
