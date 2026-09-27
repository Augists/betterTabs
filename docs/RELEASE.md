# 0.3.0 GitHub 发布

本版本新增 Edge 与 Firefox 构建。用户书签目录、元信息版本和 JSON 备份格式保持不变。

## 产物

运行 `npm ci`、`npm test`、`npm run package:github` 后生成：

- `release/Qiqian-0.3.0-Chromium-Chrome-Edge.zip`：适用于 Chrome 134+ / Edge 134+ 的开发者模式加载包。
- `release/Qiqian-0.3.0-Firefox-unsigned.zip`：适用于 Firefox 142+ 的源码审查与临时加载包，**不能直接作为长期安装包**。
- `release/Qiqian-0.3.0.crx`：沿用本机私钥签名的 Chromium CRX3，仅用于企业策略分发或离线核查，普通 Windows Chrome/Edge 用户仍应使用 ZIP 开发者模式加载。
- `release/SHA256SUMS.txt`：发行附件的 SHA-256 校验值。

GitHub Release 应附上 Chromium ZIP、Firefox 未签名 ZIP、CRX 和 SHA256SUMS。若取得 Mozilla 签名，还应附上 `Qiqian-0.3.0-Firefox-signed.xpi` 并核对签名包版本与扩展 ID。Firefox 常规版本必须经 Mozilla 签名；可在 AMO 选择 unlisted（自托管）签名渠道，下载签名 XPI 后放到 GitHub。需要发布者的 Mozilla 开发者账号；API 自动签名另需安全保存的 API 凭据。**不要**把凭据或 `release/private/Qiqian.pem` 提交到 Git。

Chrome/Edge 的 GitHub ZIP 需要解压后在扩展管理页开启开发者模式并加载目录，更新需手动覆盖和刷新。既有 CRX 不能替代 Chromium 在 Windows 上的商店外常规安装渠道。公开仓库应仅提交源码、文档与构建脚本；发行包上传到 Release 附件。浏览器间的账号书签不同步，跨浏览器请使用完整备份导入。

## 发布前核验

1. `npm test`、`npm run package:github`、`web-ext lint --source-dir dist-firefox`。
2. 在 Chrome、Edge、Firefox 分别安装对应包并运行设置中的浏览器自检。检查归档后关闭源标签、恢复、导入导出、原生标签组、重启后书签重建。
3. 在同一种浏览器的两台设备上验证书签同步；跨浏览器用 JSON 备份迁移。
4. 在 GitHub 推送 `v0.3.0` tag 并创建 Release；上传产物和版本说明。若尚无签名 XPI，在版本说明中显著标明 Firefox 包只用于临时测试。

旧版本的 Chrome 商店材料留在 `docs/STORE-LISTING.md`，当前发布渠道以本文件为准。
