// Globaler Test-Setup. Pro Test wird eine eigene in-memory DB erzeugt
// (siehe Helpers in tests/services/*.test.ts), nicht hier global.
process.env.OPENAI_API_KEY = "test-key";
