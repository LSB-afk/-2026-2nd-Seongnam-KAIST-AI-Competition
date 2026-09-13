export type MapConfig = { provider: "naver"; configured: boolean; clientId?: string; reason?: string };

/** This is a public browser identifier, never the Maps client secret. */
export function getMapConfig(env: Record<string, string | undefined> = process.env): MapConfig {
  const clientId = env.NCP_MAPS_CLIENT_ID?.trim();
  if (!clientId) return { provider: "naver", configured: false, reason: "missing-client-id" };
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(clientId)) return { provider: "naver", configured: false, reason: "invalid-client-id" };
  return { provider: "naver", configured: true, clientId };
}
