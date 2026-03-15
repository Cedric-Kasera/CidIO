import { Button, Header, Input, Selection, TextInput } from "@/components";
import { fetchProviderModels, ProviderModelOption } from "@/lib/provider-models";
import {
  getSavedProviderApiKey,
  removeSavedProviderApiKey,
  saveProviderApiKey,
} from "@/lib/provider-settings";
import { UseSettingsReturn } from "@/types";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import { Loader2, RefreshCwIcon, SaveIcon, TrashIcon } from "lucide-react";
import { useEffect, useState } from "react";

export const Providers = ({
  allAiProviders,
  selectedAIProvider,
  onSetSelectedAIProvider,
  variables,
}: UseSettingsReturn) => {
  const [localSelectedProvider, setLocalSelectedProvider] =
    useState<ResultJSON | null>(null);
  const [savedApiKey, setSavedApiKey] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isDeletingApiKey, setIsDeletingApiKey] = useState(false);
  const [modelOptions, setModelOptions] = useState<ProviderModelOption[]>([]);
  const [modelError, setModelError] = useState("");
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const currentProvider = allAiProviders?.find(
    (provider) => provider?.id === selectedAIProvider?.provider
  );
  const providerLabel = currentProvider?.isCustom
    ? "Custom Provider"
    : selectedAIProvider?.provider || "provider";

  useEffect(() => {
    if (!selectedAIProvider?.provider) {
      setLocalSelectedProvider(null);
      return;
    }

    const provider = allAiProviders?.find(
      (item) => item?.id === selectedAIProvider?.provider
    );

    if (!provider) {
      setLocalSelectedProvider(null);
      return;
    }

    const json = curl2Json(provider?.curl);
    setLocalSelectedProvider(json as ResultJSON);
  }, [allAiProviders, selectedAIProvider?.provider]);

  useEffect(() => {
    let cancelled = false;

    setApiKeyError("");
    setModelError("");
    setModelOptions([]);

    if (!selectedAIProvider?.provider) {
      setSavedApiKey("");
      return;
    }

    void (async () => {
      const apiKey = await getSavedProviderApiKey("ai", selectedAIProvider.provider);

      if (!cancelled) {
        setSavedApiKey(apiKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedAIProvider?.provider]);

  const findKeyAndValue = (key: string) => {
    return variables?.find((v) => v?.key === key);
  };

  const updateProviderVariable = (key: string, value: string) => {
    if (!key || !selectedAIProvider) {
      return;
    }

    onSetSelectedAIProvider({
      ...selectedAIProvider,
      variables: {
        ...selectedAIProvider.variables,
        [key]: value,
      },
    });
  };

  const getApiKeyValue = () => {
    const apiKeyVar = findKeyAndValue("api_key");
    if (!apiKeyVar || !selectedAIProvider?.variables) return "";
    return selectedAIProvider?.variables?.[apiKeyVar.key] || "";
  };

  const getVariableValue = (key: string) => {
    if (!key || !selectedAIProvider?.variables) {
      return "";
    }

    return selectedAIProvider.variables[key] || "";
  };

  const handleSaveApiKey = async () => {
    const apiKeyVar = findKeyAndValue("api_key");
    const nextApiKey = getApiKeyValue().trim();

    if (!apiKeyVar || !selectedAIProvider?.provider || !nextApiKey) {
      return;
    }

    setApiKeyError("");
    setIsSavingApiKey(true);

    try {
      await saveProviderApiKey("ai", selectedAIProvider.provider, nextApiKey);
      setSavedApiKey(nextApiKey);
      updateProviderVariable(apiKeyVar.key, nextApiKey);
    } catch (error) {
      setApiKeyError(
        error instanceof Error ? error.message : "Failed to save API key."
      );
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const handleDeleteApiKey = async () => {
    const apiKeyVar = findKeyAndValue("api_key");

    if (!apiKeyVar || !selectedAIProvider?.provider) {
      return;
    }

    setApiKeyError("");
    setIsDeletingApiKey(true);

    try {
      await removeSavedProviderApiKey("ai", selectedAIProvider.provider);
      setSavedApiKey("");
      updateProviderVariable(apiKeyVar.key, "");
    } catch (error) {
      setApiKeyError(
        error instanceof Error ? error.message : "Failed to delete API key."
      );
    } finally {
      setIsDeletingApiKey(false);
    }
  };

  const handleLoadModels = async () => {
    if (!currentProvider || !selectedAIProvider?.provider) {
      return;
    }

    const apiKeyVar = findKeyAndValue("api_key");
    let resolvedApiKey = getApiKeyValue().trim();

    if (!resolvedApiKey) {
      resolvedApiKey = await getSavedProviderApiKey(
        "ai",
        selectedAIProvider.provider
      );

      if (resolvedApiKey && apiKeyVar) {
        updateProviderVariable(apiKeyVar.key, resolvedApiKey);
      }
    }

    setModelError("");
    setIsLoadingModels(true);

    try {
      const options = await fetchProviderModels({
        scope: "ai",
        provider: currentProvider,
        selectedProvider: {
          ...selectedAIProvider,
          variables: {
            ...selectedAIProvider.variables,
            ...(resolvedApiKey ? { api_key: resolvedApiKey } : {}),
          },
        },
      });

      setModelOptions(options);
    } catch (error) {
      setModelError(
        error instanceof Error ? error.message : "Failed to load models."
      );
    } finally {
      setIsLoadingModels(false);
    }
  };

  const normalizedApiKey = getApiKeyValue().trim();
  const isSaveDisabled =
    !normalizedApiKey ||
    normalizedApiKey === savedApiKey ||
    isSavingApiKey ||
    isDeletingApiKey;
  const modelValue = getVariableValue("model");
  const selectedModelValue = modelOptions.some(
    (option) => option.value === modelValue
  )
    ? modelValue
    : undefined;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Header
          title="Select AI Provider"
          description="Select your preferred AI service provider or custom providers to get started."
        />
        <Selection
          selected={selectedAIProvider?.provider}
          options={allAiProviders?.map((provider) => {
            const json = curl2Json(provider?.curl);
            return {
              label: provider?.isCustom
                ? json?.url || "Custom Provider"
                : provider?.id || "Custom Provider",
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="Choose your AI provider"
          onChange={(value) => {
            onSetSelectedAIProvider({
              provider: value,
              variables: {},
            });
          }}
        />
      </div>

      {localSelectedProvider ? (
        <Header
          title={`Method: ${
            localSelectedProvider?.method || "Invalid"
          }, Endpoint: ${localSelectedProvider?.url || "Invalid"}`}
          description={`If you want to use different url or method, you can always create a custom provider.`}
        />
      ) : null}

      {findKeyAndValue("api_key") ? (
        <div className="space-y-2">
          <Header
            title="API Key"
            description={`Enter your ${providerLabel} API key to authenticate and access AI models. Your saved key stays on this device only.`}
          />

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="**********"
                value={getApiKeyValue()}
                onChange={(event) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar) {
                    return;
                  }

                  updateProviderVariable(apiKeyVar.key, event.target.value);
                }}
                disabled={isSavingApiKey || isDeletingApiKey}
                className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
              />
              <Button
                type="button"
                onClick={handleSaveApiKey}
                disabled={isSaveDisabled}
                className="shrink-0 h-11 px-4"
                title="Save API Key"
              >
                {isSavingApiKey ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SaveIcon className="h-4 w-4" />
                )}
                Save
              </Button>
              {savedApiKey ? (
                <Button
                  type="button"
                  onClick={handleDeleteApiKey}
                  disabled={isDeletingApiKey || isSavingApiKey}
                  variant="destructive"
                  className="shrink-0 h-11 px-4"
                  title="Delete saved API Key"
                >
                  {isDeletingApiKey ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <TrashIcon className="h-4 w-4" />
                  )}
                  Delete
                </Button>
              ) : null}
            </div>
            {apiKeyError ? (
              <p className="text-xs text-destructive">{apiKeyError}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="space-y-4 mt-2">
        {variables
          .filter(
            (variable) => variable.key !== findKeyAndValue("api_key")?.key
          )
          .map((variable) => (
            <div className="space-y-1" key={variable?.key}>
              <Header
                title={variable?.value || ""}
                description={`add your preferred ${variable?.key?.replace(
                  /_/g,
                  " "
                )} for ${providerLabel}`}
              />

              {variable.key === "model" ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder={`Enter ${providerLabel} model`}
                      value={getVariableValue(variable.key)}
                      onChange={(event) =>
                        updateProviderVariable(variable.key, event.target.value)
                      }
                      className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleLoadModels}
                      disabled={isLoadingModels}
                      className="shrink-0 h-11 px-4"
                    >
                      {isLoadingModels ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCwIcon className="h-4 w-4" />
                      )}
                      Load Models
                    </Button>
                  </div>

                  {modelOptions.length > 0 ? (
                    <Selection
                      selected={selectedModelValue}
                      onChange={(value) =>
                        updateProviderVariable(variable.key, value)
                      }
                      options={modelOptions.map((option) => ({
                        label: option.label,
                        value: option.value,
                      }))}
                      placeholder="Select a model"
                      disabled={isLoadingModels}
                    />
                  ) : null}

                  {modelError ? (
                    <p className="text-xs text-destructive">{modelError}</p>
                  ) : null}
                </div>
              ) : (
                <TextInput
                  placeholder={`Enter ${providerLabel} ${
                    variable?.key?.replace(/_/g, " ") || "value"
                  }`}
                  value={getVariableValue(variable.key)}
                  onChange={(value) => updateProviderVariable(variable.key, value)}
                />
              )}
            </div>
          ))}
      </div>
    </div>
  );
};
