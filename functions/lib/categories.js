// Shared deterministic category router — a hard fallback for when the LLM
// misclassifies. The demo cannot depend on the model always classifying
// "I moved to Berlin" as a location. Word-boundary matching only: `eat` must
// never match `seat`, `prefer` must never match `preference`.

export const ROUTE_KEYWORDS = {
  location: ['live', 'living', 'locate', 'located', 'move', 'moved', 'moving', 'city', 'hometown', 'home', 'address', 'where do i', 'visit', 'lives'],
  diet: ['eat', 'eating', 'food', 'meals', 'vegetarian', 'vegan', 'diet', 'restaurant', 'cooking', 'meat'],
  contact: ['email', 'phone', 'number', 'call', 'contact', 'reach'],
  preference: ['prefer', 'preference', 'like', 'favorite', 'favourite', 'seat', 'window', 'love', 'enjoy'],
};

function matchWord(q, word) {
  return new RegExp(`\\b${word}\\b`).test(q);
}

// Returns a category name when the text clearly mentions one, else null.
export function keywordCategory(text) {
  const q = String(text || '').toLowerCase();
  if (!q) return null;
  for (const [category, words] of Object.entries(ROUTE_KEYWORDS)) {
    if (words.some((w) => matchWord(q, w))) return category;
  }
  return null;
}

export function keywordRoute(question) {
  return {
    scope: 'user:default',
    category: keywordCategory(question),
    keywords: keywordCategory(question)
      ? ROUTE_KEYWORDS[keywordCategory(question)].filter((w) => matchWord(String(question).toLowerCase(), w))
      : [],
  };
}