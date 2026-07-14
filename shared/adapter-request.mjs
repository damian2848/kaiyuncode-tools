import { redactSensitive } from "./redaction.mjs";

const ALLOWED_SUBMIT_PATHS = new Set([
  "/v1/images/async/generations",
  "/v1/images/async/edits",
  "/v1/videos",
]);
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function safeClone(value, seen = new Map()) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Blob) return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) result.push(safeClone(item, seen));
    return result;
  }
  const result = Object.create(null);
  seen.set(value, result);
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(result, key, {
      value: safeClone(child, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function coerceValue(value, type) {
  if (type === "string") {
    if (typeof value !== "string") throw new Error("Adapter parameter must be a string");
    return value;
  }
  if (type === "number" || type === "integer") {
    if (typeof value !== "number" && typeof value !== "string") {
      throw new Error(`Adapter parameter must be a ${type}`);
    }
    if (typeof value === "string" && value.trim() === "") {
      throw new Error(`Adapter parameter must be a ${type}`);
    }
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || (type === "integer" && !Number.isInteger(parsed))) {
      throw new Error(`Adapter parameter must be a ${type}`);
    }
    return parsed;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error("Adapter parameter must be a boolean");
  }
  if (type === "string[]") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error("Adapter parameter must be an array of strings");
    }
    return safeClone(value);
  }
  if (type === "object[]" || /^Array<\{/u.test(type)) {
    if (
      !Array.isArray(value) ||
      value.some((item) => !item || typeof item !== "object" || Array.isArray(item))
    ) {
      throw new Error("Adapter parameter must be an array of objects");
    }
    return safeClone(value);
  }
  throw new Error(`Invalid adapter parameter type: ${type}`);
}

function parameterSegments(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Invalid adapter parameter path");
  }
  return name.split(".").map((segment) => {
    const key = segment.replace(/\[\]$/u, "");
    if (!key || UNSAFE_PATH_SEGMENTS.has(key)) {
      throw new Error(`unsafe adapter parameter path: ${name}`);
    }
    return { key, array: segment.endsWith("[]") };
  });
}

function setParameterPath(target, name, value) {
  const segments = parameterSegments(name);
  let cursor = target;
  for (let index = 0; index < segments.length; index += 1) {
    const { key, array } = segments[index];
    const last = index === segments.length - 1;
    if (last) {
      if (array && !Array.isArray(value)) {
        throw new Error(`Adapter parameter ${name} must be an array`);
      }
      Object.defineProperty(cursor, key, {
        value: safeClone(value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return;
    }
    if (array) {
      if (!Object.hasOwn(cursor, key) || !Array.isArray(cursor[key]) || cursor[key].length === 0) {
        throw new Error(
          `Adapter parameter ${name} requires its parent array to be provided`,
        );
      }
      const remaining = segments
        .slice(index + 1)
        .map((segment) => `${segment.key}${segment.array ? "[]" : ""}`)
        .join(".");
      for (const item of cursor[key]) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error(`Adapter parameter ${name} has a non-object parent`);
        }
        setParameterPath(item, remaining, value);
      }
      return;
    }
    if (
      !Object.hasOwn(cursor, key) ||
      !cursor[key] ||
      typeof cursor[key] !== "object" ||
      Array.isArray(cursor[key])
    ) {
      Object.defineProperty(cursor, key, {
        value: Object.create(null),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    cursor = cursor[key];
  }
}

function isLocalPath(value) {
  return (
    /^(?:\.{0,2}\/|~\/|[A-Za-z]:[\\/])/u.test(value) ||
    value.startsWith("file:") ||
    (!/^[a-z][a-z0-9+.-]*:/iu.test(value) &&
      /(?:[\\/]|\.(?:png|jpe?g|webp|gif|avif|mp4|mov|webm|mpe?g|mp3|wav|m4a|aac|flac))$/iu.test(
        value,
      ))
  );
}

function containsLocalMediaPath(value, key = "") {
  if (typeof value === "string") {
    return isLocalPath(value) &&
      /(?:url|image|video|audio|media|mask|file)/iu.test(key);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsLocalMediaPath(item, key));
  }
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([childKey, childValue]) =>
    containsLocalMediaPath(childValue, childKey),
  );
}

function normalizeFiles(files) {
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files)) throw new Error("files must be an array");
  return files.map((file) => {
    if (
      !file ||
      typeof file.field !== "string" ||
      !(file.data instanceof Blob)
    ) {
      throw new Error("Each file requires a field and Blob data");
    }
    return {
      field: file.field,
      data: file.data,
      filename:
        typeof file.filename === "string" && file.filename.length > 0
          ? file.filename.split(/[\\/]/u).at(-1)
          : "upload.bin",
      inline: file.inline === true,
      kind:
        typeof file.kind === "string" && file.kind.length > 0
          ? file.kind
          : undefined,
    };
  });
}

