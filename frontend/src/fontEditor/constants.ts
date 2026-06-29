// Character sets for the Minimal-English coverage target and the symbol picker.
// Kept curated and small on purpose — no full Unicode database in the MVP.

export const LOWERCASE = "abcdefghijklmnopqrstuvwxyz".split("");
export const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export const DIGITS = "0123456789".split("");

/** Basic punctuation that is part of the required Minimal-English set. */
export const BASIC_PUNCTUATION = [".", ",", ";", ":", "!", "?", "'", '"', "(", ")", "-"];

/** Extra symbols offered in the picker but not required for coverage. */
export const EXTRA_SYMBOLS = [
  "/", "\\", "&", "@", "#", "%", "+", "=", "*", "_",
  "<", ">", "[", "]", "{", "}", "…", "—", "–", "€", "$",
];

/** Common ligatures/sequences suggested as multi-char keys. */
export const COMMON_LIGATURES = [
  "ff", "fi", "fl", "ffi", "ffl", "th", "st", "ch", "ck", "oo", "ee", "the", "and",
];

export interface SymbolGroup {
  id: string;
  labelKey: string;
  keys: string[];
}

export const SYMBOL_GROUPS: SymbolGroup[] = [
  { id: "lower", labelKey: "fontEditor.grpLower", keys: LOWERCASE },
  { id: "upper", labelKey: "fontEditor.grpUpper", keys: UPPERCASE },
  { id: "digits", labelKey: "fontEditor.grpDigits", keys: DIGITS },
  { id: "punct", labelKey: "fontEditor.grpPunct", keys: BASIC_PUNCTUATION },
  { id: "symbols", labelKey: "fontEditor.grpSymbols", keys: EXTRA_SYMBOLS },
  { id: "ligatures", labelKey: "fontEditor.grpLigatures", keys: COMMON_LIGATURES },
];

/** The Minimal-English mandatory coverage: a-z, A-Z, 0-9 and basic punctuation. */
export const REQUIRED_KEYS = [...LOWERCASE, ...UPPERCASE, ...DIGITS, ...BASIC_PUNCTUATION];
