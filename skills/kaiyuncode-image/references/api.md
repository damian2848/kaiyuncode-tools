# KaiyunCode Asynchronous Image API

This reference reflects the bundled, validated intersection of the production
API tutorial and public adapter catalog. The bundled JSON snapshot is the
machine-readable authority for request construction only. Every new task uses
authenticated `GET /v1/models` for current availability and public
`GET /api/pricing` for current unit prices; neither result falls back to the
snapshot.

## Endpoint Allowlist

| Purpose | Method | Path |
| --- | --- | --- |
| Generate | POST | `/v1/images/async/generations` |
| Edit | POST | `/v1/images/async/edits` |
| Poll | GET | `/v1/images/async/{task_id}` |

There is no synchronous image interface. A POST returns `task_id` or `id`; the
runner then polls with GET. A paid POST is submitted once and is never
automatically retried.

## Production Capabilities

| Capability key | Models | Input profile |
| --- | --- | --- |
| `image_text_generation` | `gpt-image-2`, `gpt-image-2-mid-adobe`, `gpt-image-2-high-adobe`, `gemini-3.1-flash-image`, `gemini-3.0-pro-image`, `wan2.7-image-pro` | Required non-empty `prompt` |
| `image_edit` | Same six public models | Required `prompt` and `image`; protocol is the selected snapshot variant, including JSON generations or URL/file multipart edits |
| `image_multi_reference` | Same six public models | Required `prompt` and repeated `image_urls[]` |
| `image_sequential_generation` | Two Wan profiles under `wan2.7-image-pro` | Required `prompt` and `enable_sequential=true`; the reference profile also requires `image_urls[]` |

`gpt-image-2-max` has been removed from the production public catalog. Tutorial
residue must not make it selectable.

The two sequential Wan profiles share the same capability key and model. The
runner distinguishes them from their normalized parameter schemas: presence of
`image_urls[]` selects the reference profile. This is schema selection, not
protocol inference from a model name.

## Important Parameters

| Parameter | Production constraints |
| --- | --- |
| `prompt` | Required non-empty string |
| `n` | Most profiles document 1; Wan regular generation documents 1-4; Wan sequential generation allows at most 12 |
| `output_format` | `png`, `jpeg`, or `webp` |
| `output_compression` | 0-100 |
| `response_format` | `url` or `b64_json` |
| `background` | `opaque`, `auto`, or `transparent` |
| `moderation` | `auto` or `low` |
| `image_size` | Adobe aliases use `1K`, `2K`, or `4K`; do not replace it with `size` |
| `aspect_ratio` | Use only ratios listed by the selected adapter |
| `enable_sequential` | Must be `true` for sequential generation |
| `image_urls[]` | 本机图片、HTTPS URL 或图片 data URL；Wan 参考与参考组图 profile 最多 9 张 |

The runner validates the actual parameter table attached to the exact adapter.
Do not treat this summary as permission to copy a parameter between models.

## Files And URLs

- `--image` 和 `--mask` 都接受本机文件路径；Runner 会读取文件并封装为媒体负载，KaiyunCode 负责转存为上游需要的公网资源。
- 多图参考、组图、编辑和蒙版都不要求用户自行准备公网 URL；`--image` 可重复使用并保留输入顺序。
- 用户主动提供远程资源时必须使用无内嵌凭据的 HTTPS URL；也支持图片 data URL。
- 直接调用底层 `values` 时不能只放一个本机路径字符串，因为服务端无法读取调用方文件系统；应通过 `--image`、`--mask` 或 jobs 的 `images`、`mask` 字段交给 Runner 读取。
- Dry-run summaries contain only safe file metadata such as a basename, never the file contents or full local directory.

## CLI

```text
--capability KEY       Required exact capability key
--model MODEL          Required exact adapter model, checked via GET /v1/models
--prompt TEXT          Image prompt
--param KEY=VALUE      Repeat for adapter parameters
--image URL_OR_PATH    Repeat for local files or remote references
--mask URL_OR_PATH     Edit mask
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
node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --task-id img_paid_123 \
  --output ./result.png
```

This path skips capability loading and POST request construction, resolves a
credential for GET polling, and persists the result.

API keys are deliberately not accepted as CLI arguments.

## Results

The polling response accepts the production URL and `b64_json` result shapes.
URL results are downloaded through a temporary sibling and atomically renamed.
Base64 results are decoded strictly, written through a temporary sibling, and
atomically renamed. The returned object contains:

```json
{
  "taskId": "image_task_id",
  "status": "completed",
  "url": "https://cdn.example/result.png?token=%5BREDACTED%5D",
  "path": "/absolute/path/result.png"
}
```

The `url` field is absent for a base64-only result. Signed or sensitive query
values are redacted from reporting.
