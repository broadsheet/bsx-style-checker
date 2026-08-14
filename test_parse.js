function parseGeminiJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    try {
      let cleaned = text.trim();
      cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      
      // Fix bad unicode escapes by doubling the backslash if not followed by 4 hex digits
      cleaned = cleaned.replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u");
      
      // Fix unescaped control characters
      cleaned = cleaned.replace(/[\u0000-\u001F]/g, function (match) {
        return '\\u' + ('0000' + match.charCodeAt(0).toString(16)).slice(-4);
      });
      return JSON.parse(cleaned);
    } catch (err) {
      console.error('Failed to parse Gemini JSON output', err.message);
      throw err;
    }
  }
}
console.log(parseGeminiJSON('{"test": "bad \\u escape"}'));
