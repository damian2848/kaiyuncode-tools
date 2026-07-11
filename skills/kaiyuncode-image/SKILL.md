---
name: kaiyuncode-image
description: Use when generating, editing, or composing images through a KaiyunCode asynchronous image model documented by the production tutorial, including dry-run request validation.
---

# KaiyunCode Image

KaiyunCode image generation is asynchronous only. Use the bundled runner for
adapter selection, validation, submission, polling, and atomic result storage.
Never assemble a request from a model name.

## First Use

1. Before onboarding or inspecting credentials, ask: "你是否已经有 KaiyunCode API Key？"
2. If the user does not have a key, guide them in order to [register or sign in](https://kaiyuncode.com/?login=1), [recharge](https://kaiyuncode.com/pricing), and [create a key](https://kaiyuncode.com/account/api-key). Wait for them to finish.
3. If the user already has a key, do not ask them to paste it in chat or put it on the command line. The runner resolves `KAIYUN_API_KEY`, an active KaiyunCode Codex login, or KaiyunCode Claude settings.

## Workflow

1. Identify one of the four capabilities in [the production adapter reference](references/api.md): text generation, edit, multi-reference, or sequential generation.
2. Select an exact model listed for that capability. `gpt-image-2-max` is retired and must never be offered or submitted.
3. Ask only for adapter-required values that are still missing. Use `--image` for each image URL or local edit file, `--mask` for a documented mask, and repeated `--param key=value` for optional adapter parameters.
4. Resolve this Skill's directory from this `SKILL.md`. Run the bundled CLI with `--dry-run` first and show the user its redacted request summary. All supported submit paths are asynchronous.
5. Before omitting `--dry-run`, explain that the next POST may incur charges and obtain fresh explicit authorization for this image task. Prior consent, installing the Skill, or asking for a dry-run is not authorization for a paid POST.
6. Run the same validated command without `--dry-run`. Let the runner submit once, GET-poll, and immediately store the URL or strict base64 result atomically. Do not construct, submit, retry, or download API results outside the runner.
7. Report the task ID, final status, redacted remote URL when present, and absolute local path. If polling times out, preserve the task ID and resume with `--task-id`; a resume performs no POST.

```bash
node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --capability image_text_generation \
  --model gpt-image-2 \
  --prompt "A clean product photo" \
  --output ./result.png \
  --dry-run
```

Resume needs only the preserved task ID and an optional output path. Do not
recollect the original model, prompt, or source files:

```bash
node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --task-id img_paid_123 \
  --output ./result.png
```

For a local edit, repeat `--image` only when the selected production adapter
documents repeated multipart image fields. JSON image fields accept only public
HTTPS URLs or image data URLs; never pass a local path in JSON.

## Stop Conditions

- Stop if no API Key is available, credential sources conflict, or the selected model/profile is absent from the bundled production intersection.
- Stop when validation reports a missing field, invalid type/range, too many references, or an undocumented file field. Do not infer another protocol from the model name.
- Never automatically retry a POST timeout, HTTP 429, or HTTP 5xx response because submission status and billing may be unknown.
- Do not run a real image request merely to test this Skill. Tests and routine verification use dry-run or injected mocks only.

Never place an API key in command-line arguments, logs, or chat output. Do not make a paid request without explicit user authorization.
