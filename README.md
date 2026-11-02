# ysc-api · 影视仓/TVBox 永久自更新接口

## 主接口地址(在影视仓"配置地址"粘贴这个)

    https://ysc.tengxuntaobao.win/

这个地址**永久不变**。内容每 4 小时自动更新:
Cloudflare Worker 定时抓取下方 10 个上游接口 -> 逐个校验有效性 ->
按优先级选"当前最优可用"的接口存入 KV 并对外提供。
某个源挂了会自动切换到下一个可用源, 无需人工干预。

## 端点说明

| 地址 | 用途 |
| --- | --- |
| `/` | 当前最优接口(影视仓用这个) |
| `/status` | 10 个源的健康状态、当前生效源、采集时间 |
| `/refresh` | 手动触发一次重新采集 |
| `/s/0` ~ `/s/9` | 直通池内第 N 个源(按 sources.json 顺序), 备用切换用 |

## 接口源池(sources.json, 按优先级排序)

| # | 名称 | 说明 |
| --- | --- | --- |
| 1 | 王二小 | Last-Modified 实时更新 |
| 2 | 肥猫 | Last-Modified 实时更新 |
| 3 | 欧歌 | 106 站点 |
| 4 | 摸鱼儿 | 103 站点 |
| 5 | 老刘备 | 234 源大聚合 |
| 6 | 嗷呜 | kstore |
| 7 | 小米 | GitHub CatVodSpider 官方 demo |
| 8 | 南风 | yoursmile66/TVBox (lintech 加密格式, 影视仓原生支持) |
| 9 | 小虎斑 | lintech 加密格式 |
| 10 | 饭太硬 | 每日更新但反爬严格, 由 Worker 自动校验裁决 |

## 如何增删源?

编辑本仓库 `sources.json` 即可, 下一轮采集(最长4小时)自动生效,
无需重新部署 Worker。

## 备用访问地址(万一主域名出问题)

- GitHub 镜像(Actions 每6小时同步): `https://raw.githubusercontent.com/fengzhiku123/ysc-api/main/tvbox.json`
- 加速镜像: `https://ghfast.top/https://raw.githubusercontent.com/fengzhiku123/ysc-api/main/tvbox.json`
- 各源直通: `https://ysc.tengxuntaobao.win/s/0` ~ `/s/9`

## 部署信息

- 运行于 Cloudflare Workers (免费额度内, 每天最多6次定时采集 + 少量读取)
- KV 存储: 最近一次最优接口 + 状态元数据
- 域名: ysc.tengxuntaobao.win (Cloudflare 自定义域名, 自动 HTTPS)
