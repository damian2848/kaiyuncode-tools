# KaiyunCode Asynchronous Video API

This reference reflects the bundled, validated intersection of the production
API tutorial and public model catalog. The bundled JSON snapshot remains the
machine-readable authority for request construction.

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
| `video_capability_video_text_generation` | HappyHorse t2v, Wan t2v, Kling, Grok, Omni Flash, video-pro | Required prompt (`prompt` or `input.prompt`); some Grok profiles also require `image_url` |
| `video_capability_video_image_to_video` | HappyHorse i2v, Wan i2v, Dreamina, Grok 1.5, Omni i2v | Required first-frame image via `image`, `image_url`, or `input.media[]` |
| `video_capability_video_first_last_frame` | `wan2.7-i2v` | Required `input.prompt` and `input.media[]` with `first_frame` + `last_frame` |
| `video_capability_video_continuation` | `wan2.7-i2v` | Required `input.prompt` and `input.media[]` with clip/frame continuation types |
| `video_capability_video_reference_generation` | HappyHorse r2v, Wan r2v, Omni components | Required prompt plus reference image arrays |
| `video_capability_video_image_audio_to_video` | `video-pro-720p`, `dreamina-mini` | Required prompt and image; optional/limited audio arrays |
| `video_capability_video_multimodal_to_video` | `wan2.7-r2v`, `video-pro-720p` | Multimodal image/video/audio combinations |
| `video_capability_video_recreate` | Omni edit, HappyHorse edit, Wan videoedit | Required source video plus prompt or `messages[]` |

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
| `parameters.duration` / `parameters.mode` / `parameters.watermark` | Nested generation controls |
| `messages[]` | Omni recreate chat-style instructions |

Use `--param input.prompt=...` or let `--prompt` remap to `input.prompt` when
the selected adapter documents only the nested form.

## Important Constraints

| Parameter family | Production constraints |
| --- | --- |
| Prompt fields | Required non-empty string when documented as required |
| Duration / seconds | Use only values or ranges listed by the selected adapter |
| Aspect / ratio | Use only ratios listed by the selected adapter |
| Resolution | Common values include `720P`/`1080P` or `720p` depending on adapter |
| Audio arrays | At most 3 public MP3 URLs on documented profiles; cannot stand alone on video-pro |
| Video arrays | At most 3 public URLs on documented multimodal profiles |
| Reference images | Public HTTPS URLs; counts follow the selected adapter |

The runner validates the actual parameter table attached to the exact adapter.
Do not treat this summary as permission to copy a parameter between models.

## Files And URLs

- JSON media fields reject local paths. Use a public HTTPS URL or media data URL.
- Local inputs are read into `Blob` values and sent only through a multipart variant that documents the matching upload field.
- `--image`, `--audio`, and `--video` are repeatable. The selected adapter controls field names and cardinality.
- Nested `input.media[]` entries keep their documented `type` values such as `first_frame`, `last_frame`, `reference_image`, `reference_video`, `first_clip`, and `video`.
- Dry-run summaries contain only safe file metadata such as a basename, never the file contents or full local directory.

## CLI

```text
--capability KEY       Required exact capability key
--model MODEL          Required exact public model
--prompt TEXT          Video prompt
--param KEY=VALUE      Repeat for adapter parameters (dotted keys allowed)
--image URL_OR_PATH    Repeat for image references or multipart files
--audio URL_OR_PATH    Repeat for audio references or multipart files
--video URL_OR_PATH    Repeat for video references or multipart files
--task-id ID           Resume polling without a POST
--output PATH          Result destination
--dry-run              Validate without resolving credentials or using network
```

Resume is independent of the original submission fields:

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --task-id vid_paid_123 \
  --output ./result.mp4
```

This path skips capability loading and POST request construction, resolves a
credential for GET polling, and persists the result.

API keys are deliberately not accepted as CLI arguments. Credential resolution
order is `KAIYUN_API_KEY`, active KaiyunCode Codex login, then KaiyunCode Claude
settings. Conflicting sources stop execution.

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
