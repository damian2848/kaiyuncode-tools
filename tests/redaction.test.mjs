import assert from "node:assert/strict";
import test from "node:test";

import { redactSensitive } from "../shared/redaction.mjs";

test("redaction removes authorization, token, and base64 values recursively", () => {
  const input = {
    headers: { Authorization: "Bearer auth-secret" },
    env: { KAIYUN_API_KEY: "key-secret" },
    nested: [{ b64_json: "a".repeat(400) }, { accessToken: "token-secret" }],
  };

  const result = redactSensitive(input);
  const serialized = JSON.stringify(result);

  for (const secret of ["auth-secret", "key-secret", "token-secret", "a".repeat(80)]) {
    assert.ok(!serialized.includes(secret));
  }
  assert.equal(result.headers.Authorization, "[REDACTED]");
  assert.equal(result.nested[0].b64_json, "[REDACTED BASE64]");
  assert.equal(input.headers.Authorization, "Bearer auth-secret");
});

test("redaction sanitizes bearer strings and sensitive URL query parameters", () => {
  const result = redactSensitive({
    message: "request used Bearer inline-secret",
    url: "https://cdn.example.test/result.png?token=url-secret&width=100",
  });
  const serialized = JSON.stringify(result);

  assert.ok(!serialized.includes("inline-secret"));
  assert.ok(!serialized.includes("url-secret"));
  assert.match(result.message, /Bearer \[REDACTED\]/);
  assert.match(result.url, /token=%5BREDACTED%5D/);
  assert.match(result.url, /width=100/);
});

test("redaction covers common CDN signed URL query families case-insensitively", () => {
  const signedUrls = [
    "https://azure.example.test/a.png?sig=azure-secret&foo=visible",
    "https://cloudfront.example.test/a.png?Policy=policy-secret&Key-Pair-Id=pair-secret&Expires=123&foo=visible",
    "https://s3.example.test/a.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=aws-secret&X-Amz-Signature=aws-signature&foo=visible",
    "https://storage.example.test/a.png?x-goog-algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=goog-secret&X-Goog-Signature=goog-signature&foo=visible",
  ];
  const result = redactSensitive(signedUrls);
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(
    serialized,
    /azure-secret|policy-secret|pair-secret|aws-secret|aws-signature|goog-secret|goog-signature|AWS4-HMAC-SHA256|GOOG4-RSA-SHA256/,
  );
  for (const url of result) {
    assert.match(url, /%5BREDACTED%5D/);
    assert.match(url, /foo=visible/);
  }
});

test("redaction summarizes binary and multipart values without reading content", () => {
  const form = new FormData();
  form.append("prompt", "hello");
  form.append("image", new Blob(["binary-secret"]), "input.png");

  const result = redactSensitive(form);
  const serialized = JSON.stringify(result);

  assert.deepEqual(result, {
    type: "FormData",
    fields: [
      { name: "prompt", value: "hello" },
      {
        name: "image",
        value: { type: "File", name: "input.png", size: 13 },
      },
    ],
  });
  assert.ok(!serialized.includes("binary-secret"));
});

test("redaction recognizes long unlabelled base64 payloads", () => {
  const base64 = Buffer.alloc(300, 7).toString("base64");
  const result = redactSensitive({ image: base64 });

  assert.equal(result.image, "[REDACTED BASE64]");
});

test("redaction sanitizes signed URLs and credential labels anywhere in strings", () => {
  const secretUrl = "https://cdn.example.test/out.png?token=url-secret&width=100";
  const result = redactSensitive(
    `failed at ${secretUrl}; Authorization: Basic auth-secret; KAIYUN_API_KEY=key-secret`,
  );

  assert.doesNotMatch(result, /url-secret|auth-secret|key-secret/);
  assert.match(result, /width=100/);
  assert.match(result, /Authorization: \[REDACTED\]/);
  assert.match(result, /KAIYUN_API_KEY=\[REDACTED\]/);
});

test("redaction handles Error causes, URL objects, FormData, shared and circular references", () => {
  const signed = "https://cdn.example.test/out.mp4?signature=signed-secret";
  const cause = new Error(`cause at ${signed}`);
  cause.cause = { apiKey: "cause-key-secret" };
  const error = new Error(`outer at ${signed}`, { cause });
  const form = new FormData();
  form.append("Authorization", "Bearer form-secret");
  const shared = { message: `shared ${signed}` };
  const input = {
    error,
    url: new URL(signed),
    form,
    first: shared,
    second: shared,
  };
  input.self = input;

  const result = redactSensitive(input);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /signed-secret|cause-key-secret|form-secret/,
  );
  assert.equal(result.self, "[Circular]");
  assert.equal(result.error.cause.name, "Error");
  assert.equal(result.error.cause.cause.apiKey, "[REDACTED]");
  assert.match(result.url, /signature=%5BREDACTED%5D/);
  assert.match(result.first.message, /signature=%5BREDACTED%5D/);
  assert.match(result.second.message, /signature=%5BREDACTED%5D/);
  assert.equal(result.form.fields[0].value, "[REDACTED]");
});

