import { MODELS_URL, PRICING_URL } from "./runtime-catalog.mjs";

function requiredInputs(adapter) {
  return adapter.parameters
    .filter(({ required, name }) => required && name !== "model")
    .map(({ name }) => name);
}

function profileKey(inputs) {
  return [...inputs].sort().join("\u0000");
}

function capabilityModels(capability, runtimeCatalog) {
  const models = new Map();
  for (const adapter of capability.adapters) {
    if (!runtimeCatalog.availableModels.has(adapter.model)) continue;
    if (!models.has(adapter.model)) {
      models.set(adapter.model, {
        model: adapter.model,
        priceLabel: runtimeCatalog.priceLabels.get(adapter.model) ?? null,
        profiles: [],
      });
    }
    const model = models.get(adapter.model);
    const inputs = requiredInputs(adapter);
    const key = profileKey(inputs);
    if (!model.profiles.some((profile) => profile.key === key)) {
      model.profiles.push({ key, requiredInputs: inputs });
    }
  }
  return [...models.values()]
    .map((model) => ({
      ...model,
      profiles: model.profiles.map(({ requiredInputs: inputs }) => ({
        requiredInputs: inputs,
      })),
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
}

export function buildCreativeCatalog({
  kind,
  capabilities,
  runtimeCatalog,
  capabilityKey,
} = {}) {
  if (kind !== "image" && kind !== "video") {
    throw new Error("Creative catalog kind must be image or video");
  }
  if (!Array.isArray(capabilities)) {
    throw new Error("Creative catalog capabilities must be an array");
  }
  if (!(runtimeCatalog?.availableModels instanceof Set)) {
    throw new Error("Creative catalog requires runtime availableModels");
  }
  if (!(runtimeCatalog?.priceLabels instanceof Map)) {
    throw new Error("Creative catalog requires runtime priceLabels");
  }

  const selected = capabilityKey
    ? capabilities.filter(({ key }) => key === capabilityKey)
    : capabilities;
  if (capabilityKey && selected.length === 0) {
    throw new Error(
      `${kind === "image" ? "Image" : "Video"} capability ${capabilityKey} is not available`,
    );
  }

  const normalized = selected.map((capability) => ({
    key: capability.key,
    name: capability.name ?? capability.key,
    description: capability.description ?? "",
    models: capabilityModels(capability, runtimeCatalog),
  }));
  const snapshotModels = new Set(
    selected.flatMap((capability) =>
      capability.adapters.map(({ model }) => model),
    ),
  );
  const availableModels = new Set(
    normalized.flatMap((capability) =>
      capability.models.map(({ model }) => model),
    ),
  );

  return {
    catalog: true,
    kind,
    checkedAt: runtimeCatalog.checkedAt ?? null,
    modelSource: MODELS_URL,
    pricingSource: PRICING_URL,
    snapshotModelCount: snapshotModels.size,
    availableModelCount: availableModels.size,
    excludedModelCount: snapshotModels.size - availableModels.size,
    capabilities: normalized,
  };
}

function profileLabel(profiles) {
  const labels = profiles.map(({ requiredInputs: inputs }) =>
    inputs.length > 0 ? inputs.join(" + ") : "无额外必填项",
  );
  return [...new Set(labels)].join(" / ");
}

export function formatCreativeCatalog(catalog) {
  if (!catalog?.catalog || !Array.isArray(catalog.capabilities)) {
    throw new Error("Invalid creative catalog result");
  }
  const kindLabel = catalog.kind === "image" ? "图片" : "视频";
  const lines = [
    `【KaiyunCode 实时${kindLabel}模型】`,
    `可用模型：${catalog.availableModelCount} 个`,
  ];
  if (catalog.excludedModelCount > 0) {
    lines.push(`已过滤下架或不可用模型：${catalog.excludedModelCount} 个`);
  }
  if (catalog.checkedAt) lines.push(`校验时间：${catalog.checkedAt}`);

  for (const capability of catalog.capabilities) {
    lines.push("", `${capability.name}（${capability.key}）`);
    if (capability.models.length === 0) {
      lines.push("- 当前没有可用模型");
      continue;
    }
    for (const model of capability.models) {
      lines.push(
        `- ${model.model}｜${model.priceLabel ?? "价格待确认"}`,
        `  必填：${profileLabel(model.profiles)}`,
      );
    }
  }

  lines.push(
    "",
    `模型来源：${catalog.modelSource}`,
    `价格来源：${catalog.pricingSource}`,
    "说明：模型是否适合具体创作，还需结合素材、时长、画幅和输出要求选择。",
  );
  return lines.join("\n");
}
