const CODEX_ROOT_FIELDS = [
  ["model_provider", '"kaiyuncode"'],
  ["model", null],
  ["model_reasoning_effort", '"xhigh"'],
  ["disable_response_storage", "true"],
  ["model_verbosity", '"high"'],
  ["network_access", "true"],
  ["web_search", '"live"'],
];

const CODEX_PROVIDER_FIELDS = [
  ["name", '"kaiyuncode"'],
  ["base_url", '"https://kaiyuncode.com/v1"'],
  ["wire_api", '"responses"'],
  ["requires_openai_auth", "true"],
];

function assertIdentifier(value, label = "model") {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be a nonempty identifier`);
  }
  return value;
}

function splitLines(source) {
  return source.match(/.*?(?:\r\n|\n|$)/gu)?.filter((line) => line !== "") ?? [];
}

function lineEnding(source) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function lineBody(line) {
  return line.replace(/\r?\n$/u, "");
}

function lineEol(line) {
  return line.match(/\r?\n$/u)?.[0] ?? "";
}

function stripTomlComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "#") return line.slice(0, index);
  }
  return line;
}

function assignmentParts(line) {
  const body = stripTomlComment(lineBody(line));
  let quote = null;
  let escaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "=") {
      const key = body.slice(0, index).trim();
      return key ? { key, value: body.slice(index + 1) } : null;
    }
  }
  return null;
}

function parseKeyPath(input) {
  const segments = [];
  let index = 0;
  while (index < input.length) {
    while (/\s/u.test(input[index] ?? "")) index += 1;
    let segment = "";
    const quote = input[index] === '"' || input[index] === "'" ? input[index++] : null;
    if (quote) {
      let closed = false;
      while (index < input.length) {
        const character = input[index++];
        if (character === quote) {
          closed = true;
          break;
        }
        if (quote === '"' && character === "\\") {
          const escaped = input[index++];
          if (escaped === undefined) return null;
          const simpleEscapes = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
          if (Object.hasOwn(simpleEscapes, escaped)) segment += simpleEscapes[escaped];
          else if (escaped === "u" || escaped === "U") {
            const length = escaped === "u" ? 4 : 8;
            const hexadecimal = input.slice(index, index + length);
            if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`, "u").test(hexadecimal)) return null;
            const codePoint = Number.parseInt(hexadecimal, 16);
            if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
            segment += String.fromCodePoint(codePoint);
            index += length;
          } else return null;
        } else segment += character;
      }
      if (!closed) return null;
    } else {
      while (index < input.length && input[index] !== "." && !/\s/u.test(input[index])) {
        segment += input[index++];
      }
      if (!/^[A-Za-z0-9_-]+$/u.test(segment)) return null;
    }
    if (!segment) return null;
    segments.push(segment);
    while (/\s/u.test(input[index] ?? "")) index += 1;
    if (index === input.length) break;
    if (input[index] !== ".") return null;
    index += 1;
  }
  return segments;
}

function tablePath(line) {
  const body = stripTomlComment(lineBody(line)).trim();
  const array = body.startsWith("[[") && body.endsWith("]]");
  const ordinary = body.startsWith("[") && body.endsWith("]") && !array;
  if (!ordinary && !array) return null;
  const inner = array ? body.slice(2, -2) : body.slice(1, -1);
  return { array, path: parseKeyPath(inner) };
}

function findCommentSuffix(line) {
  const body = lineBody(line);
  let quote = null;
  let escaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote === '"' && escaped) escaped = false;
    else if (quote === '"' && character === "\\") escaped = true;
    else if (quote && character === quote) quote = null;
    else if (!quote && (character === '"' || character === "'")) quote = character;
    else if (!quote && character === "#") {
      let suffixStart = index;
      while (suffixStart > 0 && /[ \t]/u.test(body[suffixStart - 1])) suffixStart -= 1;
      return body.slice(suffixStart);
    }
  }
  return "";
}

function replacementLine(original, key, value, fallbackEol) {
  const comment = findCommentSuffix(original);
  return `${key} = ${value}${comment}${lineEol(original) || fallbackEol}`;
}

function samePath(path, expected) {
  return path?.length === expected.length && path.every((part, index) => part === expected[index]);
}

