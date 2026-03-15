import { TYPE_PROVIDER } from "@/types";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import curl2Json from "@bany/curl-to-json";

import { deepVariableReplacer } from "./functions/common.function";
import { ProviderScope } from "./provider-settings";

export interface ProviderModelOption {
  label: string;
  value: string;
}

interface FetchProviderModelsParams {
  scope: ProviderScope;
  provider: TYPE_PROVIDER;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
}

type ModelParser = (payload: unknown, providerId: string) => ProviderModelOption[];

type DiscoveryConfig = {
  requiresApiKey?: boolean;
  resolveUrl: (providerUrl: string) => string | null;
  parse: ModelParser;
};

type ParsedCurl = {
  header?: Record<string, string>;
  url?: string;
};

const TEXT_OUTPUT_KEYWORDS = [
  "text",
  "chat",
  "completion",
  "completions",
  "generate",
  "generation",
  "message",
  "messages",
  "response",
  "responses",
  "content",
];

const NON_TEXT_OUTPUT_KEYWORDS = [
  "image",
  "images",
  "audio",
  "speech",
  "music",
  "video",
  "embedding",
  "embeddings",
  "rerank",
  "moderation",
  "transcription",
  "transcribe",
  "tts",
];

const TEXT_MODEL_NAME_PATTERNS: Partial<Record<string, RegExp[]>> = {
  openai: [/^gpt-/i, /^o\d/i, /^chatgpt-/i],
  claude: [/^claude-/i],
  grok: [/^grok-/i],
  gemini: [/^gemini-/i],
  mistral: [/^mistral-/i, /^open-mistral/i, /^ministral-/i, /^pixtral-/i],
  cohere: [/^command/i],
  perplexity: [/^sonar/i, /^pplx-/i, /^r1-1776/i],
};

const NON_TEXT_MODEL_NAME_PATTERN =
  /(embedding|embed-|rerank|moderation|omni-moderation|whisper|transcri(?:be|ption)|speech-to-text|text-to-speech|tts|audio|video|music|lyria|veo|imagen|image-generation|imagegen|gpt-image|dall-e|realtime|vision-preview)/i;

const AI_MODEL_DISCOVERY: Record<string, DiscoveryConfig> = {
  openai: {
    resolveUrl: () => "https://api.openai.com/v1/models",
    parse: parseGenericModels,
  },
  claude: {
    resolveUrl: () => "https://api.anthropic.com/v1/models",
    parse: parseGenericModels,
  },
  grok: {
    resolveUrl: () => "https://api.x.ai/v1/models",
    parse: parseGenericModels,
  },
  gemini: {
    resolveUrl: () => "https://generativelanguage.googleapis.com/v1beta/openai/models",
    parse: parseGenericModels,
  },
  mistral: {
    resolveUrl: () => "https://api.mistral.ai/v1/models",
    parse: parseGenericModels,
  },
  cohere: {
    resolveUrl: () => "https://api.cohere.ai/v1/models",
    parse: parseGenericModels,
  },
  groq: {
    resolveUrl: () => "https://api.groq.com/openai/v1/models",
    parse: parseGenericModels,
  },
  perplexity: {
    resolveUrl: () => "https://api.perplexity.ai/models",
    parse: parseGenericModels,
  },
  openrouter: {
    resolveUrl: () => "https://openrouter.ai/api/v1/models",
    parse: parseGenericModels,
  },
  ollama: {
    requiresApiKey: false,
    resolveUrl: () => "http://localhost:11434/v1/models",
    parse: parseGenericModels,
  },
};

const STT_MODEL_DISCOVERY: Record<string, DiscoveryConfig> = {
  "openai-whisper": {
    resolveUrl: () => "https://api.openai.com/v1/models",
    parse: parseSpeechToTextModels,
  },
  groq: {
    resolveUrl: () => "https://api.groq.com/openai/v1/models",
    parse: parseSpeechToTextModels,
  },
  "elevenlabs-stt": {
    resolveUrl: () => "https://api.elevenlabs.io/v1/models",
    parse: parseElevenLabsSpeechModels,
  },
};

const LOCALHOST_PREFIXES = ["http://localhost", "http://127.0.0.1"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const getStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => getString(entry))
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => entry.trim());
};

