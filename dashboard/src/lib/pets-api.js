import { getLocalApiAuthHeaders } from "./local-api-auth";

export const BUILTIN_PETS = [
  { id: "clawd", displayName: "Clawd", nameKey: "pet.character.clawd", spriteVersionNumber: 1, custom: false },
  // No assetUrl: bot is drawn from the vector engine in lib/bot/, not a sprite atlas.
  { id: "bot", displayName: "Bot", nameKey: "pet.character.bot", spriteVersionNumber: 1, custom: false },
  { id: "sprout", displayName: "Sprout", nameKey: "pet.character.sprout", spriteVersionNumber: 1, custom: false, assetUrl: "/pets/sprout/spritesheet.webp" },
  { id: "byte", displayName: "Byte", nameKey: "pet.character.byte", spriteVersionNumber: 1, custom: false, assetUrl: "/pets/byte/spritesheet.webp" },
  { id: "ember", displayName: "Ember", nameKey: "pet.character.ember", spriteVersionNumber: 1, custom: false, assetUrl: "/pets/ember/spritesheet.webp" },
  // TT-plus 自有角色：名字走文案键，切语言时与界面同步；繁中保留原字，其余语言用英文名。
  { id: "gengxu", displayName: "Gengxu", nameKey: "pet.character.gengxu", spriteVersionNumber: 1, custom: false, assetUrl: "/pets/gengxu/spritesheet.webp" },
  { id: "yeacat", displayName: "YeaCat", nameKey: "pet.character.yeacat", spriteVersionNumber: 1, custom: false, assetUrl: "/pets/yeacat/spritesheet.webp" },
];

async function payload(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Pet request failed with HTTP ${response.status}`);
  }
  return data;
}

export async function listPets() {
  const response = await fetch("/functions/tokentracker-pets", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await payload(response);
  const hiddenBuiltinIds = new Set(
    Array.isArray(data.hiddenBuiltinIds) ? data.hiddenBuiltinIds : [],
  );
  const builtins = BUILTIN_PETS.filter((pet) => !pet.assetUrl || !hiddenBuiltinIds.has(pet.id));
  const builtinIds = new Set(builtins.map((pet) => pet.id));
  // Gengxu / YeaCat used to be user-installed packages. Now that they ship in
  // the app, a leftover copy in ~/.tokentracker/pets must not show up twice.
  const custom = (Array.isArray(data.pets) ? data.pets : []).filter((pet) => !builtinIds.has(pet?.id));
  return [...builtins, ...custom];
}

async function mutate(body) {
  const auth = await getLocalApiAuthHeaders();
  return payload(await fetch("/functions/tokentracker-pets", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...auth },
    cache: "no-store",
    body: JSON.stringify(body),
  }));
}

export function installPetFromUrl(url) {
  return mutate({ action: "install_url", url });
}

export async function importPetPackage(file) {
  const auth = await getLocalApiAuthHeaders();
  return payload(await fetch("/api/pets/import", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/zip", ...auth },
    cache: "no-store",
    body: file,
  }));
}

export function removePet(id) {
  return mutate({ action: "remove", id });
}

export async function listCodexImportable() {
  const response = await fetch("/functions/tokentracker-pets?scope=codex", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await payload(response);
  return {
    importable: Array.isArray(data.importable) ? data.importable : [],
    codexDetected: data.codexDetected === true,
  };
}

export function importCodexPets(ids) {
  return mutate({ action: "import_codex", ids });
}
