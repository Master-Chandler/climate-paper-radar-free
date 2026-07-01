# Climate Paper Radar — 完全免费版

为 Yuheng Tang 定制的气候科学论文推荐平台。它每天使用 OpenAlex 检索新论文，按个人研究方向进行本地规则评分，展示作者英文摘要，并通过现有邮箱的 SMTP 免费发送每日邮件。

## 成本

| 服务 | 用途 | 费用 |
|---|---|---:|
| OpenAlex | 论文元数据与英文摘要 | 免费 Key，每日免费额度足够 |
| GitHub Pages | 托管网站 | 免费 |
| GitHub Actions | 每天检索与发送邮件 | 免费额度足够每日运行 |
| QQ、163 或 Gmail SMTP | 发送邮件 | 免费 |
| OpenAI / 其他大模型 | 不使用 | 0 |

项目没有 OpenAI、Resend、数据库或付费服务器依赖。

## 已写入的研究画像

- 机器学习、可解释 AI 与因果推断在气候科学中的应用
- 东亚季风、降水与极端事件
- 青藏高原和高山亚洲气候
- 南极、海冰、南半球环状模与跨区域遥相关

画像来自公开的 [Google Scholar 主页](https://scholar.google.com/citations?user=_9QylpgAAAAJ&hl=zh-CN)，可在 `config/profile.json` 中修改主题、关键词、权重、回溯天数和最低推荐分数。

## 本地预览

要求 Node.js 20 或更新版本，不需要安装任何依赖。

```bash
npm start
```

打开 <http://127.0.0.1:4173>。运行检查：

```bash
npm run check
```

手动更新论文：

```bash
npm run update
```

每日脚本会：

1. 按五个研究主题检索最近 10 天 OpenAlex 新论文。
2. 要求论文同时命中气候领域词和对应研究主题词，过滤泛 AI 等无关结果。
3. 按主题匹配、新近度和引用信号计算相关度，并去重。
4. 保留作者英文摘要原文，更新网站；只有新论文才进入邮件。

脚本采用串行检索、指数退避重试和失败主题数据保留。OpenAlex 偶发出现 503 或限流时，不会清空网站数据；如果所有主题暂时不可用，当天任务会保留前一天结果并正常结束。

## 部署到 GitHub Pages

1. 新建 GitHub 仓库并推送本项目。
2. 在 **Settings → Pages** 中，将 Source 设为 **Deploy from a branch**，选择 `main` 和 `/ (root)`。
3. 在 **Settings → Actions → General** 中，将 Workflow permissions 设为 **Read and write permissions**。
4. `.github/workflows/daily-digest.yml` 会每天北京时间 08:30 自动更新。

GitHub 的免费额度对每天一次、运行几分钟的任务通常绰绰有余。公开仓库若长期没有任何活动，GitHub 可能暂停定时工作流；在 Actions 页面重新启用即可。

## 启用免费邮件推送

先在邮箱设置中开启 SMTP，并创建“授权码”或“应用专用密码”。不要使用邮箱登录密码。

常用配置：

| 邮箱 | `SMTP_HOST` | `SMTP_PORT` |
|---|---|---:|
| QQ 邮箱 | `smtp.qq.com` | `465` |
| 163 邮箱 | `smtp.163.com` | `465` |
| Gmail | `smtp.gmail.com` | `465` |

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 示例/用途 |
|---|---|
| `OPENALEX_API_KEY` | 必需；在 [OpenAlex API 设置](https://openalex.org/settings/api) 免费创建 |
| `OPENALEX_EMAIL` | 可选，OpenAlex 礼貌池联系邮箱 |
| `SMTP_HOST` | `smtp.qq.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | 用于发信的完整邮箱地址 |
| `SMTP_PASS` | SMTP 授权码或应用专用密码 |
| `DIGEST_TO_EMAIL` | 接收每日论文的邮箱地址 |
然后进入 **Actions → Daily paper digest → Run workflow** 手动运行一次。成功后会收到首封邮件，之后每天北京时间 08:30 自动执行。

## 隐私与内容边界

- 邮箱授权码和收件地址只存放在 GitHub Secrets，不进入仓库或网页。
- 英文摘要来自 OpenAlex 收录的作者摘要，不包含 AI 生成、翻译或推断。
- OpenAlex 元数据偶尔可能存在日期或期刊字段误差，正式引用请以 DOI 页面为准。
