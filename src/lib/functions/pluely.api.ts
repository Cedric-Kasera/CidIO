import { safeLocalStorage } from "../storage";
import { STORAGE_KEYS } from "@/config";

// Helper function to check if Pluely API should be used
export async function shouldUsePluelyAPI(): Promise<boolean> {
  try {
    // Check if Pluely API is enabled in localStorage
    const pluelyApiEnabled =
      safeLocalStorage.getItem(STORAGE_KEYS.PLUELY_API_ENABLED) === "true";
    return pluelyApiEnabled;
  } catch (error) {
    console.warn("Failed to check Pluely API availability:", error);
    return false;
  }
}
