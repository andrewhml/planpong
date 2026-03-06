import type { Provider } from "./types.js";
export declare function getAvailableProviders(): Promise<Provider[]>;
export declare function getProvider(name: string): Provider | undefined;
export declare function getAllProviders(): Provider[];
