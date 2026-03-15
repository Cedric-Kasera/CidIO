use crate::api::get_stored_credentials;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_machine_uid::MachineUidExt;
use uuid::Uuid;

fn get_payment_endpoint() -> Result<String, String> {
    if let Ok(endpoint) = env::var("PAYMENT_ENDPOINT") {
        return Ok(endpoint);
    }

    match option_env!("PAYMENT_ENDPOINT") {
        Some(endpoint) => Ok(endpoint.to_string()),
        None => Err("PAYMENT_ENDPOINT environment variable not set. Please ensure it's set during the build process.".to_string())
    }
}

fn get_api_access_key() -> Result<String, String> {
    if let Ok(key) = env::var("API_ACCESS_KEY") {
        return Ok(key);
    }

    match option_env!("API_ACCESS_KEY") {
        Some(key) => Ok(key.to_string()),
        None => Err("API_ACCESS_KEY environment variable not set. Please ensure it's set during the build process.".to_string())
    }
}

// Secure storage functions using Tauri's app data directory
fn get_secure_storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Create the directory if it doesn't exist
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    Ok(app_data_dir.join("secure_storage.json"))
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct SecureStorage {
    license_key: Option<String>,
    instance_id: Option<String>,
    selected_pluely_model: Option<String>,
    provider_api_keys: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageItem {
    key: String,
    value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageResult {
    license_key: Option<String>,
    instance_id: Option<String>,
    selected_pluely_model: Option<String>,
    provider_api_keys: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderSecretItem {
    key: String,
    value: String,
}

fn read_secure_storage(storage_path: &PathBuf) -> Result<SecureStorage, String> {
    if !storage_path.exists() {
        return Ok(SecureStorage::default());
    }

    let content = fs::read_to_string(storage_path)
        .map_err(|e| format!("Failed to read storage file: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse storage file: {}", e))
}

fn write_secure_storage(storage_path: &PathBuf, storage: &SecureStorage) -> Result<(), String> {
    let content = serde_json::to_string(storage)
        .map_err(|e| format!("Failed to serialize storage: {}", e))?;

    fs::write(storage_path, content).map_err(|e| format!("Failed to write storage file: {}", e))
}

#[tauri::command]
pub async fn secure_storage_save(app: AppHandle, items: Vec<StorageItem>) -> Result<(), String> {
    let storage_path = get_secure_storage_path(&app)?;

    let mut storage = read_secure_storage(&storage_path)?;

    for item in items {
        match item.key.as_str() {
            "pluely_license_key" => storage.license_key = Some(item.value),
            "pluely_instance_id" => storage.instance_id = Some(item.value),
            "selected_pluely_model" => storage.selected_pluely_model = Some(item.value),
            _ => return Err(format!("Invalid storage key: {}", item.key)),
        }
    }

    write_secure_storage(&storage_path, &storage)
}

#[tauri::command]
pub async fn secure_storage_get(app: AppHandle) -> Result<StorageResult, String> {
    let storage_path = get_secure_storage_path(&app)?;

    if !storage_path.exists() {
        return Ok(StorageResult {
            license_key: None,
            instance_id: None,
            selected_pluely_model: None,
            provider_api_keys: None,
        });
    }

    let storage = read_secure_storage(&storage_path)?;

    Ok(StorageResult {
        license_key: storage.license_key,
        instance_id: storage.instance_id,
        selected_pluely_model: storage.selected_pluely_model,
        provider_api_keys: storage.provider_api_keys,
    })
}

#[tauri::command]
pub async fn secure_storage_remove(app: AppHandle, keys: Vec<String>) -> Result<(), String> {
    let storage_path = get_secure_storage_path(&app)?;

    if !storage_path.exists() {
        return Ok(()); // Nothing to remove
    }

    let mut storage = read_secure_storage(&storage_path)?;

    for key in keys {
        match key.as_str() {
            "pluely_license_key" => storage.license_key = None,
            "pluely_instance_id" => storage.instance_id = None,
            "selected_pluely_model" => storage.selected_pluely_model = None,
            _ => return Err(format!("Invalid storage key: {}", key)),
        }
    }

    write_secure_storage(&storage_path, &storage)
}

#[tauri::command]
pub async fn provider_secret_save(app: AppHandle, item: ProviderSecretItem) -> Result<(), String> {
    let storage_path = get_secure_storage_path(&app)?;
    let mut storage = read_secure_storage(&storage_path)?;
    let mut provider_api_keys = storage.provider_api_keys.unwrap_or_default();

    provider_api_keys.insert(item.key, item.value);
    storage.provider_api_keys = Some(provider_api_keys);

    write_secure_storage(&storage_path, &storage)
}

#[tauri::command]
pub async fn provider_secret_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let storage_path = get_secure_storage_path(&app)?;
    let storage = read_secure_storage(&storage_path)?;

    Ok(storage
        .provider_api_keys
        .and_then(|provider_api_keys| provider_api_keys.get(&key).cloned()))
}

#[tauri::command]
pub async fn provider_secret_remove(app: AppHandle, key: String) -> Result<(), String> {
    let storage_path = get_secure_storage_path(&app)?;

    if !storage_path.exists() {
        return Ok(());
    }

    let mut storage = read_secure_storage(&storage_path)?;

    if let Some(provider_api_keys) = storage.provider_api_keys.as_mut() {
        provider_api_keys.remove(&key);

        if provider_api_keys.is_empty() {
            storage.provider_api_keys = None;
        }
    }

    write_secure_storage(&storage_path, &storage)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivationRequest {
    license_key: String,
    instance_name: String,
    machine_id: String,
    app_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivationResponse {
    activated: bool,
    error: Option<String>,
    license_key: Option<String>,
    instance: Option<InstanceInfo>,
    is_dev_license: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateResponse {
    is_active: bool,
    last_validated_at: Option<String>,
    is_dev_license: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InstanceInfo {
    id: String,
    name: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckoutResponse {
    success: Option<bool>,
    checkout_url: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn activate_license_api(
    app: AppHandle,
    license_key: String,
) -> Result<ActivationResponse, String> {
    // Get payment endpoint and API access key from environment
    let payment_endpoint = get_payment_endpoint()?;
    let api_access_key = get_api_access_key()?;

    // Generate UUID for instance name
    let instance_name = Uuid::new_v4().to_string();
    let machine_id: String = app.machine_uid().get_machine_uid().unwrap().id.unwrap();
    let app_version: String = env!("CARGO_PKG_VERSION").to_string();
    // Prepare activation request
    let activation_request = ActivationRequest {
        license_key: license_key.clone(),
        instance_name: instance_name.clone(),
        machine_id: machine_id.clone(),
        app_version: app_version.clone(),
    };

    // Make HTTP request to activation endpoint with authorization header
    let client = reqwest::Client::new();
    let url = format!("{}/activate", payment_endpoint);

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_access_key))
        .json(&activation_request)
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!("{}", e);
            if error_msg.contains("url (") {
                // Remove the URL part from the error message
                let parts: Vec<&str> = error_msg.split(" for url (").collect();
                if parts.len() > 1 {
                    format!("Failed to make chat request: {}", parts[0])
                } else {
                    format!("Failed to make chat request: {}", error_msg)
                }
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        })?;

    let activation_response: ActivationResponse = response.json().await.map_err(|e| {
        let error_msg = format!("{}", e);
        if error_msg.contains("url (") {
            // Remove the URL part from the error message
            let parts: Vec<&str> = error_msg.split(" for url (").collect();
            if parts.len() > 1 {
                format!("Failed to make chat request: {}", parts[0])
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        } else {
            format!("Failed to make chat request: {}", error_msg)
        }
    })?;
    Ok(activation_response)
}

#[tauri::command]
pub async fn deactivate_license_api(app: AppHandle) -> Result<ActivationResponse, String> {
    // Get payment endpoint and API access key from environment
    let payment_endpoint = get_payment_endpoint()?;
    let api_access_key = get_api_access_key()?;
    let machine_id: String = app.machine_uid().get_machine_uid().unwrap().id.unwrap();
    let (license_key, instance_id, _) = get_stored_credentials(&app).await?;
    let app_version: String = env!("CARGO_PKG_VERSION").to_string();
    let deactivation_request = ActivationRequest {
        license_key: license_key.clone(),
        instance_name: instance_id.clone(),
        machine_id: machine_id.clone(),
        app_version: app_version.clone(),
    };
    // Make HTTP request to activation endpoint with authorization header
    let client = reqwest::Client::new();
    let url = format!("{}/deactivate", payment_endpoint);

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_access_key))
        .json(&deactivation_request)
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!("{}", e);
            if error_msg.contains("url (") {
                // Remove the URL part from the error message
                let parts: Vec<&str> = error_msg.split(" for url (").collect();
                if parts.len() > 1 {
                    format!("Failed to make chat request: {}", parts[0])
                } else {
                    format!("Failed to make chat request: {}", error_msg)
                }
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        })?;
    let deactivation_response: ActivationResponse = response.json().await.map_err(|e| {
        let error_msg = format!("{}", e);
        if error_msg.contains("url (") {
            // Remove the URL part from the error message
            let parts: Vec<&str> = error_msg.split(" for url (").collect();
            if parts.len() > 1 {
                format!("Failed to make chat request: {}", parts[0])
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        } else {
            format!("Failed to make chat request: {}", error_msg)
        }
    })?;
    Ok(deactivation_response)
}

#[tauri::command]
pub async fn validate_license_api(app: AppHandle) -> Result<ValidateResponse, String> {
    // Get payment endpoint and API access key from environment
    let payment_endpoint = get_payment_endpoint()?;
    let api_access_key = get_api_access_key()?;
    let machine_id: String = app.machine_uid().get_machine_uid().unwrap().id.unwrap();
    let (license_key, instance_id, _) = get_stored_credentials(&app).await?;
    let app_version: String = env!("CARGO_PKG_VERSION").to_string();
    let validate_request = ActivationRequest {
        license_key: license_key.clone(),
        instance_name: instance_id.clone(),
        machine_id: machine_id.clone(),
        app_version: app_version.clone(),
    };

    if license_key.is_empty() || instance_id.is_empty() {
        return Ok(ValidateResponse {
            is_active: false,
            last_validated_at: None,
            is_dev_license: false,
        });
    }

    // Make HTTP request to validate endpoint with authorization header
    let client = reqwest::Client::new();
    let url = format!("{}/validate", payment_endpoint);

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_access_key))
        .json(&validate_request)
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!("{}", e);
            if error_msg.contains("url (") {
                // Remove the URL part from the error message
                let parts: Vec<&str> = error_msg.split(" for url (").collect();
                if parts.len() > 1 {
                    format!("Failed to make chat request: {}", parts[0])
                } else {
                    format!("Failed to make chat request: {}", error_msg)
                }
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        })?;

    let validate_response: ValidateResponse = response.json().await.map_err(|e| {
        let error_msg = format!("{}", e);
        if error_msg.contains("url (") {
            // Remove the URL part from the error message
            let parts: Vec<&str> = error_msg.split(" for url (").collect();
            if parts.len() > 1 {
                format!("Failed to make chat request: {}", parts[0])
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        } else {
            format!("Failed to make chat request: {}", error_msg)
        }
    })?;
    Ok(validate_response)
}

#[tauri::command]
pub fn mask_license_key_cmd(license_key: String) -> String {
    if license_key.len() <= 8 {
        return "*".repeat(license_key.len());
    }

    let first_four = &license_key[..4];
    let last_four = &license_key[license_key.len() - 4..];
    let middle_stars = "*".repeat(license_key.len() - 8);

    format!("{}{}{}", first_four, middle_stars, last_four)
}

#[tauri::command]
pub async fn get_checkout_url() -> Result<CheckoutResponse, String> {
    // Get payment endpoint and API access key from environment
    let payment_endpoint = get_payment_endpoint()?;
    let api_access_key = get_api_access_key()?;

    // Make HTTP request to checkout endpoint with authorization header
    let client = reqwest::Client::new();
    let url = format!("{}/checkout", payment_endpoint);

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_access_key))
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!("{}", e);
            if error_msg.contains("url (") {
                // Remove the URL part from the error message
                let parts: Vec<&str> = error_msg.split(" for url (").collect();
                if parts.len() > 1 {
                    format!("Failed to make chat request: {}", parts[0])
                } else {
                    format!("Failed to make chat request: {}", error_msg)
                }
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        })?;

    let checkout_response: CheckoutResponse = response.json().await.map_err(|e| {
        let error_msg = format!("{}", e);
        if error_msg.contains("url (") {
            // Remove the URL part from the error message
            let parts: Vec<&str> = error_msg.split(" for url (").collect();
            if parts.len() > 1 {
                format!("Failed to make chat request: {}", parts[0])
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        } else {
            format!("Failed to make chat request: {}", error_msg)
        }
    })?;
    Ok(checkout_response)
}
