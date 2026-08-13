# KaiyunCode Asynchronous Video API

This reference reflects the validated intersection of the production API
tutorial and public adapter catalog. Runtime request construction prefers a
live refresh of that intersection; the bundled JSON snapshot is the offline
fallback only. Every new task uses authenticated `GET /v1/models` for current
availability and public `GET /api/pricing` for current unit prices; neither
availability nor price falls back to the snapshot.

## Endpoint Allowlist

| Purpose | Method | Path |
| --- | --- | --- |
| Submit | POST | `/v1/videos` |
| Poll | GET | `/v1/videos/{task_id}` |

There is no synchronous video interface. A POST returns `task_id` or `id`; the
runner then polls with GET. A paid POST is submitted once and is never
automatically retried.

## Production Capabilities

| Capability key | Typical models | Input profile |
| --- | --- | --- |
| `video_capability_video_text_generation` | HappyHorse t2v, Wan t2v, Seedance, Kling, Grok, Omni Flash | Required prompt (`prompt` or `input.prompt`) |
| `video_capability_video_image_to_video` | HappyHorse i2v, Wan i2v, Seedance, Grok, Kling, Omni Flash | Required primary image via `image`, `image_url`, `input_reference`, `image_urls[]`, or `input.media[]` |
| `video_capability_video_multi_image_generation` | HappyHorse r2v, Wan r2v, Grok 1.5, Seedance, Omni Flash | Required prompt plus multiple image references |
| `video_capability_video_first_last_frame` | Wan i2v, Seedance, Kling | Required first image; Wan/Kling profiles use `input.prompt` and `input.media[]` with `first_frame` + `last_frame` |
| `video_capability_video_storyboard_generation` | Kling v3, Kling v3 Omni | Required `input.prompt`; storyboard fields are model-specific |
| `video_capability_video_reference_generation` | Wan r2v and Seedance | Reference images, videos, and audio where supported by the selected adapter |
| `video_capability_video_recreate` | HappyHorse video edit, Wan videoedit, Wan i2v | Required source video via `metadata.video` or `input.media[]`; prompt is profile-dependent |

The runner selects the exact adapter by capability key and model, then by
normalized parameter schema when a model has multiple profiles. This is schema
selection, not protocol inference from a model name.

## Nested Parameters

Many production adapters use dotted parameter names:

| Parameter | Meaning |
| --- | --- |
| `input.prompt` | Wan/Kling nested prompt |
| `input.media[]` | Array of `{ type, url, ... }` media objects |
| `metadata.resolution` / `metadata.ratio` / `metadata.duration` | HappyHorse metadata |
| `metadata.video` | Source video for HappyHorse edit |
| `input_reference` | Grok i2v object such as `{ "image_url": "https://..." }` |
| `reference_images` | Grok 1.5 multi-image array of `{ "url": "https://..." }` objects |
| `parameters.duration` / `parameters.mode` | Wan/Kling nested generation controls |
| `extra_images` / `extra_videos` / `extra_audios` | Seedance JSON reference arrays; the current tutorial does not use `[]` in these field names |

Use `--param input.prompt=...` or let `--prompt` remap to `input.prompt` when
the selected adapter documents only the nested form.

## Important Constraints

| Parameter family | Production constraints |
| --- | --- |
| Prompt fields | Required non-empty string when documented as required |
| Duration / seconds | Use only values or ranges listed by the selected adapter |
| Aspect / ratio | Use only ratios listed by the selected adapter |
| Resolution | Common values include `720P`/`1080P` or `720p` depending on adapter |
| Audio arrays | 本机音频或 HTTPS URL；数量遵循选定 adapter，部分 Seedance profile 要求和图片或视频搭配 |
| Video arrays | 本机视频或 HTTPS URL；数量遵循选定的参考素材 adapter |
| Reference images | 本机图片或 HTTPS URL；数量遵循选定 adapter |

The runner validates the actual parameter table attached to the exact adapter.
Do not treat this summary as permission to copy a parameter between models.

## Files And URLs

- `--image`、`--audio` 和 `--video` 都接受本机文件路径；Runner 会读取文件并封装为媒体负载，KaiyunCode 负责转存为上游需要的公网资源。
- 本机资源与远程资源可以混合使用；Runner 保留输入顺序以及首帧、尾帧、参考图、参考视频和参考音频语义。
- 用户主动提供远程资源时必须使用无内嵌凭据的 HTTPS URL；也支持对应媒体类型的 data URL。
- 直接调用底层 `values` 时不能只放一个本机路径字符串；应通过 CLI 参数或 jobs 的 `images`、`audios`、`videos` 字段交给 Runner 读取。
- Dry-run summaries contain only safe file metadata such as a basename, never the file contents or full local directory.

## CLI

```text
--capability KEY       Required exact capability key
--model MODEL          Required exact adapter model, checked via GET /v1/models
--prompt TEXT          Video prompt
--param KEY=VALUE      Repeat for adapter parameters (dotted keys allowed)
--image URL_OR_PATH    Repeat for local or remote image references
--audio URL_OR_PATH    Repeat for local or remote audio references
--video URL_OR_PATH    Repeat for local or remote video references
--task-id ID           Resume polling without a POST
--output PATH          Result destination
--credential-source S  Prefer env|file|codex|claude for this run
--list-models          List current compatible models and live prices (GET only)
--dry-run              Validate, perform two read-only GETs, and print a budget card
--json                 Print full JSON (includes confirmCard on dry-run)
```

Media credentials resolve as `env > file` (canonical `~/.codex/kaiyun-tools.env`).
Codex/Claude keys are fallback only when both are absent. Default dry-run
stdout is a human-readable confirmation card with public unit price, estimated
cost, and budget ceiling. Agents must paste it into chat before paid POST. If
the budget ceiling is unknown, confirm pricing before submission. Unit prices
are sourced only from `https://kaiyuncode.com/api/pricing`. Dry-run sends no
paid POST. A jobs-file batch shares one runtime catalog request round.
Model discovery can be filtered before planning with
`--list-models --capability KEY`; it never submits a paid POST.

Resume is independent of the original submission fields:

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --task-id vid_paid_123 \
  --output ./result.mp4
```

This path skips capability loading and POST request construction, resolves a
credential for GET polling, and persists the result.

API keys are deliberately not accepted as CLI arguments.

## Results

Polling accepts production URL shapes including `video_url`, `media_url`,
`result_url`, `metadata.url`, and `results[0].url`. URL results are downloaded
through a temporary sibling and atomically renamed. The returned object contains:

```json
{
  "taskId": "video_task_id",
  "status": "completed",
  "url": "https://cdn.example/result.mp4?token=%5BREDACTED%5D",
  "path": "/absolute/path/result.mp4"
}
```

Signed or sensitive query values are redacted from reporting.
