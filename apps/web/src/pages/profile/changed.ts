// What a change by hand says once it is made (MVP 3, F2.3): how many of the profile's current
// roles it changes, counted by the server at once; the inbox shows them within a minute.

export function changedText(n: number): string {
  if (n === 0) return "Saved. It changes none of your current roles.";
  const roles = n === 1 ? "1 role" : `${n} roles`;
  return `Saved. It changes ${roles}; your inbox shows ${n === 1 ? "it" : "them"} within a minute.`;
}
