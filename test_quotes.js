function enforceSmartQuotes(str) {
  if (!str) return str;
  return str
    // First, convert backticks used as apostrophes/quotes into straight quotes so they get handled
    .replace(/`/g, "'")
    // Specific leading contractions
    .replace(/(^|[-\u2014\s(\["])(['‘])(90s|80s|70s|60s|00s|em|burb|nduja|cause|bout|til|n)\b/gi, "$1\u2019$3")
    // Left single quotes
    .replace(/(^|[-\u2014\s(\["])'/g, "$1\u2018")
    // All other straight single quotes become right single quotes (apostrophes or closing)
    .replace(/'/g, "\u2019")
    // Fix left-facing single quotes incorrectly used as apostrophes
    .replace(/([a-zA-Z])‘([a-zA-Z])/g, "$1\u2019$2")
    .replace(/([a-zA-Z])‘s\b/gi, "$1\u2019s")
    // Left double quotes
    .replace(/(^|[-\u2014\s(\['])"/g, "$1\u201C")
    // Right double quotes
    .replace(/"/g, "\u201D");
}
console.log(enforceSmartQuotes("Here is `a test` with 'em and 'bout and Nguyen`s firing."));