test("redaction removes double-quoted, single-quoted, and serialized JSON credentials", () => {
  const serialized = '{"apiKey":"json-secret","safe":"visible"}';
  const result = redactSensitive([
    'KAIYUN_API_KEY="double-secret"',
    "auth_token='single-secret'",
    serialized,
  ]);
  const output = JSON.stringify(result);

  assert.doesNotMatch(output, /double-secret|single-secret|json-secret/);
  assert.match(result[0], /KAIYUN_API_KEY="\[REDACTED\]"/);
  assert.match(result[1], /auth_token='\[REDACTED\]'/);
  assert.deepEqual(JSON.parse(result[2]), {
    apiKey: "[REDACTED]",
    safe: "visible",
  });
});

test("redaction removes quoted assignments from nested values and Error messages", () => {
  const result = redactSensitive({
    nested: { message: 'OPENAI_API_KEY="nested-secret"' },
    error: new Error("configuration: {\"authToken\":\"error-secret\"}"),
  });
  const output = JSON.stringify(result);

  assert.doesNotMatch(output, /nested-secret|error-secret/);
  assert.match(result.nested.message, /OPENAI_API_KEY="\[REDACTED\]"/);
  assert.match(result.error.message, /"authToken":"\[REDACTED\]"/);
});

test("redaction applies one prefixed credential-label rule across quote styles", () => {
  const input = [
    'ANTHROPIC_AUTH_TOKEN="anthropic-secret"',
    "MY_ACCESS_TOKEN='access-secret'",
    "OPENAI_API_KEY=api-secret",
    'client_secret="client-secret"',
    "INTERNAL_SECRET='internal-secret'",
    "serviceAuthToken=camel-secret",
  ];
  const result = redactSensitive(input);
  const output = JSON.stringify(result);

  assert.doesNotMatch(
    output,
    /anthropic-secret|access-secret|api-secret|client-secret|internal-secret|camel-secret/,
  );
  for (const item of result) assert.match(item, /\[REDACTED\]/);
});

test("redaction keeps serialized JSON siblings while removing prefixed credentials", () => {
  const serialized = JSON.stringify({
    ANTHROPIC_AUTH_TOKEN: "json-anthropic-secret",
    MY_ACCESS_TOKEN: "json-access-secret",
    SERVICE_API_KEY: "json-api-secret",
    client_secret: "json-client-secret",
    safe: "visible",
  });
  const result = redactSensitive(serialized);

  assert.doesNotMatch(
    result,
    /json-anthropic-secret|json-access-secret|json-api-secret|json-client-secret/,
  );
  assert.deepEqual(JSON.parse(result), {
    ANTHROPIC_AUTH_TOKEN: "[REDACTED]",
    MY_ACCESS_TOKEN: "[REDACTED]",
    SERVICE_API_KEY: "[REDACTED]",
    client_secret: "[REDACTED]",
    safe: "visible",
  });
});

test("redaction aligns object keys, nested strings, and Error credential labels", () => {
  const result = redactSensitive({
    env: {
      ANTHROPIC_AUTH_TOKEN: "object-anthropic-secret",
      MY_ACCESS_TOKEN: "object-access-secret",
      client_secret: "object-client-secret",
      safe: "visible",
    },
    nested: "THIRD_PARTY_AUTH_TOKEN=unquoted-secret",
    error: new Error('{"DEPLOY_SECRET":"error-secret","safe":"visible"}'),
  });
  const output = JSON.stringify(result);

  assert.doesNotMatch(
    output,
    /object-anthropic-secret|object-access-secret|object-client-secret|unquoted-secret|error-secret/,
  );
  assert.deepEqual(result.env, {
    ANTHROPIC_AUTH_TOKEN: "[REDACTED]",
    MY_ACCESS_TOKEN: "[REDACTED]",
    client_secret: "[REDACTED]",
    safe: "visible",
  });
  assert.match(result.nested, /THIRD_PARTY_AUTH_TOKEN=\[REDACTED\]/);
  assert.deepEqual(JSON.parse(result.error.message), {
    DEPLOY_SECRET: "[REDACTED]",
    safe: "visible",
  });
});
