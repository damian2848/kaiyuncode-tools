---
name: kaiyuncode-video
description: Use when generating, extending, or recreating video through a KaiyunCode asynchronous video model documented by the production tutorial, including dry-run request validation.
---

# KaiyunCode Video

KaiyunCode video generation is asynchronous only. Use the bundled runner for
adapter selection, validation, submission, polling, and atomic result storage.
Never assemble a request from a model name.

## First Use

1. Before onboarding or inspecting credentials, ask: "你是否已经有 KaiyunCode API Key？"
2. If the user does not have a key, guide them in order to [register or sign in](https://kaiyuncode.com/?login=1), [recharge](https://kaiyuncode.com/pricing), and [create a key](https://kaiyuncode.com/account/api-key). Wait for them to finish.
3. If the user already has a key, do not ask them to paste it in chat or put it on the command line. The runner resolves `KAIYUN_API_KEY`, an active KaiyunCode Codex login, or KaiyunCode Claude settings.

## Workflow

1. Identify one of the eight capabilities in [the production adapter reference](references/api.md). Capability keys use the production form `video_capability_video_*`.
2. Select an exact model listed for that capability. Do not invent protocol from the model name.
3. Ask only for adapter-required values that are still missing. Use:
   - `--prompt` for text prompts (`prompt` or `input.prompt`)
   - repeated `--param key=value` for nested fields such as `metadata.resolution` or `parameters.duration`
   - `--image` / `--audio` / `--video` for documented media inputs (URL or local multipart file)
4. Resolve this Skill's directory from this `SKILL.md`. Run the bundled CLI with `--dry-run` first and show the user its redacted request summary.
5. Before omitting `--dry-run`, explain that the next POST may incur charges and obtain fresh explicit authorization for this video task. Prior consent, installing the Skill, or asking for a dry-run is not authorization for a paid POST.
6. Run the same validated command without `--dry-run`. Let the runner submit once, GET-poll `/v1/videos/{task_id}`, and store the result atomically. Do not construct, submit, retry, or download API results outside the runner.
7. Report the task ID, final status, redacted remote URL when present, and absolute local path. If polling times out, preserve the task ID and resume with `--task-id`; a resume performs no POST.

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --capability video_capability_video_text_generation \
  --model omni_flash \
  --prompt "A calm coastal drone shot at golden hour" \
  --output ./result.mp4 \
  --dry-run
```

Resume needs only the preserved task ID and an optional output path:

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --task-id vid_paid_123 \
  --output ./result.mp4
```

For image-to-video, reference, audio, or recreate flows, pass the media the selected adapter documents. JSON media fields accept only public HTTPS or data URLs; local files require a documented multipart field.

## Stop Conditions

- Stop if no API Key is available, credential sources conflict, or the selected model/profile is absent from the bundled production intersection.
- Stop when validation reports a missing field, invalid type/range, too many media items, or an undocumented file field.
- Never automatically retry a POST timeout, HTTP 429, or HTTP 5xx response because submission status and billing may be unknown.
- Do not run a real video request merely to test this Skill. Tests and routine verification use dry-run or injected mocks only.

Never place an API key in command-line arguments, logs, or chat output. Do not make a paid request without explicit user authorization.
