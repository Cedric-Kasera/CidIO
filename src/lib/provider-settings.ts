import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { invoke } from "@tauri-apps/api/core";
import { getItem, removeItem, saveItem } from "tauri-plugin-keychain";

export type ProviderScope = "ai" | "stt";

type ProviderVariableStore = Record<string, Record<string, string>>;

const PROVIDER_VARIABLE_STORAGE_KEYS: Record<ProviderScope, string> = {
  ai: STORAGE_KEYS.AI_PROVIDER_VARIABLES,
  stt: STORAGE_KEYS.STT_PROVIDER_VARIABLES,
};

const hasValue = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const readProviderVariableStore = (
  scope: ProviderScope
): ProviderVariableStore => {
  const rawValue = safeLocalStorage.getItem(
    PROVIDER_VARIABLE_STORAGE_KEYS[scope]
  );

  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([providerId, variables]) => {
          if (
            !variables ||
            typeof variables !== "object" ||
            Array.isArray(variables)
          ) {
            return [providerId, {}];
          }

          return [
            providerId,
            stripSecretProviderVariables(variables as Record<string, string>),
          ];
        })
        .filter(([, variables]) => Object.keys(variables).length > 0)
    );
  } catch {
    return {};
  }
};

const writeProviderVariableStore = (
  scope: ProviderScope,
  store: ProviderVariableStore
) => {
  if (Object.keys(store).length === 0) {
    safeLocalStorage.removeItem(PROVIDER_VARIABLE_STORAGE_KEYS[scope]);
    return;
  }

  safeLocalStorage.setItem(
    PROVIDER_VARIABLE_STORAGE_KEYS[scope],
    JSON.stringify(store)
  );
};

const getProviderApiKeyStorageKey = (
  scope: ProviderScope,
  providerId: string
) => `cidio:${scope}:${providerId}:api_key`;

const getProviderApiKeyFallbackKey = (
  scope: ProviderScope,
  providerId: string
) => `provider_api_key:${scope}:${providerId}`;

const getSavedProviderApiKeyFromFallback = async (
  scope: ProviderScope,
  providerId: string
) => {
  try {
    return (
      (await invoke<string | null>("provider_secret_get", {
        key: getProviderApiKeyFallbackKey(scope, providerId),
      })) ?? ""
    );
  } catch (error) {
    console.debug(
      `Failed to read fallback ${scope} API key for ${providerId}:`,
      error
    );
    return "";
  }
};

export const stripSecretProviderVariables = (
  variables: Record<string, string>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(variables).filter(
      ([key, value]) => key !== "api_key" && hasValue(value)
    )
  );

export const mergeProviderVariables = (
  currentVariables: Record<string, string>,
  savedVariables: Record<string, string>
): Record<string, string> => {
  const mergedVariables = { ...savedVariables };

  for (const [key, value] of Object.entries(currentVariables)) {
    if (hasValue(value) || !(key in mergedVariables)) {
      mergedVariables[key] = value;
    }
  }

  return mergedVariables;
};

export const getSavedProviderVariables = (
  scope: ProviderScope,
  providerId: string
): Record<string, string> => {
  if (!providerId) {
    return {};
  }

  const store = readProviderVariableStore(scope);
  return store[providerId] ?? {};
};

export const saveProviderVariables = (
  scope: ProviderScope,
  providerId: string,
  variables: Record<string, string>
) => {
  if (!providerId) {
    return;
  }

  const store = readProviderVariableStore(scope);
  const nextVariables = stripSecretProviderVariables(variables);

  if (Object.keys(nextVariables).length > 0) {
    store[providerId] = nextVariables;
  } else {
    delete store[providerId];
  }

  writeProviderVariableStore(scope, store);
};

export const getSavedProviderApiKey = async (
  scope: ProviderScope,
  providerId: string
): Promise<string> => {
  if (!providerId) {
    return "";
  }

  try {
    const keychainValue =
      (await getItem(getProviderApiKeyStorageKey(scope, providerId))) ?? "";

    if (keychainValue) {
      return keychainValue;
    }
  } catch (error) {
    console.debug(`Failed to read saved ${scope} API key for ${providerId}:`, error);
  }

  return getSavedProviderApiKeyFromFallback(scope, providerId);
};

export const saveProviderApiKey = async (
  scope: ProviderScope,
  providerId: string,
  apiKey: string
) => {
  const normalizedApiKey = apiKey.trim();

  if (!providerId || !normalizedApiKey) {
    return;
  }

  try {
    await saveItem(getProviderApiKeyStorageKey(scope, providerId), normalizedApiKey);
    await invoke("provider_secret_remove", {
      key: getProviderApiKeyFallbackKey(scope, providerId),
    });
  } catch (error) {
    console.debug(
      `Failed to save ${scope} API key for ${providerId} to keychain:`,
      error
    );

    try {
      await invoke("provider_secret_save", {
        item: {
          key: getProviderApiKeyFallbackKey(scope, providerId),
          value: normalizedApiKey,
        },
      });
    } catch (fallbackError) {
      console.debug(
        `Failed to save fallback ${scope} API key for ${providerId}:`,
        fallbackError
      );
      throw fallbackError;
    }
  }
};

export const removeSavedProviderApiKey = async (
  scope: ProviderScope,
  providerId: string
) => {
  if (!providerId) {
    return;
  }

  try {
    await removeItem(getProviderApiKeyStorageKey(scope, providerId));
  } catch (error) {
    console.debug(
      `Failed to delete ${scope} API key for ${providerId} from keychain:`,
      error
    );
  }

  try {
    await invoke("provider_secret_remove", {
      key: getProviderApiKeyFallbackKey(scope, providerId),
    });
  } catch (error) {
    console.debug(
      `Failed to delete fallback ${scope} API key for ${providerId}:`,
      error
    );
    throw error;
  }
};
