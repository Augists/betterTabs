# 界面方案选择记录

最初提供 shadcn/ui 风格和 Radix Themes 两套可操作样例。用户选定前者，并要求移除顶部归档数量统计。

当前已移除 A/B 切换及 @radix-ui/themes 依赖，保留浅色、深色和系统主题。本地组件位于 src/components/ui.tsx，由 Radix Dialog/Slot、CVA 和 Tailwind 组成，未通过 shadcn CLI 原样生成。

运行 npm run dev 体验搜索、建组、导入、星标和任务。网页使用独立演示数据；真实标签与书签操作需在 Chrome 中加载 dist 扩展。
