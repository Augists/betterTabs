# 栖签（原 BetterTab）

一个基于 React、TypeScript、Manifest V3 的 Chrome、Edge、Firefox 标签归档扩展。归档链接直接存入 **专用书签文件夹**（历史兼容名称 BetterTab），利用浏览器的书签同步跨电脑访问。

## 本地预览

运行 npm install、npm run dev。界面已按选择统一为 **shadcn/ui 风格**：Radix Dialog/Slot + CVA + Tailwind 本地组件，细边框和鼠尾草绿。已移除顶部统计及另一套样式依赖。

本地网页使用独立的演示数据，可体验组织操作；它不能读取 Chrome 标签或书签。演示数据仅保存在浏览器的 `bettertab-demo` localStorage 中。扩展使用真实书签，不读取演示数据。

## 在浏览器加载

1. Chrome 134+ / Edge 134+：从 [GitHub Releases](https://github.com/Augists/betterTabs/releases) 下载 `Chromium-Chrome-Edge.zip` 并解压到固定目录，在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，选择「加载已解压的扩展程序」。更新时覆盖目录并刷新扩展。
2. Firefox 142+：日常安装需 Mozilla 签名的 `.xpi`。仅当 Release 附有 `Firefox-signed.xpi` 时，才能在 Firefox 扩展管理页「从文件安装附加组件」。`Firefox-unsigned.zip` 只供开发者在 `about:debugging` 临时加载。
3. 从源码构建：Node.js 22.12+；运行 `npm ci`、`npm test`、`npm run package:github`。`dist` 是 Chrome/Edge 构建，`dist-firefox` 是 Firefox 构建。固定栖签到工具栏即可使用。

构建输出完全本地打包，无 CDN、远程脚本、遥测或外部图标请求。开发者模式安装需要手动更新；Windows 上的 Chrome/Edge 对商店外 CRX 常规安装有限制。

GitHub 发布步骤见 [发布说明](docs/RELEASE.md)。用户界面已更名为「栖签」，历史 BetterTab 书签目录与备份格式继续兼容。

## 常用操作

- 工具栏 / **Alt+Shift+1**：归档当前窗口。成功保存后关闭标签，跳过固定、排除、重复以及不支持的浏览器内部页面。
- 网页右键菜单：当前、选中、其他、左侧、右侧标签，当前或所有窗口归档。
- `/`：聚焦搜索框。地址栏输入 `bt` 后按空格搜索归档。
- 点击标签或「恢复全部」恢复；更多菜单可在新窗口恢复。
- 恢复默认删除已成功打开的归档条目；可在设置改为保留。锁定组始终保留。
- 拖标签到其他标签前排序、组标题跨组移动、底部虚线区域建立新组。
- 拖组把手到另一组把手调整顺序；拖到组标题合并链接。来源空组保留其笔记与元信息。
- 键盘操作可用「选择整组」「移动到」和「移到列表最前」。组星标始终优先显示。
- 分组菜单编辑名称、分类、笔记，或设置星标、锁定、快捷列表；每个标签也可星标和标记任务。
- 删除会移入回收站；「永久删除」才真正删除书签。锁定组不可删除。包含子文件夹的组需先移出子文件夹，避免隐式删掉其他组。
- 导入支持 OneTab 的 `URL | 标题` 文本，空行分组。导出支持兼容文本、离线 HTML 和包含笔记、任务、空组、回收站的 JSON 完整备份。导入也支持该 JSON 备份。

## 跨电脑同步

两台同种浏览器登录**同一个浏览器账号**，开启**书签同步**，并分别安装栖签。Chrome/Edge 首次归档优先选择标记为 `syncing=true` 的账号书签目录；不可用时写入本地目录。Firefox 放在「其他书签」，其扩展 API 无法判断账号同步状态，需在 Firefox 设置中确认。Chrome、Edge、Firefox 之间的账号书签不会自动互通；跨浏览器迁移可导出完整 JSON 备份再导入。

扩展不能替用户开启同步，也不能保证即时同步或确认远端已收到数据。若先前建立的是本地目录，可通过 Chrome 书签管理器把整个 BetterTab 文件夹移动到账号书签位置。不要只移动链接而遗漏组内元信息。

组内 `⚙ BetterTab metadata — 请保留` 书签用于同步组状态、笔记和条目属性，URL 使用保留的 `.invalid` 域名，不会发起网络请求，也不依赖某台电脑的扩展 ID。实际网页都是普通书签，直接在 Chrome 书签管理器可用。卸载扩展不删除书签。

分类是元信息中的逻辑分类，不额外创建一层物理文件夹。手动建立的嵌套书签目录同样能读取。多个 BetterTab 根目录一起展示，不自动合并或删除。

## 验证

```sh
npm test
npm run package:github
```

测试集中在真实业务代码的书签适配层：归档写入与关闭顺序、部分写入失败、导航竞态、重复项、恢复失败保留、锁定保护、回收站、元信息重建及危险 URL 拒绝。使用模拟扩展 API，不等同于三个浏览器的真实安装验收。

加载扩展后，在「设置与偏好 → 运行浏览器自检」验证真实 API。测试创建独立窗口和临时书签，结束后清理，可下载 JSON 报告。它不验证跨电脑同步。

## 文档与当前边界

- [OneTab 功能清单](docs/ONETAB-FEATURES.md)：先于实现建立的对标基线与官方资料。
- [实现状态](docs/IMPLEMENTATION-STATUS.md)：已完成、差异与待实机验收。
- [手动验收](docs/TESTING.md)：加载扩展与双电脑测试步骤。

这不是已完成全部 OneTab 行为的正式发行版。公网分享 URL、二维码、撤回分享尚未实现；离线 HTML 分享不等价于这些服务。新版 OneTab 的私有加密云服务按本项目要求由书签同步替代。没有复制 OneTab 的代码或品牌。

## 许可证

MIT，见 [LICENSE](LICENSE)。
