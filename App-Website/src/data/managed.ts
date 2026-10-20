import { native, vault } from './api';
const origin =
  import.meta.env.VITE_GREENBIZ_AI_SERVICE || 'https://greenbiz-ai-service.dearjelly6.chatgpt.site';
interface Installation {
  installationId: string;
  secret: string;
}
let browserInstallation: Installation | undefined;
let enrollment: Promise<Installation> | undefined;
const vaultKey = 'greenbizManagedAIInstallation';
async function request<T>(path: string, body?: unknown, credential?: Installation): Promise<T> {
  let response: Response;
  try {
    response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(credential
          ? {
              Authorization: 'Bearer ' + credential.secret,
              'x-greenbiz-installation': credential.installationId,
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error(
      'GreenBiz AI needs an internet connection. Your shop records are saved on this phone.',
    );
  }
  const json = await response.json().catch(() => ({}));
  if (response.status === 403 && !native)
    // The service accepts browsers only from the GreenBiz websites it has been told about.
    throw new Error(
      'GreenBiz AI is not enabled for this website address yet. Use the Android app, or ask your administrator to add this address to the AI service.',
    );
  if (!response.ok)
    throw new Error(
      typeof json.error === 'string'
        ? json.error
        : 'GreenBiz AI is unavailable right now. Try again later or use manual entry.',
    );
  return json as T;
}
async function enroll() {
  let credential = browserInstallation;
  if (native) {
    const value = (await vault.get({ key: vaultKey })).value;
    try {
      credential = value ? JSON.parse(value) : undefined;
    } catch {
      credential = undefined;
    }
  }
  if (
    !credential ||
    !/^[a-f0-9]{64}$/.test(credential.secret) ||
    !/^[a-f0-9-]{36}$/.test(credential.installationId)
  ) {
    credential = {
      installationId: crypto.randomUUID(),
      secret: Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    };
    if (native) await vault.set({ key: vaultKey, value: JSON.stringify(credential) });
    else browserInstallation = credential;
  }
  await request('/api/mobile/enroll', credential);
  return credential;
}
export async function managedAi(
  task: 'stock' | 'sale' | 'advice',
  data: unknown,
  beforeSend?: () => void,
): Promise<string> {
  enrollment ??= enroll().catch((error) => {
    enrollment = undefined;
    throw error;
  });
  const credential = await enrollment;
  beforeSend?.();
  const result = await request<{ text: string }>(
    '/api/mobile/chat',
    { requestId: crypto.randomUUID(), task, data },
    credential,
  );
  if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 20000)
    throw new Error('GreenBiz AI returned an unreadable answer. Try again or use manual entry.');
  return result.text;
}
export async function managedAiStatus() {
  return request<{ status: string; ai: boolean; model: string }>('/api/health');
}
