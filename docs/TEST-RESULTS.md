# 验证记录

日期：2026-09-27；候选发布版本：0.3.0。

- `npm test`：40 项通过（书签适配层 20 项、后台与消息边界 20 项）。
- `npm run package:github`：TypeScript、Vite、Chrome/Edge 后台 worker、Firefox 后台脚本与两个 ZIP 构建通过；ZIP 根目录包含 manifest.json。
- `web-ext lint --source-dir dist-firefox`：0 错误、2 警告。两条警告指向 React DOM 打包代码的 `innerHTML` 静态赋值；项目源码没有使用 `dangerouslySetInnerHTML`。
- 本机 Firefox 156.0.1：`web-ext run` 已将 `dist-firefox` 安装为临时附加组件，未完成完整交互与扩展内自检。
- Chrome：2026-09-21 用户在旧版扩展内运行真实 API 自检，反馈 13 项全部通过。0.3.0 尚需安装回归。
- Edge：未完成真实扩展运行与自检。
- 双电脑书签同步及跨浏览器 JSON 迁移：未验收。
- Firefox 日常安装：尚无 Mozilla 签名 XPI，未签名 ZIP 仅供临时加载。

真实 API 自检入口：设置与偏好 → 运行浏览器自检。自动化测试使用内存 API 模型，不替代各浏览器真实生命周期、界面或跨设备测试。
