'use client';

// The NAMES of the secrets a workflow may reference — never their values.
//
// A module store for the same reason `use-panels-store` is one: the header
// control is registered at MODULE scope (in `JSON_FORM`, which the SDK requires
// to be a stable reference) and is mounted by the SDK's own tree inside
// `<PropertiesPanel />`. There is no props path from the page down to it, so the
// two sides meet here.
//
// ⚠️ WHAT MAY LIVE IN THIS STORE. Names only. It is client state — it reaches
// the browser, it is visible in React DevTools, and it survives in a heap
// snapshot. `listSecretNames` on the server is deliberately the only reader of
// the environment, and it returns keys with the values stripped; nothing may
// ever put a value into this store, which is why the type is `string[]` and not
// a map.
import { create } from 'zustand';

type SecretsStore = {
  /** Upper-snake names, sorted. Empty until the page sets them, and legitimately empty. */
  names: string[];
};

export const useSecretsStore = create<SecretsStore>()(() => ({ names: [] }));

export function setSecretNames(names: string[]) {
  useSecretsStore.setState({ names });
}