function isMultipartUploadField(field) {
  return typeof field.value === "string" && field.value.startsWith("@");
}

function multipartUploadFields(variant) {
  return variant.fields.filter(isMultipartUploadField);
}

function parameterMatchesField(parameter, fieldName) {
  if (parameter.name.replace(/\[\]$/u, "") === fieldName) return true;
  const segments = parameterSegments(parameter.name);
  return segments.at(-1)?.key === fieldName;
}

function multipartSupportsFiles(variant, files) {
  const uploadNames = new Set(multipartUploadFields(variant).map(({ name }) => name));
  return files.every(({ field }) => uploadNames.has(field));
}

function multipartSupportsScalars(variant, resolved) {
  for (const parameter of resolved) {
    if (!parameter.provided || !parameter.present) continue;
    const matchingFields = variant.fields.filter(({ name }) =>
      parameterMatchesField(parameter, name),
    );
    if (matchingFields.length === 0) continue;
    if (matchingFields.every(isMultipartUploadField)) return false;
    if (
      parameter.repeatedScalar &&
      parameter.value.length >
        matchingFields.filter((field) => !isMultipartUploadField(field)).length
    ) {
      return false;
    }
    if (
      typeof parameter.value === "string" &&
      isLocalPath(parameter.value) &&
      matchingFields.some((field) => !isMultipartUploadField(field))
    ) {
      return false;
    }
  }
  return true;
}

function uploadDistance(variant, files) {
  const provided = new Map();
  for (const { field } of files) {
    provided.set(field, (provided.get(field) ?? 0) + 1);
  }
  const documented = new Map();
  for (const { name } of multipartUploadFields(variant)) {
    documented.set(name, (documented.get(name) ?? 0) + 1);
  }
  let distance = 0;
  for (const [name, count] of documented) {
    distance += Math.abs(count - (provided.get(name) ?? 0));
  }
  return distance;
}

function selectVariant(adapter, resolved, files) {
  const variants = Array.isArray(adapter?.requestVariants)
    ? adapter.requestVariants
    : [];
  let variant = null;
  if (files.length > 0) {
    variant = variants
      .filter(
        (candidate) =>
          candidate.kind === "multipart" &&
          Array.isArray(candidate.fields) &&
          multipartSupportsFiles(candidate, files),
      )
      .sort((left, right) => uploadDistance(left, files) - uploadDistance(right, files))[0];
  } else {
    variant = variants.find((candidate) => candidate.kind === "json") ?? null;
    if (!variant) {
      variant = variants
        .filter(
          (candidate) =>
            candidate.kind === "multipart" &&
            Array.isArray(candidate.fields) &&
            multipartSupportsScalars(candidate, resolved),
        )
        .sort(
          (left, right) =>
            multipartUploadFields(left).length - multipartUploadFields(right).length,
        )[0];
    }
  }
  if (!variant) {
    if (files.length > 0) {
      const allUploadNames = new Set(
        variants
          .filter((candidate) => candidate.kind === "multipart")
          .flatMap((candidate) => multipartUploadFields(candidate).map(({ name }) => name)),
      );
      const invalidFile = files.find(({ field }) => !allUploadNames.has(field));
      if (invalidFile) {
        throw new Error(
          `Multipart field ${invalidFile.field} is not a documented upload field`,
        );
      }
    }
    throw new Error(
      files.length > 0
        ? "Local media paths require a multipart request"
        : "Adapter has no supported request variant",
    );
  }
  if (
    variant.method !== "POST" ||
    !ALLOWED_SUBMIT_PATHS.has(variant.path)
  ) {
    throw new Error("Adapter request is not an allowed asynchronous submission");
  }
  return variant;
}