const normalizeModelName = (value: string) =>
  value.trim().replace(/^models\//i, "");

const containsKeyword = (value: string, keywords: string[]) => {
  const normalizedValue = value.toLowerCase();
  return keywords.some((keyword) => normalizedValue.includes(keyword));
};

const getItemTextCandidates = (item: Record<string, unknown>) => {
  const candidates = [
    item.id,
    item.model_id,
    item.name,
    item.slug,
    item.model,
    item.display_name,
    item.title,
    item.type,
    item.endpoint,
    item.category,
    item.description,
  ]
    .map((candidate) => getString(candidate))
    .filter((candidate): candidate is string => Boolean(candidate))
    .map(normalizeModelName);

  return Array.from(new Set(candidates));
};

const getItemRecord = (
  item: Record<string, unknown>,
  key: string
): Record<string, unknown> | null => {
  const value = item[key];
  return isRecord(value) ? value : null;
};

const getItemArrayStrings = (
  item: Record<string, unknown>,
  key: string
): string[] => getStringArray(item[key]);

const hasMatchingKeyword = (values: string[], keywords: string[]) =>
  values.some((value) => containsKeyword(value, keywords));

const inferTextOutputFromMetadata = (
  item: Record<string, unknown>
): boolean | null => {
  const supportedGenerationMethods = [
    ...getItemArrayStrings(item, "supportedGenerationMethods"),
    ...getItemArrayStrings(item, "supported_generation_methods"),
  ];
  if (supportedGenerationMethods.length > 0) {
    return hasMatchingKeyword(
      supportedGenerationMethods,
      TEXT_OUTPUT_KEYWORDS
    );
  }

  const endpoints = [
    ...getItemArrayStrings(item, "endpoints"),
    ...getItemArrayStrings(item, "endpoint_compatibility"),
    ...getItemArrayStrings(item, "capabilities"),
    ...getItemArrayStrings(item, "tasks"),
  ];
  if (endpoints.length > 0) {
    const hasTextEndpoint = hasMatchingKeyword(endpoints, TEXT_OUTPUT_KEYWORDS);
    const hasOnlyNonTextEndpoints =
      !hasTextEndpoint && hasMatchingKeyword(endpoints, NON_TEXT_OUTPUT_KEYWORDS);

    if (hasTextEndpoint) {
      return true;
    }

    if (hasOnlyNonTextEndpoints) {
      return false;
    }
  }

  const outputModalities = [
    ...getItemArrayStrings(item, "output_modalities"),
    ...getItemArrayStrings(item, "outputModalities"),
  ];
  if (outputModalities.length > 0) {
    if (hasMatchingKeyword(outputModalities, ["text"])) {
      return true;
    }

    if (hasMatchingKeyword(outputModalities, NON_TEXT_OUTPUT_KEYWORDS)) {
      return false;
    }
  }

  const architecture = getItemRecord(item, "architecture");
  const architectureModality = architecture
    ? getString(architecture.modality)
    : null;
  const directModality = getString(item.modality);
  const modality = architectureModality || directModality;

  if (modality) {
    const normalizedModality = modality.toLowerCase();
    const modalityParts = normalizedModality.split("->");
    const outputSegment = normalizedModality.includes("->")
      ? modalityParts[modalityParts.length - 1] || normalizedModality
      : normalizedModality;

    if (containsKeyword(outputSegment, ["text"])) {
      return true;
    }

    if (containsKeyword(outputSegment, NON_TEXT_OUTPUT_KEYWORDS)) {
      return false;
    }
  }

  return null;
};

const isTextGenerationModel = (
  item: Record<string, unknown>,
  providerId: string
) => {
  const textFromMetadata = inferTextOutputFromMetadata(item);
  if (textFromMetadata !== null) {
    return textFromMetadata;
  }

  const textCandidates = getItemTextCandidates(item);
  if (textCandidates.length === 0) {
    return false;
  }

  if (textCandidates.some((candidate) => NON_TEXT_MODEL_NAME_PATTERN.test(candidate))) {
    return false;
  }

  const providerAllowPatterns = TEXT_MODEL_NAME_PATTERNS[providerId];
  if (providerAllowPatterns?.length) {
    return textCandidates.some((candidate) =>
      providerAllowPatterns.some((pattern) => pattern.test(candidate))
    );
  }

  return true;
};

const getModelItems = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const candidates = [payload.data, payload.models, payload.results];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  return [];
};

const isActiveModel = (item: Record<string, unknown>) => {
  if (typeof item.active === "boolean" && !item.active) {
    return false;
  }

  const state = getString(item.state)?.toLowerCase();
  if (state && ["inactive", "disabled", "deleted", "archived"].includes(state)) {
    return false;
  }

  const status = getString(item.status)?.toLowerCase();
  if (
    status &&
    ["inactive", "disabled", "deleted", "archived", "deprecated"].includes(
      status
    )
  ) {
    return false;
  }

  return true;
};

const normalizeModelOption = (
  item: Record<string, unknown>
): ProviderModelOption | null => {
  const rawValue =
    getString(item.id) ??
    getString(item.model_id) ??
    getString(item.name) ??
    getString(item.slug) ??
    getString(item.model);

  if (!rawValue) {
    return null;
  }

  const value = normalizeModelName(rawValue);
  if (!value) {
    return null;
  }

  return {
    value,
    label: value,
  };
};

const dedupeModelOptions = (options: ProviderModelOption[]) =>
  Array.from(
    new Map(options.map((option) => [option.value, option])).values()
  ).sort((left, right) => left.label.localeCompare(right.label));

