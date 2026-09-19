import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

async function main() {
  const plugin = await import(new URL("../runtime-managed/agent-runtime-home/plugins/report-editor-context.mjs", import.meta.url).href) as {
    name: string;
    reportEditorContext: string;
    apply: (context: { systemPrompt: { section: (value: { name: string; order: number; text: string }) => void } }) => void;
  };

  assert.equal(plugin.name, "report-editor-context");
  assert.match(plugin.reportEditorContext, /默认作用域是当前报表/);
  assert.match(plugin.reportEditorContext, /必须同时从 page\.html、styles\.css 或 app\.js 接入并显示/);
  assert.match(plugin.reportEditorContext, /只创建一个未被报表引用的独立文件并给出下载链接，不算完成/);
  assert.match(plugin.reportEditorContext, /必须主动判断每个视觉角色/);
  assert.match(plugin.reportEditorContext, /加载 datatalk-image-gen Skill 并自动生成/);
  assert.match(plugin.reportEditorContext, /默认每个用户请求最多自动生成一张图片/);
  assert.match(plugin.reportEditorContext, /Logo、真实商品、真实人物/);
  assert.match(plugin.reportEditorContext, /缺少可信参考时不得虚构/);
  assert.match(plugin.reportEditorContext, /仅生成独立文件/);
  assert.match(plugin.reportEditorContext, /解释、分析、检查、排查、咨询类请求保持只读/);

  let registeredSection: { name: string; order: number; text: string } | null = null;
  plugin.apply({ systemPrompt: { section: (value) => { registeredSection = value; } } });
  assert.deepEqual(registeredSection, {
    name: "datatalk:report-editor-context",
    order: 5,
    text: plugin.reportEditorContext,
  });

  const profile = await readFile(new URL("../runtime-managed/agent-runtime-home/profiles/headless/cordis.patch.yml", import.meta.url), "utf8");
  const profileConfig = parseYaml(profile) as Array<{ insert?: Array<{ id?: string; name?: string }> }>;
  const insertedPlugins = profileConfig.flatMap((entry) => entry.insert || []);
  assert.deepEqual(insertedPlugins.find((entry) => entry.id === "report-editor-context"), {
    id: "report-editor-context",
    name: "../../plugins/report-editor-context.mjs",
  });

  const skill = await readFile(new URL("../skills/bi-report-editor/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /短指令形式的图片、插画、示意图、海报/);
  assert.match(skill, /不要要求用户重复补充“生成报告”“放到画布”“修改当前报表”/);
  assert.match(skill, /只返回 `sandbox:` 链接/);
  assert.match(skill, /用户选中了画布元素时优先修改该元素/);
  assert.match(skill, /### 主动判断视觉实现方式/);
  assert.match(skill, /KPI、数据图表、表格、趋势、流程关系/);
  assert.match(skill, /照片、复杂场景插画、专题封面、纹理、透明位图主体/);
  assert.match(skill, /复用已有真实素材/);
  assert.match(skill, /模糊美化要求，本身不足以触发生图/);
  assert.match(skill, /默认每个用户请求最多自动生成一张图片/);
  assert.match(skill, /visualDecision/);
  assert.match(skill, /needGeneratedImage/);
  assert.match(skill, /integrationMode/);
  assert.match(skill, /替换既有占位图或同主体视觉使用 `replace`/);
  assert.match(skill, /涉及创建或视觉改造时完成 `visualDecision`/);

  const imageSkill = await readFile(new URL("../skills/datatalk-image-gen/SKILL.md", import.meta.url), "utf8");
  assert.match(imageSkill, /Logo、真实商品、真实人物/);
  assert.match(imageSkill, /没有参考时不得通过生图虚构其真实外观/);
  assert.match(imageSkill, /模糊的“更好看”“更高级”“不要空”不单独构成生图理由/);

  console.log("Report editor default intent and visual routing contract passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
