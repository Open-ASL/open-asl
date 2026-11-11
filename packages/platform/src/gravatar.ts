/** Gravatar accepts SHA-256 hashes of the trimmed, lowercased address; identicons stand in for the rest. */
export function gravatarUrl(hash: string, size = 128): string {
  return `https://gravatar.com/avatar/${hash}?d=identicon&s=${size}`;
}
