# ysc-api · 影视仓/TVBox 永久自更新接口

## 主接口地址(在影视仓「配置地址」粘贴这个)

    https://ysc.tengxuntaobao.win/

这个地址**永久不变**。内容**每周一凌晨 3:00(北京时间)自动更新**:
Cloudflare Worker 定时抓取下方 10 个上游接口 -> 逐个校验有效性 ->
按优先级选"当前最优可用"的存入 KV 并对外提供。某个源挂了自动切换
到下一个可用源, 无需人工干预。源内容异常时可访问
`https://ysc.tengxuntaobao.win/refresh` 立即重采。

## 端点说明

| 地址 | 用途 |
| --- | --- |
| `/` | 当前最优接口·**精简版**(默认, 加载快) |
| `/full` | 当前最优接口·**完整版**(全部站点, 不裁剪) |
| `/status` | 10 个源的健康状态、当前生效源、采集时间 |
| `/refresh` | 手动触发一次重新采集 |
| `/s/0` ~ `/s/9` | 直通池内第 N 个源(按 sources.json 顺序), 备用切换用 |

## 智能瘦身(为什么加载快)

影视仓启动时会把配置里**所有站点全部挂载**，站点越多启动越慢。
`/` 精简版在输出时自动做三件事：

1. **裁掉冷门站点**（听书/KTV/电台/戏曲/舞曲/音乐/短剧/体育/教育/
   网盘DIY等关键词），99 站 → 约 41 站，主力影视站全保留；
2. **4K网盘/盘搜类白名单**，只留花卷、玩偶、原盘、蜗牛、盘库、
   盘搜、卡卡等主力；
3. **剔除境外 DoH**（dns.google/cloudflare-dns 等在国内不可达，
   会让 APP 每次域名解析都先撞超时），让影视仓直接用系统 DNS。

想要全部站点时用 `/full`（忠实输出上游原版，不做任何改动）。

## 接口源池(sources.json, 按优先级排序, 2026-11-02 实测选优)

| # | 名称 | 说明 |
| --- | --- | --- |
| 1 | 王二小 | Last-Modified 昨日刚更新, 99源 |
| 2 | 肥猫 | Last-Modified 昨日刚更新 |
| 3 | 欧歌 | 106源 |
| 4 | 老刘备 | 234源大聚合(liucn.cc) |
| 5 | 嗷呜 | 79源 |
| 6 | 小米 | GitHub CatVodSpider 官方 demo |
| 7 | 南风 | yoursmile66 XC.json(lintech 加密, 影视仓原生支持) |
| 8 | 天天开心 | tmoom/ttkx GitHub 镜像 |
| 9 | 老刘备用 | liu673cn/box GitHub 镜像(与 #4 内容双通道冗余) |
| 10 | 摸鱼儿 | 103源, CF边缘暂被WAF拦(456), 持续监测可自愈 |

替补席(需要时可自行加回 sources.json):
- 饭太硬 `http://www.饭太硬.net/tv` — 更新最勤(每日)但反爬严格, 非APP指纹一律返回头像图
- 小虎斑 `http://hb.小虎斑.site:25252/仅供测试` — 境外403
- 王二小tvbox线 `http://tvbox.xn--4kq62z5rby2qupq9ub.top/` — 与#1同作者, 时好时坏
- 俊哥 `http://home.jundie.top:81/top98.json` — Last-Modified 2025-04 停更
- 小盒子4K `http://xhztv.top/4k.json` — Last-Modified 2024-02 停更

## 如何增删源?

编辑本仓库 `sources.json` 即可, 下一轮每周采集时自动生效
(等不及就访问一次 `https://ysc.tengxuntaobao.win/refresh`),
无需重新部署 Worker。

## CatPawOpen(猫爪)客户端专用

影视仓/TVBox 的源(jar蜘蛛)与猫爪的源(nodejs蜘蛛)是两套不同运行时,
内容无法互通。猫爪采用「主源+备用源」双包，都经本域名托管：

    https://ysc.tengxuntaobao.win/catpaw/index.js          ← 主源(kstore社区聚合包, 内容最丰富)
    https://ysc.tengxuntaobao.win/catpaw-official/index.js ← 备用源(官方框架构建包)

主源内容: 20+网盘资源站(摸鱼儿/玩偶哥哥/多多/虎斑/观影/盘链/雷鲸/
光雅影院/123盘资源/TG搜等) + 夸克/UC/阿里/百度/115网盘解析 + 豆瓣
+ B站 + 直播 + Emby。

频道裁剪(2026-11-03): 已删除25个频道——听书×4 / 戏曲×2 / 音乐×10(含
电台/舞曲/舞蹈) / 体育×6 / 实测无内容的 盘迷|4K、点播|直播、伊影|秒播,
频道列表 97→72。裁剪用「语义锚点补丁」在 /config 出口过滤实现(不依赖压缩后
函数名, 上游重构也能命中), 每周同步工具会对新版上游自动重打补丁并先过
语法校验; 上游新增同类频道也会被自动裁掉。想恢复/增删某类频道: 改
「猫爪源同步-工具.py」里的 FILTER_REGEX / DISABLE_KEYS 再跑一次即可。

更新机制: kstore上游仅国内可达(CF边缘拉不到)，由 TeleAgent 每周
定时任务「猫爪源同步」(每周一 04:00)从国内侧拉取最新包并提交到
本仓库 → /catpaw/index.js.md5 变化 → 猫爪客户端自动感知并重新
下载，全程无需人工。备用源由 Actions 每周一重建。此端点与影视仓
端点完全独立, 互不影响速度。

## 备用访问地址(万一主域名出问题)

- GitHub 镜像(Actions 每周一凌晨同步精简版): `https://raw.githubusercontent.com/fengzhiku123/ysc-api/main/tvbox.json`
- 加速镜像: `https://ghfast.top/https://raw.githubusercontent.com/fengzhiku123/ysc-api/main/tvbox.json`
- 各源直通: `https://ysc.tengxuntaobao.win/s/0` ~ `/s/9`
- 猫爪主源备用: `https://ghfast.top/https://raw.githubusercontent.com/fengzhiku123/ysc-api/main/catpaw/index.js`

## 维护节奏(2026-11-03 起为每周一次, 均为北京时间周一凌晨)

| 时间 | 任务 | 说明 |
| --- | --- | --- |
| 周一 03:00 | Worker 定时采集 | 刷新影视仓源(KV), cron `0 19 * * SUN`(UTC) |
| 周一 03:30 | Actions mirror | 同步精简版到仓库 tvbox.json |
| 周一 03:40 | Actions rebuild-catpaw | 重建猫爪备用源(官方包 → catpaw-official/) |
| 周一 04:00 | TeleAgent「猫爪源同步」 | 国内侧拉取kstore最新包更新猫爪主源(仓库catpaw/) |
| 每天 09:00 | TeleAgent「接口巡检」 | 只做健康体检(一句话汇报), 不做更新 |

## 部署信息

- Cloudflare Worker: `ysc-api`, 绑定自定义域名 ysc.tengxuntaobao.win
- KV 命名空间: a9654cd9fbd44c14bb1f98e8279d97e3
- 定时采集: `0 19 * * SUN` (每周一凌晨3点, 北京时间; 超过7.5天未刷新时请求会自动兜底重采)
- 免费额度用量: 每周7次定时采集级操作 + 少量读取, 远低于免费上限