function escapedAt(source, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function scanTomlLexicalLine(line, state) {
  const body = lineBody(line);
  let index = 0;
  while (index < body.length) {
    if (state.multiline) {
      const delimiter = state.multiline;
      const found = body.indexOf(delimiter, index);
      if (found === -1) return;
      if (delimiter === '"""' && escapedAt(body, found)) {
        index = found + 1;
        continue;
      }
      state.multiline = null;
      index = found + delimiter.length;
      continue;
    }

    const character = body[index];
    if (character === "#") return;
    if (body.startsWith('"""', index) || body.startsWith("'''", index)) {
      state.multiline = body.slice(index, index + 3);
      index += 3;
      continue;
    }
    if (character === '"') {
      index += 1;
      while (index < body.length) {
        if (body[index] === "\\") index += 2;
        else if (body[index++] === '"') break;
      }
      continue;
    }
    if (character === "'") {
      const close = body.indexOf("'", index + 1);
      index = close === -1 ? body.length : close + 1;
      continue;
    }
    if (character === "[") state.squareDepth += 1;
    else if (character === "]") state.squareDepth -= 1;
    else if (character === "{") state.curlyDepth += 1;
    else if (character === "}") state.curlyDepth -= 1;
    if (state.squareDepth < 0 || state.curlyDepth < 0) throw new Error("Ambiguous TOML container syntax");
    index += 1;
  }
}

export function mergeCodexConfig(source, { model, catalogPath } = {}) {
  if (typeof source !== "string") throw new TypeError("Codex config must be TOML text");
  const selectedModel = assertIdentifier(model);
  const managedFields = new Map(CODEX_ROOT_FIELDS);
  if (catalogPath !== undefined) {
    if (typeof catalogPath !== "string" || !catalogPath.trim() || /[\u0000-\u001f]/u.test(catalogPath)) throw new Error("Invalid model catalog path");
    managedFields.set("model_catalog_json", JSON.stringify(catalogPath));
    // These global overrides would mask per-model catalog settings on /model changes.
    for (const key of ["model_reasoning_effort", "model_context_window", "model_auto_compact_token_limit", "model_verbosity", "model_supports_reasoning_summaries", "model_reasoning_summary"]) managedFields.set(key, null);
  }
  const eol = lineEnding(source);
  const lines = splitLines(source);
  const rootFields = new Map([...managedFields.keys()].map((key) => [key, []]));
  const providerFields = new Map(CODEX_PROVIDER_FIELDS.map(([key]) => [key, []]));
  let currentTable = null;
  let currentTablePath = null;
  let providerHeaderIndex = null;
  let providerEndIndex = lines.length;
  const lexical = { multiline: null, squareDepth: 0, curlyDepth: 0 };

  for (let index = 0; index < lines.length; index += 1) {
    if (lexical.multiline || lexical.squareDepth > 0 || lexical.curlyDepth > 0) {
      scanTomlLexicalLine(lines[index], lexical);
      continue;
    }
    const table = tablePath(lines[index]);
    if (table) {
      if (!table.path) throw new Error("Ambiguous TOML table syntax");
      if (rootFields.has(table.path[0])) {
        throw new Error("Ambiguous table conflicts with a target Codex root field");
      }
      currentTablePath = table.path;
      if (samePath(table.path, ["model_providers", "kaiyuncode"])) {
        if (table.array) throw new Error("Ambiguous KaiyunCode provider array table");
        if (providerHeaderIndex !== null) throw new Error("Duplicate KaiyunCode provider table");
        providerHeaderIndex = index;
        currentTable = "provider";
      } else {
        if (providerHeaderIndex !== null && providerEndIndex === lines.length) providerEndIndex = index;
        currentTable = "other";
      }
      continue;
    }

    const assignment = assignmentParts(lines[index]);
    if (!assignment) {
      scanTomlLexicalLine(lines[index], lexical);
      continue;
    }
    const path = parseKeyPath(assignment.key);
    if (!path) throw new Error("Ambiguous TOML assignment syntax");
    const targetsRoot = currentTable === null && path.length === 1 && rootFields.has(path[0]);
    const targetsProvider = currentTable === "provider" && path.length === 1 && providerFields.has(path[0]);
    if (currentTable === null) {
      if (path.length > 1 && rootFields.has(path[0])) {
        throw new Error("Ambiguous dotted key conflicts with a target Codex root field");
      }
      if (path.length > 1 && samePath(path.slice(0, 2), ["model_providers", "kaiyuncode"])) {
        throw new Error("Ambiguous dotted KaiyunCode provider configuration");
      }
      if (path.length === 1 && path[0] === "model_providers") {
        throw new Error("Ambiguous inline model provider configuration");
      }
      if (path.length === 1 && rootFields.has(path[0])) rootFields.get(path[0]).push(index);
    } else if (currentTable === "provider") {
      if (path.length > 1 && providerFields.has(path[0])) {
        throw new Error("Ambiguous dotted key in KaiyunCode provider table");
      }
      if (providerFields.has(path[0])) providerFields.get(path[0]).push(index);
    } else if (samePath(currentTablePath, ["model_providers"])) {
      if (path[0] === "kaiyuncode") {
        throw new Error("Ambiguous inline or dotted KaiyunCode provider configuration");
      }
    }
    scanTomlLexicalLine(lines[index], lexical);
    if ((targetsRoot || targetsProvider) && (lexical.multiline || lexical.squareDepth > 0 || lexical.curlyDepth > 0)) {
      throw new Error("Ambiguous multiline value for a target Codex field");
    }
  }
  if (lexical.multiline || lexical.squareDepth > 0 || lexical.curlyDepth > 0) {
    throw new Error("Ambiguous unterminated multiline TOML value");
  }

  for (const indexes of [...rootFields.values(), ...providerFields.values()]) {
    if (indexes.length > 1) throw new Error("Duplicate target field in Codex configuration");
  }

  const rootValues = new Map(managedFields);
  rootValues.set("model", JSON.stringify(selectedModel));
  const providerValues = new Map(CODEX_PROVIDER_FIELDS);
  const replaced = [...lines];
  for (const [key, indexes] of rootFields) {
    if (indexes.length === 1) {
      const value = rootValues.get(key);
      const comment = findCommentSuffix(lines[indexes[0]]).trimStart();
      replaced[indexes[0]] = value === null ? (comment ? `${comment}${eol}` : "") : replacementLine(lines[indexes[0]], key, value, eol);
    }
  }
  for (const [key, indexes] of providerFields) {
    if (indexes.length === 1) replaced[indexes[0]] = replacementLine(lines[indexes[0]], key, providerValues.get(key), eol);
  }

  const missingRoot = [...rootValues].filter(([key, value]) => value !== null && rootFields.get(key).length === 0)
    .map(([key]) => `${key} = ${rootValues.get(key)}${eol}`);
  // Prepending missing root fields keeps every unrelated source byte contiguous.
  replaced.splice(0, 0, ...missingRoot);

  if (providerHeaderIndex === null) {
    if (replaced.length > 0 && !replaced.at(-1).endsWith(eol)) replaced[replaced.length - 1] += eol;
    if (replaced.length > 0 && lineBody(replaced.at(-1)) !== "") replaced.push(eol);
    replaced.push(`[model_providers.kaiyuncode]${eol}`);
    for (const [key, value] of CODEX_PROVIDER_FIELDS) replaced.push(`${key} = ${value}${eol}`);
  } else {
    const adjustedProviderEnd = providerEndIndex + missingRoot.length;
    const missingProvider = CODEX_PROVIDER_FIELDS.filter(([key]) => providerFields.get(key).length === 0)
      .map(([key, value]) => `${key} = ${value}${eol}`);
    if (
      missingProvider.length > 0 &&
      adjustedProviderEnd === replaced.length &&
      replaced.length > 0 &&
      !replaced.at(-1).endsWith(eol)
    ) {
      replaced[replaced.length - 1] += eol;
    }
    replaced.splice(adjustedProviderEnd, 0, ...missingProvider);
  }
  return replaced.join("");
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function mergeClaudeSettings(source, modelConfig = {}) {
  let parsed;
  if (typeof source === "string") {
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error("Claude settings JSON is invalid");
    }
  } else parsed = source;
  if (!plainObject(parsed)) throw new Error("Claude settings must be a JSON object");
  if (parsed.env !== undefined && !plainObject(parsed.env)) {
    throw new Error("Claude settings env must be a JSON object");
  }
  const apiKey = assertIdentifier(modelConfig.apiKey, "API Key");
  const model = assertIdentifier(modelConfig.model, "Claude model");
  const haikuModel = assertIdentifier(modelConfig.haikuModel ?? model, "Claude Haiku model");
  const sonnetModel = assertIdentifier(modelConfig.sonnetModel ?? model, "Claude Sonnet model");
  const opusModel = assertIdentifier(modelConfig.opusModel ?? model, "Claude Opus model");
  return {
    ...structuredClone(parsed),
    model,
    env: {
      ...(parsed.env ?? {}),
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_BASE_URL: "https://kaiyuncode.com",
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
    },
  };
}
