import axios, { AxiosInstance } from "axios";
import * as https from "https";
import { OpenNMSConfig, isTokenAuth } from "./config.js";

function buildAuthHeaders(config: OpenNMSConfig): Record<string, string> {
  if (isTokenAuth(config)) {
    return { Authorization: `Bearer ${config.token}` };
  }
  const credentials = Buffer.from(
    `${config.username}:${config.password}`
  ).toString("base64");
  return { Authorization: `Basic ${credentials}` };
}

export function createApiClient(config: OpenNMSConfig) {
  const commonHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...buildAuthHeaders(config),
  };

  // Build httpsAgent for insecure mode (FOUND-08)
  const httpsAgent = config.insecure
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

  const instanceConfig = {
    headers: commonHeaders,
    timeout: 30000,
    httpsAgent,
  };

  // v2 API: FIQL filtering, preferred for reads
  const v2: AxiosInstance = axios.create({
    ...instanceConfig,
    baseURL: `${config.url}/api/v2`,
  });

  // v1 API: mutations, categories, assets, collection, events POST
  const v1: AxiosInstance = axios.create({
    ...instanceConfig,
    baseURL: `${config.url}/opennms/rest`,
  });

  return { v2, v1 };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function buildErrorMessage(err: unknown, context: string): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      // FOUND-06: network error — server unreachable
      return `Could not reach OpenNMS at ${context}. Is the server running and URL correct? (${err.message})`;
    }
    const status = err.response.status;
    if (status === 401 || status === 403) {
      // FOUND-07: auth failure
      return `Authentication failed (HTTP ${status}). Check credentials in your config file.`;
    }
    if (status === 404) {
      return `Not found (HTTP 404): ${context}`;
    }
    return `OpenNMS API error (HTTP ${status}): ${JSON.stringify(err.response.data)}`;
  }
  return `Unexpected error: ${String(err)}`;
}