function resolveParameters(adapter, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("values must be an object");
  }
  const parameters = Array.isArray(adapter?.parameters) ? adapter.parameters : [];
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  for (const name of Object.keys(values)) {
    if (!byName.has(name)) throw new Error(`Unknown adapter parameter: ${name}`);
  }
  if (Object.hasOwn(values, "model") && values.model !== adapter.model) {
    throw new Error("The model parameter cannot override the selected adapter");
  }
  return parameters.map((parameter) => {
    const provided = Object.hasOwn(values, parameter.name);
    const rawValue = provided ? values[parameter.name] : parameter.defaultValue;
    const present = rawValue !== undefined && rawValue !== null && rawValue !== "-";
    const repeatedScalar =
      present && parameter.type === "string" && Array.isArray(rawValue);
    if (
      repeatedScalar &&
      (rawValue.length === 0 || rawValue.some((item) => typeof item !== "string"))
    ) {
      throw new Error("Repeated adapter scalar must be a non-empty array of strings");
    }
    return {
      ...parameter,
      provided,
      present,
      repeatedScalar,
      value: present
        ? repeatedScalar
          ? safeClone(rawValue)
          : coerceValue(rawValue, parameter.type)
        : undefined,
    };
  });
}

function buildJsonRequest(adapter, variant, resolved) {
  const body = safeClone(variant.template ?? {});
  for (const parameter of resolved) {
    if (!parameter.present) continue;
    if (parameter.repeatedScalar) {
      throw new Error("Repeated scalar values require documented multipart fields");
    }
    const segments = parameterSegments(parameter.name);
    const rootAlias = segments.at(-1)?.key;
    if (
      segments.length > 1 &&
      Object.hasOwn(body, rootAlias) &&
      body[rootAlias] === coerceValue(parameter.defaultValue, parameter.type)
    ) {
      body[rootAlias] = safeClone(parameter.value);
    }
    setParameterPath(body, parameter.name, parameter.value);
  }
  body.model = adapter.model;
  if (containsLocalMediaPath(body)) {
    throw new Error("Local media paths require a multipart request");
  }
  return {
    method: variant.method,
    path: variant.path,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function candidateForField(fieldName, resolved) {
  const normalizedField = fieldName.replace(/\[\]$/u, "");
  const exact = resolved.find(
    (parameter) =>
      parameter.name.replace(/\[\]$/u, "") === normalizedField,
  );
  if (exact) return exact;
  const leafMatches = resolved.filter((parameter) => {
    const segments = parameterSegments(parameter.name);
    return segments.at(-1)?.key === normalizedField;
  });
  return leafMatches.length === 1 ? leafMatches[0] : null;
}

function nestedFieldValue(fieldName, resolved) {
  const matches = resolved.filter((parameter) =>
    parameter.name.startsWith(`${fieldName}.`),
  );
  if (matches.length === 0) return undefined;
  const result = Object.create(null);
  for (const parameter of matches) {
    if (!parameter.present) continue;
    setParameterPath(
      result,
      parameter.name.slice(fieldName.length + 1),
      parameter.value,
    );
  }
  return Object.keys(result).length > 0 ? JSON.stringify(result) : undefined;
}

function promptFromMessages(resolved) {
  const messages = resolved.find(
    (parameter) => parameter.name === "messages[]" && parameter.present,
  )?.value;
  const content = messages?.[0]?.content;
  if (typeof content === "string" && content.length > 0) return content;
  if (Array.isArray(content)) {
    return content.find((item) => typeof item?.text === "string")?.text;
  }
  return undefined;
}

function appendFormValue(form, name, value) {
  if (Array.isArray(value)) {
    for (const item of value) appendFormValue(form, name, item);
    return;
  }
  form.append(
    name,
    value && typeof value === "object" ? JSON.stringify(value) : String(value),
  );
}

function buildMultipartRequest(adapter, variant, resolved, files) {
  const documentedFields = new Set(variant.fields.map(({ name }) => name));
  const uploadFields = new Set(
    variant.fields
      .filter(({ value }) => typeof value === "string" && value.startsWith("@"))
      .map(({ name }) => name),
  );
  for (const file of files) {
    if (!documentedFields.has(file.field) || !uploadFields.has(file.field)) {
      throw new Error(`Multipart field ${file.field} is not a documented upload field`);
    }
  }
  const fileFields = new Set(files.map(({ field }) => field));
  const form = new FormData();
  const appendedParameters = new Set();
  for (const field of variant.fields) {
    if (field.name === "model") {
      form.append("model", adapter.model);
      continue;
    }
    if (fileFields.has(field.name)) {
      const parameter = candidateForField(field.name, resolved);
      if (parameter?.present) appendedParameters.add(parameter.name);
      continue;
    }
    if (typeof field.value === "string" && field.value.startsWith("@")) {
      continue;
    }
    const parameter = candidateForField(field.name, resolved);
    if (parameter?.present && appendedParameters.has(parameter.name)) continue;
    const value = parameter?.present
      ? parameter.value
      : nestedFieldValue(field.name, resolved) ??
        (field.name === "prompt" ? promptFromMessages(resolved) : undefined) ??
        field.value;
    if (parameter?.present) appendedParameters.add(parameter.name);
    if (value !== undefined) appendFormValue(form, field.name, value);
  }
  for (const parameter of resolved) {
    if (
      !parameter.provided ||
      !parameter.present ||
      appendedParameters.has(parameter.name) ||
      parameter.name === "model"
    ) {
      continue;
    }
    appendFormValue(form, parameter.name.replace(/\[\]$/u, ""), parameter.value);
  }
  for (const file of files) {
    form.append(file.field, file.data, file.filename);
  }
  return {
    method: variant.method,
    path: variant.path,
    headers: {},
    body: form,
  };
}

export function buildAdapterRequest(adapter, values = {}, files = []) {
  if (!adapter || typeof adapter.model !== "string") {
    throw new Error("Invalid adapter");
  }
  const normalizedFiles = normalizeFiles(files);
  const inlineFiles = normalizedFiles.filter(({ inline }) => inline);
  const uploadFiles = normalizedFiles.filter(({ inline }) => !inline);
  const resolved = resolveParameters(adapter, values);
  const variant = selectVariant(adapter, resolved, uploadFiles);
  const request =
    variant.kind === "json"
      ? buildJsonRequest(adapter, variant, resolved)
      : buildMultipartRequest(adapter, variant, resolved, uploadFiles);
  const summaryBody =
    request.body instanceof FormData
      ? request.body
      : JSON.parse(request.body);
  const summary = redactSensitive({
    method: request.method,
    path: request.path,
    headers: request.headers,
    body: summaryBody,
  });
  if (inlineFiles.length > 0) {
    summary.localResources = inlineFiles.map(({ filename, data, kind }) => ({
      type: kind ?? "file",
      name: filename,
      size: data.size,
    }));
  }
  return {
    ...request,
    summary,
  };
}
