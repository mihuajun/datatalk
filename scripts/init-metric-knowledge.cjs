console.error("旧指标 JSON 初始化/迁移入口已停用。新安装由应用初始化 content 结构；清空重建使用 npm run db:reset-metric-content，默认仅预览。请勿运行历史迁移复活旧候选。");
process.exitCode = 1;