function parseGenericModels(
  payload: unknown,
  providerId: string
): ProviderModelOption[] {
  return dedupeModelOptions(
    getModelItems(payload)
      .filter(isActiveModel)
      .filter((item) => isTextGenerationModel(item, providerId))
      .map(normalizeModelOption)
      .filter((option): option is ProviderModelOption => option !== null)
  );
}

function parseSpeechToTextModels(
  payload: unknown,
  providerId: string
): ProviderModelOption[] {
  const genericOptions = parseGenericModels(payload, providerId);
  const sttOptions = genericOptions.filter((option) =>
    /(whisper|transcribe)/i.test(`${option.label} ${option.value}`)
  );

  if (sttOptions.length > 0) {
    return sttOptions;
  }

  if (providerId === "groq") {
    return genericOptions;
  }

  return genericOptions;
}

function parseElevenLabsSpeechModels(payload: unknown): ProviderModelOption[] {
  const items = getModelItems(payload).filter(isActiveModel);
  const speechItems = items.filter((item) => {
    if (typeof item.can_do_speech_to_text === "boolean") {
      return item.can_do_speech_to_text;
    }

    if (typeof item.supports_speech_to_text === "boolean") {
      return item.supports_speech_to_text;
    }

    return true;
  });

  return dedupeModelOptions(
    speechItems
      .map(normalizeModelOption)
      .filter((option): option is ProviderModelOption => option !== null)
  );
}

const buildFallbackDiscoveryConfig = (
  scope: ProviderScope,
  providerUrl: string
): DiscoveryConfig | null => {
  if (scope !== "ai") {
    return null;
  }

  const derivedUrl = providerUrl
    .replace("/chat/completions", "/models")
    .replace("/messages", "/models");

  if (derivedUrl === providerUrl) {
    return null;
  }

  return {
    resolveUrl: () => derivedUrl,
    parse: parseGenericModels,
  };
};

const getDiscoveryConfig = (
  scope: ProviderScope,
  providerId: string,
  providerUrl: string
): DiscoveryConfig | null => {
  const staticConfig =
    scope === "ai"
      ? AI_MODEL_DISCOVERY[providerId]
      : STT_MODEL_DISCOVERY[providerId];

  if (staticConfig) {
    return staticConfig;
  }

  return buildFallbackDiscoveryConfig(scope, providerUrl);
};

const getRequestHeaders = (
  provider: TYPE_PROVIDER,
  variables: Record<string, string>
) => {
  const parsedCurl = curl2Json(provider.curl) as ParsedCurl;
  const uppercaseVariables = Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key.toUpperCase(), value])
  );

  const rawHeaders = deepVariableReplacer(
    parsedCurl.header || {},
    uppercaseVariables
  ) as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(rawHeaders).filter(
      ([, value]) => typeof value === "string" && value.trim().length > 0
    )
  ) as Record<string, string>;
};

const parseErrorMessage = async (response: Response) => {
  const text = await response.text();

  if (!text) {
    return `${response.status} ${response.statusText}`.trim();
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const nestedError = parsed.error;

    if (typeof nestedError === "string") {
      return nestedError;
    }

    if (isRecord(nestedError) && getString(nestedError.message)) {
      return getString(nestedError.message) || text;
    }

    if (getString(parsed.message)) {
      return getString(parsed.message) || text;
    }
  } catch {
    return text;
  }

  return text;
};

export const fetchProviderModels = async ({
  scope,
  provider,
  selectedProvider,
}: FetchProviderModelsParams): Promise<ProviderModelOption[]> => {
  const providerId = provider.id || selectedProvider.provider;
  const parsedCurl = curl2Json(provider.curl) as ParsedCurl;
  const providerUrl = parsedCurl.url || "";
  const discoveryConfig = getDiscoveryConfig(scope, providerId || "", providerUrl);

  if (!providerId || !providerUrl || !discoveryConfig) {
    throw new Error(
      "Model discovery is not available for this provider yet. Enter the model manually."
    );
  }

  const apiKey = selectedProvider.variables.api_key?.trim() || "";
  if (discoveryConfig.requiresApiKey !== false && !apiKey) {
    throw new Error("Enter or save an API key first.");
  }

  const modelUrl = discoveryConfig.resolveUrl(providerUrl);
  if (!modelUrl) {
    throw new Error(
      "Model discovery is not available for this provider yet. Enter the model manually."
    );
  }

  const requestHeaders = getRequestHeaders(provider, selectedProvider.variables);
  const fetchFunction = LOCALHOST_PREFIXES.some((prefix) =>
    modelUrl.startsWith(prefix)
  )
    ? fetch
    : tauriFetch;

  let response: Response;
  try {
    response = await fetchFunction(modelUrl, {
      method: "GET",
      headers: requestHeaders,
    });
  } catch (error) {
    throw new Error(
      `Network error while loading models: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const payload = (await response.json()) as unknown;
  const modelOptions = discoveryConfig.parse(payload, providerId);

  if (modelOptions.length === 0) {
    throw new Error(
      "No active models were returned for this provider. Enter the model manually."
    );
  }

  return modelOptions;
};
